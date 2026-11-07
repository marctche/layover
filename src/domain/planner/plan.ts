import { dateOfNight, isValidIsoDate, nightsBetween } from "../dates/dates";
import { classify, requiredCityIds } from "./classify";
import { bestTier } from "./hubs";
import { candidateOrders } from "./orders";
import type { PlannedSearch, PlannerCity, PlannerError, PlannerInput, SearchPlan } from "./types";

export const DEFAULT_MAX_SEARCHES = 60;
export const DEFAULT_OPEN_JAW_COST = 2;
export const MAX_PLANNER_CITIES = 8;

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function validate(input: PlannerInput): PlannerError[] {
  const errors: PlannerError[] = [];
  const add = (code: string, message: string, path?: string) => errors.push(path ? { code, message, path } : { code, message });

  const startOk = isValidIsoDate(input.startDate);
  const endOk = isValidIsoDate(input.endDate);
  if (!startOk) add("invalid_date", `startDate "${input.startDate}" is not a valid ISO date`, "startDate");
  if (!endOk) add("invalid_date", `endDate "${input.endDate}" is not a valid ISO date`, "endDate");
  if (startOk && endOk && nightsBetween(input.startDate, input.endDate) <= 0) {
    add("dates_reversed", "endDate must be after startDate", "endDate");
  }

  if (input.cities.length === 0) add("no_cities", "at least one city is required", "cities");
  if (input.cities.length > MAX_PLANNER_CITIES) {
    add("too_many_cities", `${input.cities.length} cities supplied; the limit is ${MAX_PLANNER_CITIES}`, "cities");
  }
  const ids = new Set<string>();
  input.cities.forEach((c, i) => {
    if (ids.has(c.id)) add("duplicate_city", `city id "${c.id}" is used more than once`, `cities[${i}].id`);
    ids.add(c.id);
    if (c.airports.length === 0) add("no_airports", `city "${c.id}" has no airports`, `cities[${i}].airports`);
  });
  if (input.home.airports.length === 0) add("no_airports", "home has no airports", "home.airports");

  const ref = (id: string, path: string) => {
    if (!ids.has(id)) add("unknown_city", `"${id}" is not one of the trip's cities`, path);
  };
  (input.mustInclude ?? []).forEach((id, i) => ref(id, `mustInclude[${i}]`));
  (input.lockedOrder ?? []).forEach((id, i) => ref(id, `lockedOrder[${i}]`));
  (input.statedOrder ?? []).forEach((id, i) => ref(id, `statedOrder[${i}]`));
  if (input.startCity) ref(input.startCity, "startCity");
  if (input.endCity) ref(input.endCity, "endCity");
  (input.fixedEvents ?? []).forEach((e, i) => {
    ref(e.cityId, `fixedEvents[${i}].cityId`);
    if (!isValidIsoDate(e.startDate) || !isValidIsoDate(e.endDate) || e.endDate < e.startDate) {
      add("invalid_event", `fixed event ${i} has invalid dates`, `fixedEvents[${i}]`);
    } else if (startOk && endOk) {
      const first = nightsBetween(input.startDate, e.startDate);
      const last = nightsBetween(input.startDate, e.endDate);
      const total = nightsBetween(input.startDate, input.endDate);
      if (first < 0 || last > total) add("event_outside_trip", `fixed event ${i} falls outside the trip dates`, `fixedEvents[${i}]`);
    }
  });
  return errors;
}

interface PairInfo {
  from: string;
  to: string;
  estimates: number[];
  orders: Set<number>;
  contractedOnly: boolean;
}

/** Sequences obtained by deleting any subset of optional cities; mask 0 is the order itself. */
function contractions(order: readonly string[], optional: Set<string>): string[][] {
  const idx = order.map((id, i) => (optional.has(id) ? i : -1)).filter((i) => i >= 0);
  const out: string[][] = [];
  for (let mask = 0; mask < 1 << idx.length; mask++) {
    const drop = new Set<number>();
    idx.forEach((pos, bit) => {
      if (mask & (1 << bit)) drop.add(pos);
    });
    out.push(order.filter((_, i) => !drop.has(i)));
  }
  return out;
}

function withoutUses(s: PlannedSearch & { uses: number }): PlannedSearch {
  const { uses, ...rest } = s;
  void uses;
  return rest;
}

