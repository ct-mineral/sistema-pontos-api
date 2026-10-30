import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Express } from 'express';
import { clockContains, fortalezaClock, fortalezaDate } from '../../common/clock.js';
import { PrismaService } from '../../infra/prisma/prisma.service.js';
import { QrCodesService } from '../qr-codes/qr-codes.service.js';
import { allowanceInclude, safeFileName, toAllowance } from './allowance.js';
import { RECORD_TYPES } from './constants/record-types.constants.js';
import { dateOnly, eachDay, resolveDay } from './day.js';
import { GroupsService } from '../groups/groups.service.js';
import {
  aggregateGroups,
  creditAllowances,
  creditApproved,
  groupKey,
  hasOpenGroupEntry,
  plansFrom,
  punchIntervals,
  type GroupHours,
  type PunchRecord,
  totalsOf,
  workedByGroup,
} from './hours.js';
import {
  assertCanRefuse,
  isReviewStatus,
  justificationInclude,
  makeupWindow,
  toJustification,
} from './justification.js';
import { entryBefore, isRefusedExit, toRecord } from './sequence.js';
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
      intervals: punchIntervals(records).map((interval) => ({
        entryAt: interval.entryAt,
        exitAt: interval.exitAt,
        groupId: interval.groupId,
        description: interval.description,
        refused: interval.refused,
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
            groupId: record.group_id,
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
    const user = await this.userByEnrollment(suapEnrollment);
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
    const user = await this.userByEnrollment(suapEnrollment);
    return this.period(user.id, from, to);
  }

  private async userByEnrollment(suapEnrollment?: string) {
    const enrollment = suapEnrollment?.trim();
    if (!enrollment) {
      throw new UnprocessableEntityException('Matrícula é obrigatória');
    }
    const user = await this.prismaService.users.findUnique({
      where: { suap_enrollment: enrollment },
    });
    if (!user) throw new NotFoundException('Usuário não encontrado');
    return user;
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

