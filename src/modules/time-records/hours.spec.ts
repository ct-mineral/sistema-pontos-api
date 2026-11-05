import { describe, expect, it } from 'vitest';
import { workedByGroup } from './hours.js';

const schedule = [
  {
    key: 'group-1',
    hours: { breakStartTime: '12:00', breakEndTime: '13:00' },
  },
];

function record(type: string, recordedAt: string) {
  return {
    type,
    recorded_at: new Date(recordedAt),
    group_id: 'group-1',
    groups: null,
  };
}

describe('workedByGroup', () => {
  it('desconta o intervalo de uma entrada e saída contínuas', () => {
    const records = [
      record('entrada', '2026-11-03T11:00:00.000Z'),
      record('saida', '2026-11-03T20:00:00.000Z'),
    ];

    expect(
      workedByGroup(records, new Date('2026-11-03T23:59:00.000Z'), schedule),
    ).toEqual(new Map([['group-1', 480]]));
  });

  it('não desconta duas vezes quando o intervalo já foi registrado', () => {
    const records = [
      record('entrada', '2026-11-03T11:00:00.000Z'),
      record('saida', '2026-11-03T15:00:00.000Z'),
      record('entrada', '2026-11-03T16:00:00.000Z'),
      record('saida', '2026-11-03T20:00:00.000Z'),
    ];

    expect(
      workedByGroup(records, new Date('2026-11-03T23:59:00.000Z'), schedule),
    ).toEqual(new Map([['group-1', 480]]));
  });
});