export function planSearches(input: PlannerInput): SearchPlan {
  const errors = validate(input);
  if (errors.length > 0) return { ok: false, errors };

  const classification = classify(input);
  const { kept, skipped } = candidateOrders(input, classification);
  if (kept.length === 0) {
    return {
      ok: false,
      errors: [
        {
          code: "no_feasible_order",
          message: `no city order satisfies the constraints (${skipped.map((s) => `${s.count} ${s.why}`).join("; ")})`,
        },
      ],
    };
  }

  const maxSearches = input.maxSearches ?? DEFAULT_MAX_SEARCHES;
  const openJawCost = input.openJawSearchCost ?? DEFAULT_OPEN_JAW_COST;
  const cityById = new Map<string, PlannerCity>(input.cities.map((c) => [c.id, c]));
  const airportsOf = (id: string) => (cityById.get(id) as PlannerCity).airports;
  const totalNights = nightsBetween(input.startDate, input.endDate);
  const homeAirports = input.home.airports;

  // Long haul: one open-jaw per distinct (first, last).
  const jaws = new Map<string, { first: string; last: string; orders: string[] }>();
  for (const k of kept) {
    const first = k.order[0] as string;
    const last = k.order[k.order.length - 1] as string;
    const key = `${first}>${last}`;
    const entry = jaws.get(key) ?? { first, last, orders: [] };
    entry.orders.push(k.order.join(">"));
    jaws.set(key, entry);
  }
  const longHaul: PlannedSearch[] = [...jaws.values()].map((j) => ({
    id: `oj:${j.first}>${j.last}`,
    kind: "open_jaw",
    legs: [
      { from: [...homeAirports], to: [...airportsOf(j.first)], date: input.startDate },
      { from: [...airportsOf(j.last)], to: [...homeAirports], date: input.endDate },
    ],
    purpose: "long_haul",
    fromPlace: j.first,
    toPlace: j.last,
    priority: 0,
    billableCost: openJawCost,
    reason: `open-jaw ${input.home.id} to ${j.first} on ${input.startDate}, ${j.last} back to ${input.home.id} on ${input.endDate}; needed by ${j.orders.length} kept order(s): ${j.orders.join("; ")}`,
  }));
  const hubScore = (s: PlannedSearch) => bestTier(airportsOf(s.fromPlace)) + bestTier(airportsOf(s.toPlace));
  longHaul.sort((a, b) => hubScore(a) - hubScore(b) || cmp(a.id, b.id));

  // Intercity: consecutive pairs, plus contractions when wide open.
  const wideOpen = classification.modifiers.includes("wide_open");
  const required = requiredCityIds(input);
  const optional = new Set(input.cities.filter((c) => !required.has(c.id)).map((c) => c.id));
  const pairs = new Map<string, PairInfo>();
  kept.forEach((k, orderIdx) => {
    const seen = new Set<string>();
    const seqs = wideOpen ? contractions(k.order, optional) : [k.order];
    seqs.forEach((seq, seqIdx) => {
      for (let i = 0; i + 1 < seq.length; i++) {
        const from = seq[i] as string;
        const to = seq[i + 1] as string;
        const key = `${from}>${to}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const info = pairs.get(key) ?? { from, to, estimates: [], orders: new Set<number>(), contractedOnly: true };
        info.estimates.push(Math.round((totalNights * (i + 1)) / seq.length));
        info.orders.add(orderIdx);
        if (seqIdx === 0) info.contractedOnly = false;
        pairs.set(key, info);
      }
    });
  });
  const intercity: (PlannedSearch & { uses: number })[] = [...pairs.values()].map((p) => {
    const sorted = [...p.estimates].sort((a, b) => a - b);
    const night = sorted[Math.floor((sorted.length - 1) / 2)] as number;
    return {
      id: `ow:${p.from}>${p.to}`,
      kind: "one_way",
      legs: [{ from: [...airportsOf(p.from)], to: [...airportsOf(p.to)], date: dateOfNight(input.startDate, night) }],
      purpose: "intercity",
      fromPlace: p.from,
      toPlace: p.to,
      priority: 0,
      billableCost: 1,
      reason: p.contractedOnly
        ? `${p.from} to ${p.to} appears only if optional cities are dropped from ${p.orders.size} kept order(s)`
        : `${p.from} to ${p.to} is a leg in ${p.orders.size} kept order(s)`,
      uses: p.orders.size,
    };
  });
  intercity.sort((a, b) => b.uses - a.uses || cmp(a.id, b.id));

  // Exploration: one extra open-jaw through the best-connected city no kept order starts or ends in.
  const exploration: PlannedSearch[] = [];
  if (classification.longHaul) {
    const ends = new Set<string>();
    const lastCounts = new Map<string, number>();
    for (const k of kept) {
      ends.add(k.order[0] as string);
      const last = k.order[k.order.length - 1] as string;
      ends.add(last);
      lastCounts.set(last, (lastCounts.get(last) ?? 0) + 1);
    }
    const candidate = input.cities
      .filter((c) => !ends.has(c.id))
      .sort((a, b) => bestTier(a.airports) - bestTier(b.airports) || cmp(a.id, b.id))[0];
    const commonLast = [...lastCounts].sort((a, b) => b[1] - a[1] || cmp(a[0], b[0]))[0]?.[0];
    if (candidate && commonLast) {
      exploration.push({
        id: `ex:${candidate.id}>${commonLast}`,
        kind: "open_jaw",
        legs: [
          { from: [...homeAirports], to: [...candidate.airports], date: input.startDate },
          { from: [...airportsOf(commonLast)], to: [...homeAirports], date: input.endDate },
        ],
        purpose: "exploration",
        fromPlace: candidate.id,
        toPlace: commonLast,
        priority: 0,
        billableCost: openJawCost,
        reason: `${candidate.id} (hub tier ${bestTier(candidate.airports)}) is never a first or last city in a kept order; checks whether flying into it and out of ${commonLast} (the most common last city) is cheap`,
      });
    }
  }

  const ordered: PlannedSearch[] = [...longHaul, ...intercity.map(withoutUses), ...exploration].map((s, i) => ({
    ...s,
    priority: i + 1,
  }));

  // Budget: strict priority prefix, so the dropped ones are always the lowest priority.
  const searches: PlannedSearch[] = [];
  const droppedForBudget: PlannedSearch[] = [];
  let spent = 0;
  let over = false;
  for (const s of ordered) {
    if (!over && spent + s.billableCost <= maxSearches) {
      searches.push(s);
      spent += s.billableCost;
    } else {
      over = true;
      droppedForBudget.push({ ...s, reason: `${s.reason}; over the search budget` });
    }
  }

  return {
    ok: true,
    classification,
    keptOrders: kept,
    skippedOrders: skipped,
    searches,
    droppedForBudget,
    totalBillable: spent,
  };
}
