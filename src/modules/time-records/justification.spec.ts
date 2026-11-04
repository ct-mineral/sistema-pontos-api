import { describe, expect, it } from 'vitest';
import { makeupWindow } from './justification.js';

describe('makeupWindow', () => {
  it('usa os minutos faltantes registrados na justificativa', () => {
    const result = makeupWindow(
      {
        scheduled_end: '18:00',
        missing_minutes: 30,
        time_records: { recorded_at: new Date('2026-11-04T19:00:00.000Z') },
      },
      '2026-11-05',
      '08:00',
    );

    expect(result.start).toBe('08:00');
    expect(result.end).toBe('08:30');
  });

  it('mantém compatibilidade com justificativas antigas', () => {
    const result = makeupWindow(
      {
        scheduled_end: '17:00',
        missing_minutes: null,
        time_records: { recorded_at: new Date('2026-11-04T19:00:00.000Z') },
      },
      '2026-11-05',
      '08:00',
    );

    expect(result.end).toBe('09:00');
  });
});
