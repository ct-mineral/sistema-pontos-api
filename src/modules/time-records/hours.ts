import { isRefusedExit } from './sequence.js';
import { clockMinutes, fortalezaDate } from '../../common/clock.js';

export type GroupHours = {
  id: string | null;
  name: string;
  startTime: string | null;
  endTime: string | null;
  breakStartTime: string | null;
  breakEndTime: string | null;
  workedMinutes: number;
  expectedMinutes: number | null;
  remainingMinutes?: number | null;
  scheduleVaries: boolean;
};

export type PunchRecord = {
  type: string;
  recorded_at: Date;
  group_id: string | null;
  groups: {
    id: string;
    name: string;
    start_time: string | null;
    end_time: string | null;
    break_start_time: string | null;
    break_end_time: string | null;
    daily_workload_minutes: number;
  } | null;
  early_exit_justifications?: { status: string } | null;
};

export function groupKey(groupId: string | null | undefined) {
  return groupId ?? '';
}

export function plansFrom(
  groups: {
    id: string;
    name: string;
    start_time: string | null;
    end_time: string | null;
    break_start_time: string | null;
    break_end_time: string | null;
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
          breakStartTime: null,
          breakEndTime: null,
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
        breakStartTime: group.break_start_time,
        breakEndTime: group.break_end_time,
        expectedMinutes:
          source?.daily_workload_minutes ?? group.daily_workload_minutes,
      },
    };
  });
}

export function workedByGroup(
  records: PunchRecord[],
  end: Date,
  schedules: {
    key: string;
    hours: Pick<GroupHours, 'breakStartTime' | 'breakEndTime'>;
  }[] = [],
) {
  const totals = new Map<string, number>();
  const scheduleByGroup = new Map(
    schedules.map((schedule) => [schedule.key, schedule.hours]),
  );
  let open: {
    at: Date;
    key: string;
    breakStartTime: string | null;
    breakEndTime: string | null;
  } | null = null;
  const add = (
    key: string,
    start: Date,
    finish: Date,
    schedule?: Pick<GroupHours, 'breakStartTime' | 'breakEndTime'>,
  ) => {
    const breakStart = schedule?.breakStartTime;
    const breakEnd = schedule?.breakEndTime;
    totals.set(
      key,
      (totals.get(key) ?? 0) +
        elapsedMinutesExcludingBreak(start, finish, breakStart, breakEnd),
    );
  };

  for (const record of records) {
    if (isRefusedExit(record)) continue;
    if (record.type === 'entrada') {
      const key = groupKey(record.group_id);
      open = {
        at: record.recorded_at,
        key,
        breakStartTime:
          scheduleByGroup.get(key)?.breakStartTime ??
          record.groups?.break_start_time ??
          null,
        breakEndTime:
          scheduleByGroup.get(key)?.breakEndTime ??
          record.groups?.break_end_time ??
          null,
      };
      continue;
    }
    if (record.type === 'saida' && open) {
      add(open.key, open.at, record.recorded_at, open);
      open = null;
    }
  }

  if (open) {
    const limit = new Date() < end ? new Date() : end;
    add(open.key, open.at, limit, open);
  }

  return totals;
}

