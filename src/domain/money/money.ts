/** ISO 4217 currency code, three uppercase letters (e.g. "CAD", "JPY"). */
export type CurrencyCode = string;

/**
 * An amount of money. `amountMinor` is an integer count of the currency's
 * minor unit: cents for CAD, whole yen for JPY.
 */
export interface Money {
  readonly amountMinor: number;
  readonly currency: CurrencyCode;
}

const CURRENCY_PATTERN = /^[A-Z]{3}$/;

export function money(amountMinor: number, currency: CurrencyCode): Money {
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`amountMinor must be a safe integer, got ${amountMinor}`);
  }
  if (!CURRENCY_PATTERN.test(currency)) {
    throw new RangeError(`currency must be three uppercase letters, got "${currency}"`);
  }
  return { amountMinor, currency };
}

export function addMoney(a: Money, b: Money): Money {
  if (a.currency !== b.currency) {
    throw new Error(`Cannot add ${a.currency} and ${b.currency}: currencies differ`);
  }
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function sumMoney(items: readonly Money[], currency: CurrencyCode): Money {
  let total = money(0, currency);
  for (const item of items) {
    if (item.currency !== currency) {
      throw new Error(`Cannot sum ${item.currency} into ${currency}: currencies differ`);
    }
    total = addMoney(total, item);
  }
  return total;
}

/** Decimal places in the currency's minor unit: 2 for CAD, 0 for JPY. */
export function minorUnitDigits(currency: CurrencyCode): number {
  const formatter = new Intl.NumberFormat("en-CA", { style: "currency", currency });
  return formatter.resolvedOptions().maximumFractionDigits ?? 2;
}

export function formatMoney(m: Money, locale = "en-CA"): string {
  const formatter = new Intl.NumberFormat(locale, {
    style: "currency",
    currency: m.currency,
  });
  return formatter.format(m.amountMinor / 10 ** minorUnitDigits(m.currency));
}

/**
 * Parses a decimal amount typed by a person ("1200", "1,200.50") into minor units.
 * Returns null for anything that is not a non-negative amount with at most the currency's decimals.
 */
export function parseMajorToMinor(input: string, currency: CurrencyCode): number | null {
  const cleaned = input.trim().replace(/[,\s]/g, "");
  const digits = minorUnitDigits(currency);
  const pattern = digits === 0 ? /^\d+$/ : new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`);
  if (!pattern.test(cleaned)) return null;
  const minor = Math.round(Number(cleaned) * 10 ** digits);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** Minor units as a plain decimal string for a form field, without symbol or grouping. */
export function minorToMajorString(amountMinor: number, currency: CurrencyCode): string {
  const digits = minorUnitDigits(currency);
  return (amountMinor / 10 ** digits).toFixed(digits);
}
