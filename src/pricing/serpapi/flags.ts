// Layer 2: prices that passed every check but look wrong next to the others.
//
// Policy: a false low price would win "cheapest" on its own, so low-side flags
// hold a price out of engine input until a person confirms it. High-side flags
// warn, because a high price cannot beat a correct one. Nothing here edits a price.
//
// The thresholds are heuristics, not measurements. Retune them on real responses.
import type { Priced, PriceFlag, VerifiedOption, VerifiedSearch } from "./types";

/** Cheapest under this share of the median of the response's other options. */
export const LOW_VS_RESPONSE_RATIO = 0.4;
/** Price per km under this share of the median of similar searches. */
export const LOW_VS_PEERS_RATIO = 0.4;
/** Price per km over this multiple of the median of similar searches. */
export const HIGH_VS_PEERS_RATIO = 2.5;
/** A median of fewer values says little. */
export const MIN_COMPARISON_SIZE = 3;
/** Price per km means little on a hop this short (Shenzhen to Hong Kong). */
export const MIN_PEER_KM = 150;

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] as number) : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

/** Compares the cheapest option with the rest of its own response. */
export function responseFlags(search: VerifiedSearch): PriceFlag[] {
  if (!search.ok) return [];
  const [cheapest, ...rest] = search.options as [VerifiedOption, ...VerifiedOption[]];
  if (rest.length < MIN_COMPARISON_SIZE) return [];
  const typical = median(rest.map((o) => o.price.amountMinor));
  if (cheapest.price.amountMinor >= typical * LOW_VS_RESPONSE_RATIO) return [];
  return [
    {
      code: "far_below_response_options",
      severity: "hold",
      detail: `cheapest ${cheapest.price.amountMinor}, median of the other ${rest.length} options ${typical} (minor units)`,
    },
  ];
}

function peerFlags(item: Priced, peers: readonly Priced[]): PriceFlag[] {
  if (item.km < MIN_PEER_KM) return [];
  const others = peers.filter((p) => p !== item && p.km >= MIN_PEER_KM);
  if (others.length < MIN_COMPARISON_SIZE) return [];

  // Leaving the item out keeps one bad price from dragging its own benchmark.
  const typical = median(others.map((p) => p.price.amountMinor / p.km));
  const perKm = item.price.amountMinor / item.km;
  const detail = `${perKm.toFixed(1)} per km, median of ${others.length} similar searches ${typical.toFixed(1)} (minor units)`;
  if (perKm < typical * LOW_VS_PEERS_RATIO) return [{ code: "far_below_similar_routes", severity: "hold", detail }];
  if (perKm > typical * HIGH_VS_PEERS_RATIO) return [{ code: "far_above_similar_routes", severity: "warn", detail }];
  return [];
}

function pairFlags(item: Priced): PriceFlag[] {
  if (item.kind !== "open_jaw" || !item.oneWayPairPrice) return [];
  if (item.price.amountMinor <= item.oneWayPairPrice.amountMinor) return [];
  return [
    {
      code: "fare_above_one_way_pair",
      severity: "warn",
      detail: `ticket ${item.price.amountMinor}, one-way pair ${item.oneWayPairPrice.amountMinor} (minor units)`,
    },
  ];
}

export interface ReviewedPrices {
  /** Safe to pass to the engine. May still carry warnings. */
  usable: Priced[];
  /** Kept out of the engine until a person confirms them. */
  held: Priced[];
}

/** Reviews a whole batch at once. Open-jaws compare with open-jaws, one-ways with one-ways. */
export function reviewPrices(items: readonly Priced[]): ReviewedPrices {
  const reviewed = items.map((item) => ({
    ...item,
    flags: [...item.flags, ...peerFlags(item, items.filter((p) => p.kind === item.kind)), ...pairFlags(item)],
  }));
  const isHeld = (p: Priced) => p.flags.some((f) => f.severity === "hold");
  return { usable: reviewed.filter((p) => !isHeld(p)), held: reviewed.filter(isHeld) };
}