export function creditAllowances(
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

export function hasOpenGroupEntry(
  records: {
    type: string;
    group_id: string | null;
    early_exit_justifications?: { status: string } | null;
  }[],
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

export function creditApproved(
  groups: (GroupHours & { remainingMinutes: number | null })[],
  records: PunchRecord[],
) {
  const approved = new Set(
    records
      .filter(
        (record) =>
          record.type === 'saida' &&
          record.early_exit_justifications?.status === 'APROVADA',
      )
      .map((record) => groupKey(record.group_id)),
  );
  return groups.map((line) => {
    if (!approved.has(groupKey(line.id)) || line.expectedMinutes === null)
      return line;
    const workedMinutes = Math.max(line.workedMinutes, line.expectedMinutes);
    return {
      ...line,
      workedMinutes,
      remainingMinutes: line.expectedMinutes - workedMinutes,
    };
  });
}

export function totalsOf(
  groups: { workedMinutes: number; expectedMinutes: number | null }[],
) {
  const known = groups
    .map((group) => group.expectedMinutes)
    .filter((value): value is number => value !== null);
  const workedMinutes = groups.reduce(
    (total, group) => total + group.workedMinutes,
    0,
  );
  const expectedMinutes =
    known.length === 0
      ? null
      : known.reduce((total, value) => total + value, 0);
  return {
    workedMinutes,
    expectedMinutes,
    remainingMinutes:
      expectedMinutes === null ? null : expectedMinutes - workedMinutes,
  };
}

export function aggregateGroups(
  days: { groups: (GroupHours & { remainingMinutes: number | null })[] }[],
) {
  const order: string[] = [];
  const merged = new Map<string, GroupHours & { scheduleKey: string }>();

  for (const day of days) {
    for (const group of day.groups) {
      const key = group.id ?? `legacy:${group.name}`;
      const scheduleKey = `${group.startTime ?? ''}|${group.endTime ?? ''}|${group.breakStartTime ?? ''}|${group.breakEndTime ?? ''}`;
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
        current.breakStartTime = null;
        current.breakEndTime = null;
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
      breakStartTime: group.breakStartTime,
      breakEndTime: group.breakEndTime,
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

export type PunchInterval = {
  entryAt: Date | null;
  exitAt: Date | null;
  groupId: string | null;
  description: string | null;
  refused: boolean;
};

export function punchIntervals(
  records: {
    type: string;
    recorded_at: Date;
    group_id: string | null;
    activity?: string | null;
    early_exit_justifications?: { status: string } | null;
  }[],
): PunchInterval[] {
  const rows: PunchInterval[] = [];
  let open: { at: Date; groupId: string | null } | null = null;

  for (const record of records) {
    if (isRefusedExit(record)) {
      rows.push({
        entryAt: open?.at ?? null,
        exitAt: record.recorded_at,
        groupId: open?.groupId ?? record.group_id,
        description: record.activity ?? null,
        refused: true,
      });
      continue;
    }
    if (record.type === 'entrada') {
      open = { at: record.recorded_at, groupId: record.group_id };
      continue;
    }
    if (record.type === 'saida') {
      rows.push({
        entryAt: open?.at ?? null,
        exitAt: record.recorded_at,
        groupId: open?.groupId ?? record.group_id,
        description: record.activity ?? null,
        refused: false,
      });
      open = null;
    }
  }

  if (open) {
    rows.push({
      entryAt: open.at,
      exitAt: null,
      groupId: open.groupId,
      description: null,
      refused: false,
    });
  }

  return rows;
}

function elapsedMinutes(start: Date, end: Date) {
  return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 60000));
}

function elapsedMinutesExcludingBreak(
  start: Date,
  end: Date,
  breakStart: string | null | undefined,
  breakEnd: string | null | undefined,
) {
  const worked = elapsedMinutes(start, end);
  if (!breakStart || !breakEnd) return worked;

  const day = fortalezaDate(start);
  const breakStartAt = new Date(`${day}T${breakStart}:00-03:00`);
  const breakEndAt = new Date(`${day}T${breakEnd}:00-03:00`);
  if (
    Number.isNaN(breakStartAt.getTime()) ||
    Number.isNaN(breakEndAt.getTime())
  ) {
    return worked;
  }

  const startMinutes = clockMinutes(breakStart);
  const endMinutes = clockMinutes(breakEnd);
  if (endMinutes <= startMinutes) return worked;

  const overlapStart = Math.max(start.getTime(), breakStartAt.getTime());
  const overlapEnd = Math.min(end.getTime(), breakEndAt.getTime());
  const breakMinutes = Math.max(
    0,
    Math.floor((overlapEnd - overlapStart) / 60000),
  );
  return Math.max(0, worked - breakMinutes);
}
