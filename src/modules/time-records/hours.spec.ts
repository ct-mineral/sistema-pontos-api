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
  it('conta o período real quando não há pausa registrada', () => {
    const records = [
      record('entrada', '2026-11-03T11:00:00.000Z'),
      record('saida', '2026-11-03T20:00:00.000Z'),
    ];

    expect(
      workedByGroup(records, new Date('2026-11-03T23:59:00.000Z'), schedule),
    ).toEqual(new Map([['group-1', 540]]));
  });

  it('desconta somente a pausa e o retorno registrados', () => {
    const records = [
      record('entrada', '2026-11-03T11:00:00.000Z'),
      record('pausa', '2026-11-03T15:00:00.000Z'),
      record('retorno', '2026-11-03T16:00:00.000Z'),
      record('saida', '2026-11-03T20:00:00.000Z'),
    ];

    expect(
      workedByGroup(records, new Date('2026-11-03T23:59:00.000Z'), schedule),
    ).toEqual(new Map([['group-1', 480]]));
  });

  it('preserva o excedente da carga como tempo real trabalhado', () => {
    const records = [
      record('entrada', '2026-11-03T08:00:00.000Z'),
      record('saida', '2026-11-03T18:00:00.000Z'),
    ];

    expect(
      workedByGroup(records, new Date('2026-11-03T23:59:00.000Z'), []),
    ).toEqual(new Map([['group-1', 600]]));
  });
});
