export type Clock = {
  hours: number;
  minutes: number;
  text: string;
};

const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function parseClock(value?: string): Clock | null {
  const text = value?.trim();
  if (!text || !CLOCK.test(text)) return null;

  const [hours, minutes] = text.split(':').map(Number);
  return {
    hours,
    minutes,
    text: formatClock(hours, minutes),
  };
}

export function minutesBetween(start: Clock, end: Clock) {
  const minutes =
    end.hours * 60 + end.minutes - (start.hours * 60 + start.minutes);
  return minutes > 0 ? minutes : null;
}

function formatClock(hours: number, minutes: number) {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
