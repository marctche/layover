// Budget bands: the coarse view of a traveler's private budget. The traveler types an exact
// amount; the band is derived from it (see bandForAmount) and is all anyone else ever sees.
// The database derives the same band with the same boundaries (app.budget_band).
import { minorUnitDigits, type CurrencyCode } from "../money/money";

export const BUDGET_BANDS = ["under_2k", "2k_3k", "3k_4k", "4k_plus"] as const;
export type BudgetBand = (typeof BUDGET_BANDS)[number];

/** Top of each band in whole currency units. Null: no ceiling. The numbers are not scaled per currency. */
const BAND_TOP_MAJOR: Record<BudgetBand, number | null> = {
  under_2k: 2000,
  "2k_3k": 3000,
  "3k_4k": 4000,
  "4k_plus": null,
};

export function isBudgetBand(value: unknown): value is BudgetBand {
  return typeof value === "string" && (BUDGET_BANDS as readonly string[]).includes(value);
}

/** The ceiling a band implies, in minor units of the currency. Null for the open-ended band. */
export function bandCeilingMinor(band: BudgetBand, currency: CurrencyCode): number | null {
  const top = BAND_TOP_MAJOR[band];
  return top === null ? null : top * 10 ** minorUnitDigits(currency);
}

/**
 * The band an exact amount falls in. Boundaries are in whole currency units and each band
 * includes its lower bound: under_2k is below 2000, 2k_3k is 2000 up to but excluding 3000,
 * 3k_4k is 3000 up to but excluding 4000, 4k_plus is 4000 and above. `amountMinor` is in minor
 * units of `currency` (cents for CAD, whole yen for JPY). Compared as integers, so no rounding.
 */
export function bandForAmount(amountMinor: number, currency: CurrencyCode): BudgetBand {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new RangeError(`amountMinor must be a non-negative safe integer, got ${amountMinor}`);
  }
  const unit = 10 ** minorUnitDigits(currency);
  if (amountMinor < 2000 * unit) return "under_2k";
  if (amountMinor < 3000 * unit) return "2k_3k";
  if (amountMinor < 4000 * unit) return "3k_4k";
  return "4k_plus";
}

function amount(major: number, currency: CurrencyCode): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(major);
}

/** Display label for a band in the trip currency, for example "$2,000 to $3,000" or "$4,000 or more". */
export function bandLabel(band: BudgetBand, currency: CurrencyCode): string {
  switch (band) {
    case "under_2k":
      return `Under ${amount(2000, currency)}`;
    case "2k_3k":
      return `${amount(2000, currency)} to ${amount(3000, currency)}`;
    case "3k_4k":
      return `${amount(3000, currency)} to ${amount(4000, currency)}`;
    case "4k_plus":
      return `${amount(4000, currency)} or more`;
  }
}

/** All bands in order with their labels, ready for a picker. */
export function bandOptions(currency: CurrencyCode): { band: BudgetBand; label: string }[] {
  return BUDGET_BANDS.map((band) => ({ band, label: bandLabel(band, currency) }));
}
