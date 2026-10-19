import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { clockContains, fortalezaClock, parseClock } from '../../common/clock.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { QrCodesService } from '../qr-codes/qr-codes.service.js';
import { RECORD_TYPES } from './constants/record-types.constants.js';
import { GroupsService } from '../groups/groups.service.js';
import { WorkloadAdjustmentsService } from '../workload-adjustments/workload-adjustments.service.js';

type TimeRecordType = (typeof RECORD_TYPES)[number];

@Injectable()
export class TimeRecordsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly qrCodesService: QrCodesService,
    private readonly groupsService: GroupsService,
    private readonly workloadAdjustmentsService: WorkloadAdjustmentsService,
  ) {}

  async create(userId: string, input: { code?: string; type?: string; groupId?: string }) {
    const code = input.code?.trim();
    const type = input.type;
    if (!code || !type || !isRecordType(type)) {
      throw new UnprocessableEntityException('Código e tipo são obrigatórios');
    }

    const qrCode = await this.qrCodesService.findActiveById(code);

    const history = await this.recentRecords(userId);
    const last = history.find((record) => !isRefusedExit(record)) ?? null;

    if ((!last && type !== 'entrada') || last?.type === type) {
      throw new UnprocessableEntityException('Sequência de batida inválida');
    }

    const now = new Date();
    const clock = fortalezaClock(now);
    if (type === 'saida' && isRefusedExit(history[0])) {
      const end = history[0]?.early_exit_justifications?.scheduled_end;
      if (end && clock < end) {
        throw new UnprocessableEntityException(`O expediente segue até ${end}`);
      }
    }

    const groupId =
      type === 'saida' ? (last?.group_id ?? null) : await this.resolveEntryGroup(userId, input.groupId);

    const scheduledEnd = type === 'saida' ? await this.scheduledEndFor(userId, groupId, now) : null;
    const early = Boolean(scheduledEnd && clock < scheduledEnd);

    const created = await this.prismaService.$transaction(async (tx) => {
      const record = await tx.time_records.create({
        data: {
          id: randomUUID(),
          user_id: userId,
          qr_code_id: qrCode.id,
          group_id: groupId,
          type,
          recorded_at: now,
          created_at: now,
        },
      });
      const justification =
        early && scheduledEnd
          ? await tx.early_exit_justifications.create({
              data: {
                id: randomUUID(),
                time_record_id: record.id,
                user_id: userId,
                scheduled_end: scheduledEnd,
                created_at: now,
                updated_at: now,
              },
            })
          : null;
      return { record, justification };
    });

    const entry =
      type === 'saida'
        ? await this.previousEntry(userId, created.record.recorded_at)
        : null;
    const group = groupId
      ? await this.prismaService.groups.findUnique({
          where: { id: groupId },
          select: { id: true, name: true },
        })
      : null;
    return toRecord(created.record, qrCode, entry, group, created.justification);
  }

  async groupOptions(userId: string) {
    const history = await this.recentRecords(userId);
    const last = history.find((record) => !isRefusedExit(record)) ?? null;

    if (last?.type === 'entrada') {
      const open = last.groups;
      return {
        openGroup: open ? { id: open.id, name: open.name } : null,
        choiceRequired: false,
        groups: open
          ? [
              {
                id: open.id,
                name: open.name,
                startTime: open.start_time,
                endTime: open.end_time,
                matchesNow: true,
              },
            ]
          : [],
      };
    }

    const day = resolveDay();
    const memberships = await this.groupsService.findActive(userId);
    const adjustments = await this.workloadAdjustmentsService.findCoveringAll(
      userId,
      day.utcDay,
    );
    const now = fortalezaClock();
    const groups = memberships.map((group) => {
      const specific = adjustments.find((item) => item.group_id === group.id);
      const startTime = specific?.start_time ?? group.start_time;
      const endTime = specific?.end_time ?? group.end_time;
      return {
        id: group.id,
        name: group.name,
        startTime,
        endTime,
        matchesNow: Boolean(
          startTime && endTime && clockContains(now, startTime, endTime),
        ),
      };
    });
    const matching = groups.filter((group) => group.matchesNow);
    return {
      openGroup: null,
      choiceRequired: matching.length > 1,
      groups,
    };
  }

  private async resolveEntryGroup(userId: string, requestedId?: string) {
    const options = await this.groupOptions(userId);
    if (options.groups.length === 0) {
      throw new UnprocessableEntityException('Usuário sem grupo');
    }

    const matching = options.groups.filter((group) => group.matchesNow);
    const requested = requestedId?.trim();
    if (requested) {
      const chosen = options.groups.find((group) => group.id === requested);
      if (!chosen) throw new UnprocessableEntityException('Grupo inválido');
      if (!chosen.matchesNow) {
        throw new UnprocessableEntityException(entryWindowMessage(chosen));
      }
      return chosen.id;
    }

    if (matching.length > 1) {
      throw new UnprocessableEntityException('Informe o grupo da batida');
    }
    if (matching.length === 0) {
      throw new UnprocessableEntityException(entryWindowMessage(options.groups));
    }
    return matching[0].id;
  }

  async saveActivity(
    userId: string,
    input: { exitId?: string; description?: string },
  ) {
    const exitId = input.exitId?.trim();
    const description = input.description?.trim();
    if (!exitId || !description) {
      throw new UnprocessableEntityException('Saída e atividade são obrigatórias');
    }
    if (description.length > 500) {
      throw new UnprocessableEntityException(
        'A atividade pode ter no máximo 500 caracteres',
      );
    }

    const exit = await this.prismaService.time_records.findFirst({
      where: { id: exitId, user_id: userId },
    });
    if (!exit || exit.type !== 'saida') {
      throw new UnprocessableEntityException('Saída inválida');
    }

    const entry = await this.previousEntry(userId, exit.recorded_at);
    if (!entry) {
      throw new UnprocessableEntityException('Entrada da saída não encontrada');
    }

    const updated = await this.prismaService.time_records.update({
      where: { id: exit.id },
      data: { activity: description },
      include: { qr_codes: true, groups: { select: { id: true, name: true } } },
    });

    return toRecord(updated, updated.qr_codes, entry, updated.groups);
  }

  async saveReason(userId: string, input: { exitId?: string; reason?: string }) {
    const exitId = input.exitId?.trim();
    const reason = input.reason?.trim();
    if (!exitId || !reason) {
      throw new UnprocessableEntityException('Saída e motivo são obrigatórios');
    }
    if (reason.length > 500) {
      throw new UnprocessableEntityException('O motivo pode ter no máximo 500 caracteres');
    }

    const item = await this.prismaService.early_exit_justifications.findFirst({
      where: { time_record_id: exitId, user_id: userId },
    });
    if (!item) {
      throw new UnprocessableEntityException('Esta saída não precisa de justificativa');
    }
    if (item.status !== 'PENDENTE') {
      throw new UnprocessableEntityException('A justificativa já foi analisada');
    }

    const updated = await this.prismaService.early_exit_justifications.update({
      where: { id: item.id },
      data: { reason, updated_at: new Date() },
    });
    return {
      id: updated.id,
      exitId: updated.time_record_id,
      scheduledEnd: updated.scheduled_end,
      reason: updated.reason,
      status: updated.status,
    };
  }

  async listJustifications() {
    const rows = await this.prismaService.early_exit_justifications.findMany({
      include: justificationInclude,
      orderBy: { created_at: 'desc' },
    });

    return rows.map(toJustification);
  }

  async review(
    reviewerId: string,
    input: { id?: string; status?: string; makeupDate?: string; makeupStart?: string },
  ) {
    const id = input.id?.trim();
    if (!id || !isReviewStatus(input.status)) {
      throw new UnprocessableEntityException('Justificativa e decisão são obrigatórias');
    }

    const item = await this.prismaService.early_exit_justifications.findUnique({
      where: { id },
      include: { time_records: { select: { recorded_at: true } } },
    });
    if (!item) throw new NotFoundException('Justificativa não encontrada');
    if (item.user_id === reviewerId) {
      throw new ConflictException('Não é possível analisar a própria justificativa');
    }
    if (!item.reason?.trim()) {
      throw new UnprocessableEntityException('O motivo ainda não foi informado');
    }
    if (item.status !== 'PENDENTE') {
      throw new UnprocessableEntityException('A justificativa já foi analisada');
    }

    const makeup =
      input.status === 'APROVADA_PARCIAL' ? makeupWindow(item, input.makeupDate, input.makeupStart) : null;
    if (input.status === 'RECUSADA') assertCanRefuse(item);

    const now = new Date();
    const updated = await this.prismaService.early_exit_justifications.update({
      where: { id: item.id },
      data: {
        status: input.status,
        reviewer_id: reviewerId,
        reviewed_at: now,
        updated_at: now,
        makeup_date: makeup?.date ?? null,
        makeup_start: makeup?.start ?? null,
        makeup_end: makeup?.end ?? null,
      },
      include: justificationInclude,
    });

    return toJustification(updated);
  }

  async listMine(userId: string) {
    const records = await this.prismaService.time_records.findMany({
      where: { user_id: userId },
      include: {
        qr_codes: true,
        groups: { select: { id: true, name: true } },
        early_exit_justifications: true,
      },
      orderBy: { recorded_at: 'desc' },
    });

    return records.map((record, index) => {
      const entry = entryBefore(records, index);
      return toRecord(
        record,
        record.qr_codes,
        entry,
        record.groups,
        record.early_exit_justifications,
      );
    });
  }

  private async scheduledEndFor(userId: string, groupId: string | null, at: Date) {
    if (!groupId) return null;
    const group = await this.prismaService.groups.findUnique({
      where: { id: groupId },
    });
    if (!group) return null;

    const day = resolveDay(fortalezaDate(at));
    const memberships = await this.groupsService.findActive(userId);
    const listed = memberships.some((item) => item.id === group.id)
      ? memberships
      : [...memberships, group];
    const adjustments = await this.workloadAdjustmentsService.findCoveringAll(
      userId,
      day.utcDay,
    );
    const plan = plansFrom(listed, adjustments).find((item) => item.key === group.id);
    return plan?.hours.endTime ?? group.end_time;
  }

  private async recentRecords(userId: string) {
    return this.prismaService.time_records.findMany({
      where: { user_id: userId },
      orderBy: { recorded_at: 'desc' },
      include: {
        groups: { select: { id: true, name: true, start_time: true, end_time: true } },
        early_exit_justifications: { select: { status: true, scheduled_end: true } },
      },
      take: 30,
    });
  }

  private async previousEntry(userId: string, recordedAt: Date) {
    const previous = await this.prismaService.time_records.findMany({
      where: { user_id: userId, recorded_at: { lt: recordedAt } },
      orderBy: { recorded_at: 'desc' },
      include: { early_exit_justifications: { select: { status: true } } },
      take: 30,
    });
    for (const record of previous) {
      if (isRefusedExit(record)) continue;
      if (record.type !== 'entrada') return null;
      return record;
    }
    return null;
  }

  async summary(userId: string, date?: string) {
    const day = resolveDay(date);
    const records = await this.prismaService.time_records.findMany({
      where: {
        user_id: userId,
        recorded_at: { gte: day.start, lt: day.end },
      },
      include: {
        groups: {
          select: {
            id: true,
            name: true,
            start_time: true,
            end_time: true,
            daily_workload_minutes: true,
          },
        },
        early_exit_justifications: true,
      },
      orderBy: { recorded_at: 'asc' },
    });
    const allowances = await this.prismaService.time_allowances.findMany({
      where: { user_id: userId, day: day.utcDay },
      include: {
        groups: { select: { name: true } },
        allowance_documents: { select: { id: true, file_name: true } },
      },
      orderBy: { created_at: 'asc' },
    });
    const groups = creditAllowances(
      creditApproved(await this.dayGroups(userId, day.utcDay, records, day.end), records),
      allowances,
    );
    const totals = totalsOf(groups);
    return {
      date: day.date,
      ...totals,
      groups,
      activities: records
        .filter((record) => record.type === 'saida')
        .map((record) => ({
          recordedAt: record.recorded_at,
          description: record.activity,
        })),
      justifications: records.flatMap((record) => {
        const item = record.early_exit_justifications;
        if (!item) return [];
        return [
          {
            recordedAt: record.recorded_at,
            scheduledEnd: item.scheduled_end,
            reason: item.reason,
            status: item.status,
            makeupDate: dateOnly(item.makeup_date),
            makeupStart: item.makeup_start,
            makeupEnd: item.makeup_end,
          },
        ];
      }),
      allowances: allowances.map((item) => ({
        id: item.id,
        groupId: item.group_id,
        groupName: item.groups.name,
        minutes: item.minutes,
        reason: item.reason,
        status: item.status,
        documents: item.allowance_documents.map((document) => ({
          id: document.id,
          fileName: document.file_name,
        })),
      })),
    };
  }

  private async dayGroups(
    userId: string,
    day: Date,
    records: PunchRecord[],
    end: Date,
  ) {
    const memberships = await this.groupsService.findActive(userId);
    const adjustments = await this.workloadAdjustmentsService.findCoveringAll(
      userId,
      day,
    );
    const worked = workedByGroup(records, end);
    const lines = new Map<string, GroupHours>();

    for (const plan of plansFrom(memberships, adjustments)) {
      lines.set(plan.key, {
        ...plan.hours,
        workedMinutes: worked.get(plan.key) ?? 0,
        scheduleVaries: false,
      });
    }

    for (const [key, minutes] of worked) {
      if (lines.has(key)) continue;
      const sample = records.find((record) => groupKey(record.group_id) === key)?.groups;
      const adjustment = adjustments.find((item) => groupKey(item.group_id) === key);
      const expectedMinutes =
        adjustment?.daily_workload_minutes ?? sample?.daily_workload_minutes ?? null;
      lines.set(key, {
        id: key ? key : null,
        name: sample?.name ?? (key ? 'Grupo' : 'Sem grupo'),
        startTime: adjustment?.start_time ?? sample?.start_time ?? null,
        endTime: adjustment?.end_time ?? sample?.end_time ?? null,
        workedMinutes: minutes,
        expectedMinutes,
        scheduleVaries: false,
      });
    }

    return [...lines.values()]
      .map((line) => ({
        ...line,
        remainingMinutes:
          line.expectedMinutes === null ? null : line.expectedMinutes - line.workedMinutes,
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'pt-BR'));
  }

  async summaryByEnrollment(suapEnrollment?: string, date?: string) {
    const enrollment = suapEnrollment?.trim();
    if (!enrollment) {
      throw new UnprocessableEntityException('Matrícula é obrigatória');
    }
    const user = await this.prismaService.users.findUnique({
      where: { suap_enrollment: enrollment },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return this.summary(user.id, date);
  }

  async period(userId: string, from?: string, to?: string) {
    if (!from || !to) {
      throw new UnprocessableEntityException('Período é obrigatório');
    }

    const start = resolveDay(from);
    const end = resolveDay(to);
    if (end.utcDay < start.utcDay) {
      throw new UnprocessableEntityException(
        'A data final precisa ser igual ou posterior à inicial',
      );
    }

    const dates = eachDay(start.date, end.date);
    if (dates.length > 31) {
      throw new UnprocessableEntityException(
        'O período pode ter no máximo 31 dias',
      );
    }

    const days = [];
    for (const date of dates) {
      days.push(await this.summary(userId, date));
    }

    const groups = aggregateGroups(days);
    const totals = totalsOf(groups);

    return {
      from: start.date,
      to: end.date,
      ...totals,
      groups,
      days,
    };
  }

  async periodByEnrollment(
    suapEnrollment?: string,
    from?: string,
    to?: string,
  ) {
    const enrollment = suapEnrollment?.trim();
    if (!enrollment) {
      throw new UnprocessableEntityException('Matrícula é obrigatória');
    }

    const user = await this.prismaService.users.findUnique({
      where: { suap_enrollment: enrollment },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');

    return this.period(user.id, from, to);
  }

  async allowanceGroups(userId: string) {
    const groups = await this.groupsService.findActive(userId);
    return groups.map((group) => ({ id: group.id, name: group.name }));
  }

  async requestAllowance(
    userId: string,
    input: { date?: string; groupId?: string; reason?: string },
    files: Express.Multer.File[] = [],
  ) {
    const groupId = input.groupId?.trim();
    const reason = input.reason?.trim();
    const day = resolveDay(input.date);
    if (!groupId || !reason) {
      throw new UnprocessableEntityException('Grupo, dia e motivo são obrigatórios');
    }
    if (reason.length > 500) {
      throw new UnprocessableEntityException('O motivo pode ter no máximo 500 caracteres');
    }
    if (day.date > fortalezaDate(new Date())) {
      throw new UnprocessableEntityException('O abono não pode ser pedido para um dia futuro');
    }

    const membership = await this.prismaService.users_groups.findFirst({
      where: { user_id: userId, group_id: groupId, groups: { status: true } },
    });
    if (!membership) throw new UnprocessableEntityException('Grupo inválido');

    const pending = await this.prismaService.time_allowances.findFirst({
      where: { user_id: userId, group_id: groupId, day: day.utcDay, status: 'PENDENTE' },
    });
    if (pending) {
      throw new UnprocessableEntityException('Já existe um abono pendente neste dia e grupo');
    }

    const records = await this.prismaService.time_records.findMany({
      where: { user_id: userId, recorded_at: { gte: day.start, lt: day.end } },
      include: { early_exit_justifications: { select: { status: true } } },
      orderBy: { recorded_at: 'asc' },
    });
    if (hasOpenGroupEntry(records, groupId)) {
      throw new UnprocessableEntityException('A entrada deste grupo ainda está aberta');
    }

    const summary = await this.summary(userId, day.date);
    const line = summary.groups.find((group) => group.id === groupId);
    const missing =
      line?.expectedMinutes == null ? null : line.expectedMinutes - line.workedMinutes;
    if (missing == null || missing <= 0) {
      throw new UnprocessableEntityException('Não há horas em falta neste dia');
    }

    const documents = files.map((file) => {
      const content = new Uint8Array(file.buffer.byteLength);
      content.set(file.buffer);
      return {
        fileName: safeFileName(file.originalname, file.mimetype),
        mimeType: file.mimetype,
        sizeBytes: file.size,
        content,
      };
    });
    const now = new Date();
    const allowanceId = randomUUID();
    const created = await this.prismaService.$transaction(async (tx) => {
      await tx.time_allowances.create({
        data: {
          id: allowanceId,
          user_id: userId,
          group_id: groupId,
          day: day.utcDay,
          minutes: missing,
          reason,
          created_at: now,
          updated_at: now,
        },
      });
      if (documents.length > 0) {
        await tx.allowance_documents.createMany({
          data: documents.map((document) => ({
            id: randomUUID(),
            allowance_id: allowanceId,
            file_name: document.fileName,
            mime_type: document.mimeType,
            size_bytes: document.sizeBytes,
            content: document.content,
            created_at: now,
          })),
        });
      }
      return tx.time_allowances.findUniqueOrThrow({
        where: { id: allowanceId },
        include: allowanceInclude,
      });
    });
    return toAllowance(created);
  }

  async readAllowanceDocument(allowanceId: string, documentId: string) {
    const document = await this.prismaService.allowance_documents.findFirst({
      where: { id: documentId, allowance_id: allowanceId },
    });
    if (!document) throw new NotFoundException('Documento não encontrado');
    return document;
  }

  async listAllowances() {
    const rows = await this.prismaService.time_allowances.findMany({
      include: allowanceInclude,
      orderBy: { created_at: 'desc' },
    });
    return rows.map(toAllowance);
  }

  async reviewAllowance(
    reviewerId: string,
    input: { id?: string; status?: string },
  ) {
    const id = input.id?.trim();
    if (!id || (input.status !== 'APROVADO' && input.status !== 'RECUSADO')) {
      throw new UnprocessableEntityException('Abono e decisão são obrigatórios');
    }
    const item = await this.prismaService.time_allowances.findUnique({ where: { id } });
    if (!item) throw new NotFoundException('Abono não encontrado');
    if (item.user_id === reviewerId) {
      throw new ConflictException('Não é possível analisar o próprio abono');
    }
    if (item.status !== 'PENDENTE') {
      throw new UnprocessableEntityException('O abono já foi analisado');
    }

    const now = new Date();
    const updated = await this.prismaService.time_allowances.update({
      where: { id: item.id },
      data: {
        status: input.status,
        reviewer_id: reviewerId,
        reviewed_at: now,
        updated_at: now,
      },
      include: allowanceInclude,
    });
    return toAllowance(updated);
  }
}

function entryWindowMessage(
  group:
    | { startTime: string | null; endTime: string | null }
    | { startTime: string | null; endTime: string | null }[],
) {
  const only = Array.isArray(group) ? (group.length === 1 ? group[0] : null) : group;
  if (only?.startTime && only.endTime) {
    return `A entrada só pode ser registrada entre ${only.startTime} e ${only.endTime}`;
  }
  return 'A entrada está fora do horário do grupo';
}

function isRecordType(value: string): value is TimeRecordType {
  return (RECORD_TYPES as readonly string[]).includes(value);
}

type ReviewStatus = 'APROVADA' | 'APROVADA_PARCIAL' | 'RECUSADA';

function isReviewStatus(value?: string): value is ReviewStatus {
  return value === 'APROVADA' || value === 'APROVADA_PARCIAL' || value === 'RECUSADA';
}

function isRefusedExit(record?: { type: string; early_exit_justifications?: { status: string } | null } | null) {
  return record?.type === 'saida' && record.early_exit_justifications?.status === 'RECUSADA';
}

const justificationInclude = {
  users: { select: { id: true, suap_enrollment: true, name: true } },
  reviewer: { select: { name: true } },
  time_records: {
    select: {
      recorded_at: true,
      groups: { select: { name: true } },
    },
  },
} as const;

function toJustification(row: {
  id: string;
  scheduled_end: string;
  reason: string | null;
  status: 'PENDENTE' | 'APROVADA' | 'APROVADA_PARCIAL' | 'RECUSADA';
  makeup_date: Date | null;
  makeup_start: string | null;
  makeup_end: string | null;
  reviewed_at: Date | null;
  users: { id: string; suap_enrollment: string; name: string | null };
  reviewer: { name: string | null } | null;
  time_records: { recorded_at: Date; groups: { name: string } | null };
}) {
  return {
    id: row.id,
    userId: row.users.id,
    suapEnrollment: row.users.suap_enrollment,
    name: row.users.name,
    groupName: row.time_records.groups?.name ?? null,
    recordedAt: row.time_records.recorded_at,
    scheduledEnd: row.scheduled_end,
    reason: row.reason,
    status: row.status,
    makeupDate: dateOnly(row.makeup_date),
    makeupStart: row.makeup_start,
    makeupEnd: row.makeup_end,
    reviewerName: row.reviewer?.name ?? null,
    reviewedAt: row.reviewed_at,
  };
}

function makeupWindow(
  item: { scheduled_end: string; time_records: { recorded_at: Date } },
  makeupDate?: string,
  makeupStart?: string,
) {
  const date = makeupDate?.trim();
  const start = parseClock(makeupStart?.trim().slice(0, 5));
  const punchDay = fortalezaDate(item.time_records.recorded_at);
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !start) {
    throw new UnprocessableEntityException('Data e horário do acerto são obrigatórios');
  }
  if (date <= punchDay) {
    throw new UnprocessableEntityException('A data do acerto precisa ser posterior à saída');
  }

  const exitClock = fortalezaClock(item.time_records.recorded_at);
  const gap = clockMinutes(item.scheduled_end) - clockMinutes(exitClock);
  if (gap <= 0) {
    throw new UnprocessableEntityException('Não há horas restantes para acertar');
  }
  const end = start.hours * 60 + start.minutes + gap;
  if (end >= 24 * 60) {
    throw new UnprocessableEntityException('O horário de início precisa deixar o acerto no mesmo dia');
  }

  return {
    date: parseUtcDate(date),
    start: start.text,
    end: minutesToClock(end),
  };
}

function assertCanRefuse(item: { scheduled_end: string; time_records: { recorded_at: Date } }) {
  const punchDay = fortalezaDate(item.time_records.recorded_at);
  const today = fortalezaDate(new Date());
  if (punchDay !== today || fortalezaClock() >= item.scheduled_end) {
    throw new UnprocessableEntityException(
      'Depois do fim do expediente, escolha aprovação ou aprovação parcial',
    );
  }
}

function clockMinutes(value: string) {
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}

function minutesToClock(total: number) {
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function parseUtcDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function dateOnly(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

function entryBefore<T extends { type: string; early_exit_justifications?: { status: string } | null }>(
  records: T[],
  index: number,
) {
  if (records[index]?.type !== 'saida') return null;
  for (let cursor = index + 1; cursor < records.length; cursor += 1) {
    const candidate = records[cursor];
    if (isRefusedExit(candidate)) continue;
    return candidate?.type === 'entrada' ? candidate : null;
  }
  return null;
}

function toRecord(
  record: {
    id: string;
    type: string;
    recorded_at: Date;
    created_at: Date;
    activity: string | null;
  },
  qrCode: { id: string; location: string },
  entry?: { id: string; recorded_at: Date } | null,
  group?: { id: string; name: string } | null,
  justification?: {
    scheduled_end: string;
    reason: string | null;
    status: 'PENDENTE' | 'APROVADA' | 'APROVADA_PARCIAL' | 'RECUSADA';
    makeup_date?: Date | null;
    makeup_start?: string | null;
    makeup_end?: string | null;
  } | null,
) {
  return {
    id: record.id,
    type: record.type,
    recordedAt: record.recorded_at,
    createdAt: record.created_at,
    activity: record.activity,
    entry: entry ? { id: entry.id, recordedAt: entry.recorded_at } : null,
    group: group ? { id: group.id, name: group.name } : null,
    qrCode: {
      id: qrCode.id,
      location: qrCode.location,
    },
    earlyExit: justification
      ? {
          scheduledEnd: justification.scheduled_end,
          reason: justification.reason,
          status: justification.status,
          makeupDate: dateOnly(justification.makeup_date ?? null),
          makeupStart: justification.makeup_start ?? null,
          makeupEnd: justification.makeup_end ?? null,
        }
      : null,
  };
}

type GroupHours = {
  id: string | null;
  name: string;
  startTime: string | null;
  endTime: string | null;
  workedMinutes: number;
  expectedMinutes: number | null;
  remainingMinutes?: number | null;
  scheduleVaries: boolean;
};

type PunchRecord = {
  type: string;
  recorded_at: Date;
  group_id: string | null;
  groups: {
    id: string;
    name: string;
    start_time: string | null;
    end_time: string | null;
    daily_workload_minutes: number;
  } | null;
  early_exit_justifications?: { status: string } | null;
};

function groupKey(groupId: string | null | undefined) {
  return groupId ?? '';
}

function plansFrom(
  groups: {
    id: string;
    name: string;
    start_time: string | null;
    end_time: string | null;
    daily_workload_minutes: number;
  }[],
  adjustments: {
    group_id: string | null;
    start_time: string | null;
    end_time: string | null;
    daily_workload_minutes: number;
  }[],
) {
  const legacy = adjustments.find((item) => !item.group_id);
  const specific = adjustments.filter((item) => item.group_id);

  if (groups.length === 0) {
    if (!legacy) return [];
    return [
      {
        key: '',
        hours: {
          id: null,
          name: 'Ajuste individual',
          startTime: legacy.start_time,
          endTime: legacy.end_time,
          expectedMinutes: legacy.daily_workload_minutes,
        },
      },
    ];
  }

  return groups.map((group) => {
    const adjustment = specific.find((item) => item.group_id === group.id);
    const useLegacy = groups.length === 1 && legacy && specific.length === 0;
    const source = useLegacy ? legacy : adjustment;
    return {
      key: group.id,
      hours: {
        id: group.id,
        name: group.name,
        startTime: source?.start_time ?? group.start_time,
        endTime: source?.end_time ?? group.end_time,
        expectedMinutes: source?.daily_workload_minutes ?? group.daily_workload_minutes,
      },
    };
  });
}

function workedByGroup(records: PunchRecord[], end: Date) {
  const totals = new Map<string, number>();
  let open: { at: Date; key: string } | null = null;
  const add = (key: string, start: Date, finish: Date) => {
    totals.set(key, (totals.get(key) ?? 0) + minutesBetween(start, finish));
  };

  for (const record of records) {
    if (isRefusedExit(record)) continue;
    if (record.type === 'entrada') {
      open = { at: record.recorded_at, key: groupKey(record.group_id) };
      continue;
    }
    if (record.type === 'saida' && open) {
      add(open.key, open.at, record.recorded_at);
      open = null;
    }
  }

  if (open) {
    const limit = new Date() < end ? new Date() : end;
    add(open.key, open.at, limit);
  }

  return totals;
}

function creditAllowances(
  groups: (GroupHours & { remainingMinutes: number | null })[],
  allowances: { group_id: string; minutes: number; status: string }[],
) {
  const extra = new Map<string, number>();
  for (const item of allowances) {
    if (item.status !== 'APROVADO') continue;
    const key = groupKey(item.group_id);
    extra.set(key, (extra.get(key) ?? 0) + item.minutes);
  }
  return groups.map((line) => {
    const add = extra.get(groupKey(line.id)) ?? 0;
    if (!add || line.expectedMinutes === null) return line;
    const room = Math.max(0, line.expectedMinutes - line.workedMinutes);
    const workedMinutes = line.workedMinutes + Math.min(add, room);
    return {
      ...line,
      workedMinutes,
      remainingMinutes: line.expectedMinutes - workedMinutes,
    };
  });
}

function hasOpenGroupEntry(
  records: { type: string; group_id: string | null; early_exit_justifications?: { status: string } | null }[],
  groupId: string,
) {
  let open = false;
  for (const record of records) {
    if (isRefusedExit(record)) continue;
    if (record.type === 'entrada' && record.group_id === groupId) open = true;
    if (record.type === 'saida' && open) open = false;
  }
  return open;
}

const allowanceInclude = {
  users: { select: { id: true, suap_enrollment: true, name: true } },
  reviewer: { select: { name: true } },
  groups: { select: { id: true, name: true } },
  allowance_documents: { select: { id: true, file_name: true } },
} as const;

function safeFileName(original: string, mimeType: string) {
  const base = original.split(/[/\\]/).pop()?.replace(/[^\w.\- ()áàâãéêíóôõúçÁÀÂÃÉÊÍÓÔÕÚÇ]/g, '') || 'documento';
  const trimmed = base.slice(0, 180);
  const extension = mimeType === 'application/pdf' ? '.pdf' : mimeType === 'image/png' ? '.png' : mimeType === 'image/webp' ? '.webp' : '.jpg';
  return trimmed.toLowerCase().endsWith(extension) ? trimmed : `${trimmed}${extension}`;
}

function toAllowance(row: {
  id: string;
  minutes: number;
  reason: string;
  status: 'PENDENTE' | 'APROVADO' | 'RECUSADO';
  day: Date;
  reviewed_at: Date | null;
  users: { id: string; suap_enrollment: string; name: string | null };
  reviewer: { name: string | null } | null;
  groups: { id: string; name: string };
  allowance_documents: { id: string; file_name: string }[];
}) {
  return {
    id: row.id,
    userId: row.users.id,
    suapEnrollment: row.users.suap_enrollment,
    name: row.users.name,
    groupId: row.groups.id,
    groupName: row.groups.name,
    day: dateOnly(row.day),
    minutes: row.minutes,
    reason: row.reason,
    status: row.status,
    documents: row.allowance_documents.map((document) => ({
      id: document.id,
      fileName: document.file_name,
    })),
    reviewerName: row.reviewer?.name ?? null,
    reviewedAt: row.reviewed_at,
  };
}

function creditApproved(
  groups: (GroupHours & { remainingMinutes: number | null })[],
  records: PunchRecord[],
) {
  const approved = new Set(
    records
      .filter(
        (record) =>
          record.type === 'saida' && record.early_exit_justifications?.status === 'APROVADA',
      )
      .map((record) => groupKey(record.group_id)),
  );
  return groups.map((line) => {
    if (!approved.has(groupKey(line.id)) || line.expectedMinutes === null) return line;
    const workedMinutes = Math.max(line.workedMinutes, line.expectedMinutes);
    return {
      ...line,
      workedMinutes,
      remainingMinutes: line.expectedMinutes - workedMinutes,
    };
  });
}

function totalsOf(groups: { workedMinutes: number; expectedMinutes: number | null }[]) {
  const known = groups
    .map((group) => group.expectedMinutes)
    .filter((value): value is number => value !== null);
  const workedMinutes = groups.reduce((total, group) => total + group.workedMinutes, 0);
  const expectedMinutes =
    known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
  return {
    workedMinutes,
    expectedMinutes,
    remainingMinutes:
      expectedMinutes === null ? null : expectedMinutes - workedMinutes,
  };
}

function aggregateGroups(
  days: { groups: (GroupHours & { remainingMinutes: number | null })[] }[],
) {
  const order: string[] = [];
  const merged = new Map<
    string,
    GroupHours & { scheduleKey: string }
  >();

  for (const day of days) {
    for (const group of day.groups) {
      const key = group.id ?? `legacy:${group.name}`;
      const scheduleKey = `${group.startTime ?? ''}|${group.endTime ?? ''}`;
      const current = merged.get(key);
      if (!current) {
        order.push(key);
        merged.set(key, { ...group, scheduleKey, scheduleVaries: false });
        continue;
      }
      current.workedMinutes += group.workedMinutes;
      if (current.expectedMinutes === null && group.expectedMinutes === null) {
        current.expectedMinutes = null;
      } else {
        current.expectedMinutes =
          (current.expectedMinutes ?? 0) + (group.expectedMinutes ?? 0);
      }
      if (current.scheduleKey !== scheduleKey) {
        current.scheduleVaries = true;
        current.startTime = null;
        current.endTime = null;
      }
    }
  }

  return order.map((key) => {
    const group = merged.get(key)!;
    return {
      id: group.id,
      name: group.name,
      startTime: group.startTime,
      endTime: group.endTime,
      workedMinutes: group.workedMinutes,
      expectedMinutes: group.expectedMinutes,
      remainingMinutes:
        group.expectedMinutes === null
          ? null
          : group.expectedMinutes - group.workedMinutes,
      scheduleVaries: group.scheduleVaries,
    };
  });
}

function minutesBetween(start: Date, end: Date) {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
}

function resolveDay(date?: string) {
  const value = date ?? brazilToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new UnprocessableEntityException('Data inválida');
  }

  const [year, month, day] = value.split('-').map(Number);
  const utcDay = new Date(Date.UTC(year, month - 1, day));
  const valid =
    utcDay.getUTCFullYear() === year &&
    utcDay.getUTCMonth() === month - 1 &&
    utcDay.getUTCDate() === day;

  if (!valid) throw new UnprocessableEntityException('Data inválida');

  const start = new Date(Date.UTC(year, month - 1, day, 3, 0, 0));
  return {
    date: value,
    utcDay,
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
  };
}

function eachDay(from: string, to: string) {
  const [fromYear, fromMonth, fromDay] = from.split('-').map(Number);
  const [toYear, toMonth, toDay] = to.split('-').map(Number);
  const cursor = new Date(Date.UTC(fromYear, fromMonth - 1, fromDay));
  const end = new Date(Date.UTC(toYear, toMonth - 1, toDay));
  const dates: string[] = [];

  while (cursor <= end) {
    const year = cursor.getUTCFullYear();
    const month = String(cursor.getUTCMonth() + 1).padStart(2, '0');
    const day = String(cursor.getUTCDate()).padStart(2, '0');
    dates.push(`${year}-${month}-${day}`);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  return dates;
}

function brazilToday() {
  return fortalezaDate(new Date());
}

function fortalezaDate(date: Date) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
