import { nightsBetween } from "../dates/dates";
import { fmtKm } from "./classify";
import { pathKm, permutations } from "./geo";
import type { Classification, KeptOrder, PlannerCity, PlannerInput, SkippedOrders } from "./types";

export const GEO_THRESHOLD = 1.15;
export const GEO_THRESHOLD_LARGE = 1.1;
export const LARGE_KEPT_CAP = 12;

function followsLock(order: readonly string[], lock: readonly string[]): boolean {
  let last = -1;
  for (const id of lock) {
    const idx = order.indexOf(id);
    if (idx === -1) continue;
    if (idx < last) return false;
    last = idx;
  }
  return true;
}

export function candidateOrders(
  input: PlannerInput,
  classification: Classification,
): { kept: KeptOrder[]; skipped: SkippedOrders[] } {
  const cities = input.cities;
  const n = cities.length;
  const cityById = new Map<string, PlannerCity>(cities.map((c) => [c.id, c]));
  const totalNights = nightsBetween(input.startDate, input.endDate);
  const large = classification.modifiers.includes("large");

  const skipCounts = new Map<string, number>();
  const bump = (why: string) => skipCounts.set(why, (skipCounts.get(why) ?? 0) + 1);

  const lock = input.lockedOrder ?? [];
  const lockWhy = `breaks the locked order (${lock.join(" > ")})`;
  const startWhy = `does not start in ${input.startCity}`;
  const endWhy = `does not end in ${input.endCity}`;
  const events = (input.fixedEvents ?? []).map((e) => ({
    ...e,
    firstNight: nightsBetween(input.startDate, e.startDate),
    lastNight: nightsBetween(input.startDate, e.endDate),
  }));
  const eventWhy = (e: (typeof events)[number]) =>
    `cannot meet the fixed event in ${e.cityId} (${e.startDate} to ${e.endDate}) with this order`;

  /** Returns the failing event's reason, or null when every event is feasible. */
  const eventViolation = (order: readonly string[]): string | null => {
    for (const e of events) {
      const i = order.indexOf(e.cityId);
      if (i === -1) continue;
      const before = order.slice(0, i).map((id) => cityById.get(id) as PlannerCity);
      const minBefore = before.reduce((s, c) => s + c.minNights, 0);
      const maxBefore = before.reduce((s, c) => s + (c.maxNights ?? totalNights), 0);
      const eventCity = cityById.get(e.cityId) as PlannerCity;
      const span = e.lastNight - e.firstNight + 1;
      if (minBefore > e.firstNight || maxBefore < e.firstNight) return eventWhy(e);
      if (eventCity.maxNights !== undefined && span > eventCity.maxNights) return eventWhy(e);
    }
    return null;
  };

  const survivors: { order: string[]; km: number }[] = [];
  for (const order of permutations(cities.map((c) => c.id))) {
    if (lock.length > 0 && !followsLock(order, lock)) {
      bump(lockWhy);
      continue;
    }
    if (input.startCity && order[0] !== input.startCity) {
      bump(startWhy);
      continue;
    }
    if (input.endCity && order[n - 1] !== input.endCity) {
      bump(endWhy);
      continue;
    }
    const violation = eventViolation(order);
    if (violation) {
      bump(violation);
      continue;
    }
    survivors.push({ order, km: pathKm(order, cityById) });
  }

  const byKmThenOrder = (a: { order: string[]; km: number }, b: { order: string[]; km: number }) =>
    a.km - b.km || (a.order.join(",") < b.order.join(",") ? -1 : a.order.join(",") > b.order.join(",") ? 1 : 0);
  survivors.sort(byKmThenOrder);

  const stated = (input.statedOrder ?? []).join(",");
  const STATED_WHY = "the order you typed, kept for comparison";
  const kept: KeptOrder[] = [];
  const geoSkipWhy = (minKm: number, thr: number) =>
    `more than ${Math.round((thr - 1) * 100)}% longer than the shortest remaining order (${fmtKm(minKm)})`;
  const capWhy = `over the cap of ${LARGE_KEPT_CAP} kept orders for large trips`;

  if (survivors.length > 0) {
    const minKm = (survivors[0] as { km: number }).km;
    const thr = large ? GEO_THRESHOLD_LARGE : GEO_THRESHOLD;
    const keepAll = n <= 3;
    let passed = keepAll ? survivors : survivors.filter((s) => s.km <= thr * minKm);
    const geoCut = survivors.filter((s) => !passed.includes(s));
    let capCut: typeof survivors = [];
    if (large && passed.length > LARGE_KEPT_CAP) {
      capCut = passed.slice(LARGE_KEPT_CAP);
      passed = passed.slice(0, LARGE_KEPT_CAP);
    }
    const whyFor = (s: { order: string[]; km: number }): string => {
      if (s.order.join(",") === stated) return STATED_WHY;
      if (keepAll) return "3 or fewer cities: every order is cheap to price";
      if (s.km === minKm) return `shortest order that meets your constraints (${fmtKm(s.km)})`;
      return `within ${Math.round((thr - 1) * 100)}% of the shortest order (${fmtKm(s.km)} vs ${fmtKm(minKm)})`;
    };
    const keptSet = new Set(passed);
    // The stated order is rescued from either geographic cut.
    const rescued = [...geoCut, ...capCut].find((s) => s.order.join(",") === stated);
    if (rescued) keptSet.add(rescued);
    const finalKept = survivors.filter((s) => keptSet.has(s));
    for (const s of finalKept) kept.push({ order: s.order, km: s.km, why: whyFor(s) });
    const geoCount = geoCut.filter((s) => s !== rescued).length;
    const capCount = capCut.filter((s) => s !== rescued).length;
    if (geoCount > 0) skipCounts.set(geoSkipWhy(minKm, thr), geoCount);
    if (capCount > 0) skipCounts.set(capWhy, capCount);
  }

  const skipped: SkippedOrders[] = [...skipCounts].map(([why, count]) => ({ count, why }));
  return { kept, skipped };
}
