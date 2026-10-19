import { UnprocessableEntityException } from '@nestjs/common';
import { clockMinutes, fortalezaClock, fortalezaDate, minutesToClock, parseClock } from '../../common/clock.js';
import { dateOnly, parseUtcDate } from './day.js';

export const justificationInclude = {
  users: { select: { id: true, suap_enrollment: true, name: true } },
  reviewer: { select: { name: true } },
  time_records: {
    select: {
      recorded_at: true,
      groups: { select: { name: true } },
    },
  },
} as const;

type ReviewStatus = 'APROVADA' | 'APROVADA_PARCIAL' | 'RECUSADA';

export function isReviewStatus(value?: string): value is ReviewStatus {
  return value === 'APROVADA' || value === 'APROVADA_PARCIAL' || value === 'RECUSADA';
}

export function toJustification(row: {
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

export function makeupWindow(
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

export function assertCanRefuse(item: { scheduled_end: string; time_records: { recorded_at: Date } }) {
  const punchDay = fortalezaDate(item.time_records.recorded_at);
  const today = fortalezaDate(new Date());
  if (punchDay !== today || fortalezaClock() >= item.scheduled_end) {
    throw new UnprocessableEntityException(
      'Depois do fim do expediente, escolha aprovação ou aprovação parcial',
    );
  }
}
