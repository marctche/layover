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
