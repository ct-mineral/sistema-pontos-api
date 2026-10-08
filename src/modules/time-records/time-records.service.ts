import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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

  async create(userId: string, input: { code?: string; type?: string }) {
    const code = input.code?.trim();
    if (!code || !input.type || !isRecordType(input.type)) {
      throw new UnprocessableEntityException('Código e tipo são obrigatórios');
    }

    const qrCode = await this.qrCodesService.findActiveById(code);

    const last = await this.prismaService.time_records.findFirst({
      where: { user_id: userId },
      orderBy: { recorded_at: 'desc' },
    });

    if ((!last && input.type !== 'entrada') || last?.type === input.type) {
      throw new UnprocessableEntityException('Sequência de batida inválida');
    }

    const now = new Date();
    const record = await this.prismaService.time_records.create({
      data: {
        id: randomUUID(),
        user_id: userId,
        qr_code_id: qrCode.id,
        type: input.type,
        recorded_at: now,
        created_at: now,
      },
    });

    const entry =
      input.type === 'saida' ? await this.previousEntry(userId, record.recorded_at) : null;
    return toRecord(record, qrCode, entry);
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
      include: { qr_codes: true },
    });

    return toRecord(updated, updated.qr_codes, entry);
  }

  async listMine(userId: string) {
    const records = await this.prismaService.time_records.findMany({
      where: { user_id: userId },
      include: { qr_codes: true },
      orderBy: { recorded_at: 'desc' },
    });

    return records.map((record, index) => {
      const previous = records[index + 1];
      const entry =
        record.type === 'saida' && previous?.type === 'entrada' ? previous : null;
      return toRecord(record, record.qr_codes, entry);
    });
  }

  private async previousEntry(userId: string, recordedAt: Date) {
    const previous = await this.prismaService.time_records.findFirst({
      where: { user_id: userId, recorded_at: { lt: recordedAt } },
      orderBy: { recorded_at: 'desc' },
    });
    if (previous?.type !== 'entrada') return null;
    return previous;
  }

  async summary(userId: string, date?: string) {
    const day = resolveDay(date);
    const records = await this.prismaService.time_records.findMany({
      where: {
        user_id: userId,
        recorded_at: { gte: day.start, lt: day.end },
      },
      orderBy: { recorded_at: 'asc' },
    });
    const workedMinutes = workedMinutesFrom(records, day.end);
    const adjustment = await this.workloadAdjustmentsService.findCovering(
      userId,
      day.utcDay,
    );
    const group = adjustment
      ? null
      : await this.groupsService.findMembership(userId);
    const expectedMinutes =
      adjustment?.daily_workload_minutes ??
      group?.daily_workload_minutes ??
      null;
    return {
      date: day.date,
      workedMinutes,
      expectedMinutes,
      remainingMinutes:
        expectedMinutes === null ? null : expectedMinutes - workedMinutes,
    };
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

    const workedMinutes = days.reduce(
      (total, day) => total + day.workedMinutes,
      0,
    );
    const expectedMinutes = days.every((day) => day.expectedMinutes !== null)
      ? days.reduce((total, day) => total + (day.expectedMinutes ?? 0), 0)
      : null;

    return {
      from: start.date,
      to: end.date,
      workedMinutes,
      expectedMinutes,
      remainingMinutes:
        expectedMinutes === null ? null : expectedMinutes - workedMinutes,
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
}

function isRecordType(value: string): value is TimeRecordType {
  return (RECORD_TYPES as readonly string[]).includes(value);
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
) {
  return {
    id: record.id,
    type: record.type,
    recordedAt: record.recorded_at,
    createdAt: record.created_at,
    activity: record.activity,
    entry: entry ? { id: entry.id, recordedAt: entry.recorded_at } : null,
    qrCode: {
      id: qrCode.id,
      location: qrCode.location,
    },
  };
}

function workedMinutesFrom(
  records: { type: string; recorded_at: Date }[],
  end: Date,
) {
  let open: Date | null = null;
  let minutes = 0;

  for (const record of records) {
    if (record.type === 'entrada') {
      open = record.recorded_at;
      continue;
    }

    if (record.type === 'saida' && open) {
      minutes += minutesBetween(open, record.recorded_at);
      open = null;
    }
  }

  if (open) {
    const limit = new Date() < end ? new Date() : end;
    minutes += minutesBetween(open, limit);
  }

  return minutes;
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
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Fortaleza',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
