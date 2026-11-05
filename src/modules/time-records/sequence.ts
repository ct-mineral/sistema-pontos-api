import { dateOnly } from './day.js';

export function isRefusedExit(
  record?: {
    type: string;
    early_exit_justifications?: { status: string } | null;
  } | null,
) {
  return (
    record?.type === 'saida' &&
    record.early_exit_justifications?.status === 'RECUSADA'
  );
}

export function entryBefore<
  T extends {
    type: string;
    early_exit_justifications?: { status: string } | null;
  },
>(records: T[], index: number) {
  if (records[index]?.type !== 'saida') return null;
  for (let cursor = index + 1; cursor < records.length; cursor += 1) {
    const candidate = records[cursor];
    if (isRefusedExit(candidate)) continue;
    return candidate?.type === 'entrada' ? candidate : null;
  }
  return null;
}

export function toRecord(
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
    missing_minutes?: number | null;
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
          missingMinutes: justification.missing_minutes ?? null,
          reason: justification.reason,
          status: justification.status,
          makeupDate: dateOnly(justification.makeup_date ?? null),
          makeupStart: justification.makeup_start ?? null,
          makeupEnd: justification.makeup_end ?? null,
        }
      : null,
  };
}
