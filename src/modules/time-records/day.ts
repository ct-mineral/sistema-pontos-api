import { UnprocessableEntityException } from '@nestjs/common';
import { parseCalendarDate } from '../../common/calendar.js';
import { fortalezaDate } from '../../common/clock.js';

export function parseUtcDate(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

export function dateOnly(value: Date | null) {
  return value ? value.toISOString().slice(0, 10) : null;
}

export function resolveDay(date?: string) {
  const value = date ?? fortalezaDate(new Date());
  const utcDay = parseCalendarDate(value);
  if (!utcDay) throw new UnprocessableEntityException('Data inválida');

  const start = new Date(utcDay.getTime() + 3 * 60 * 60 * 1000);
  return {
    date: value,
    utcDay,
    start,
    end: new Date(start.getTime() + 24 * 60 * 60 * 1000),
  };
}

export function eachDay(from: string, to: string) {
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
