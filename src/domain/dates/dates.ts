// UTC-only date arithmetic on ISO strings ("2027-06-01"). Night 0 is the night
// of the trip start date; a trip from the 1st to the 15th has nights 0..13.
// Local time is never consulted, so DST and the host timezone cannot shift results.

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MS_PER_DAY = 86_400_000;

function toEpochDay(iso: string): number | null {
  const match = ISO_DATE.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // setUTCFullYear avoids Date.UTC mapping years 0..99 onto 1900..1999.
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  // Round-trip rejects overflow such as 2027-02-30 silently becoming March.
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return Math.round(date.getTime() / MS_PER_DAY);
}

export function isValidIsoDate(iso: string): boolean {
  return toEpochDay(iso) !== null;
}

function requireEpochDay(iso: string): number {
  const day = toEpochDay(iso);
  if (day === null) throw new RangeError(`Not a valid ISO date (YYYY-MM-DD): "${iso}"`);
  return day;
}

/** Whole days from `start` to `end`. Negative when `end` is before `start`. */
export function nightsBetween(start: string, end: string): number {
  return requireEpochDay(end) - requireEpochDay(start);
}

/** Night index of `date` within a trip starting on `tripStart`. */
export function nightIndexOf(tripStart: string, date: string): number {
  return nightsBetween(tripStart, date);
}

/** The calendar date on which night `index` begins. */
export function dateOfNight(tripStart: string, index: number): string {
  if (!Number.isInteger(index)) throw new RangeError(`Night index must be an integer, got ${index}`);
  const date = new Date((requireEpochDay(tripStart) + index) * MS_PER_DAY);
  const y = String(date.getUTCFullYear()).padStart(4, "0");
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
