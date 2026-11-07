// Runs a search plan against a provider, verifies each response, and sorts the
// prices into usable and held. The provider is injected, so tests never touch a network.
import { haversineKm } from "@/domain/planner/geo";
import type { LatLng } from "@/domain/planner/geo";
import type { PlannedSearch, PlannerInput } from "@/domain/planner/types";
import type { SearchCache } from "./serpapi/cache";
import { ADULTS, CURRENCY, SerpApiError, buildSearchParams } from "./serpapi/client";
import type { SearchParams } from "./serpapi/client";
import { requestFromPlan, reviewPrices, toPricedFare, toPricedLeg, verifySearchResponse } from "./serpapi";
import type { MissingReason, Priced, VerifiedOption, VerifiedSearch } from "./serpapi";

/** An open-jaw is the outbound call plus the departure_token call. */
const OPEN_JAW_CALLS = 2;

export interface RunDeps {
  input: PlannerInput;
  /** Hard limit on uncached calls. */
  maxSearches: number;
  /** One paid call. Cached responses never reach it. */
  search(params: SearchParams): Promise<{ text: string; fetchedAt: string }>;
  cache?: SearchCache;
}

export interface MissingPrice {
  id: string;
  kind: PlannedSearch["kind"];
  reason: MissingReason;
  detail: string;
}

export interface NotRun {
  id: string;
  kind: PlannedSearch["kind"];
  reason: string;
}

export interface RunWarning {
  id: string;
  detail: string;
}

export interface RunResult {
  usable: Priced[];
  held: Priced[];
  warnings: RunWarning[];
  missing: MissingPrice[];
  notRun: NotRun[];
  paidCalls: number;
  cachedCalls: number;
}

type Fetched = { ok: true; search: VerifiedSearch } | { ok: false; reason: MissingReason; detail: string };

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const hasProviderError = (raw: unknown) => typeof (raw as { error?: unknown } | null)?.error === "string";

export async function runPlan(plan: PlannedSearch[], deps: RunDeps): Promise<RunResult> {
  const { input } = deps;
  const cityAt = (id: string): LatLng => {
    const c = input.cities.find((x) => x.id === id);
    if (!c) throw new Error(`Search refers to unknown city "${id}"`);
    return c;
  };
  const result: RunResult = { usable: [], held: [], warnings: [], missing: [], notRun: [], paidCalls: 0, cachedCalls: 0 };
  const priced: Priced[] = [];
  const remaining = () => deps.maxSearches - result.paidCalls;

  /** Cached responses are free; a paid call must fit under the limit (checked by the caller). */
  async function fetchVerified(search: PlannedSearch, params: SearchParams, legIndex: number): Promise<Fetched & { cached: boolean }> {
    const hit = deps.cache?.get(params) ?? null;
    let entry = hit;
    if (hit) {
      result.cachedCalls++;
    } else {
      result.paidCalls++;
      try {
        entry = await deps.search(params);
      } catch (err) {
        const detail = err instanceof SerpApiError ? err.message : "unexpected error during search";
        return { ok: false, reason: "provider_error", detail, cached: false };
      }
    }
    const raw = parse((entry as { text: string }).text);
    if (!hit && raw !== null && !hasProviderError(raw)) deps.cache?.put(params, entry as { text: string; fetchedAt: string });
    const request = requestFromPlan(search, legIndex, CURRENCY, ADULTS);
    const verified = verifySearchResponse(raw, request, (entry as { fetchedAt: string }).fetchedAt);
    return { ok: true, search: verified, cached: hit !== null };
  }

  const note = (search: PlannedSearch, verified: VerifiedSearch) => {
    if (verified.ok && verified.rejected.length > 0) {
      const reasons = [...new Set(verified.rejected.map((r) => r.reason))].join(", ");
      result.warnings.push({ id: search.id, detail: `${verified.rejected.length} option(s) rejected (${reasons})` });
    }
  };
  const miss = (search: PlannedSearch, reason: MissingReason, detail: string) =>
    result.missing.push({ id: search.id, kind: search.kind, reason, detail });
  const stopAt = (index: number, reason: string) => {
    for (const s of plan.slice(index)) result.notRun.push({ id: s.id, kind: s.kind, reason });
  };

  for (const [index, search] of plan.entries()) {
    const isJaw = search.kind === "open_jaw";
    const firstParams = buildSearchParams({ kind: isJaw ? "multi_city" : "one_way", legs: search.legs });
    const needed = isJaw ? OPEN_JAW_CALLS : 1;
    if (!deps.cache?.get(firstParams) && remaining() < needed) {
      stopAt(index, `search limit ${deps.maxSearches} reached: needs ${needed}, ${remaining()} remaining`);
      break;
    }

    const first = await fetchVerified(search, firstParams, 0);
    if (!first.ok) {
      miss(search, first.reason, first.detail);
      continue;
    }
    note(search, first.search);

    if (!isJaw) {
      const from = cityAt(search.fromPlace);
      const to = cityAt(search.toPlace);
      const r = toPricedLeg(first.search, { id: search.id, from: search.fromPlace, to: search.toPlace, km: haversineKm(from, to) });
      if (r.ok) priced.push(r.priced);
      else miss(search, r.reason, r.detail);
      continue;
    }

    if (!first.search.ok) {
      miss(search, first.search.reason, first.search.detail);
      continue;
    }
    const outbound: VerifiedOption | undefined = first.search.options.find((o) => o.departureToken);
    if (!outbound?.departureToken) {
      miss(search, "no_valid_options", "no verified option carried a departure_token, so the return call was not made");
      continue;
    }
    const backParams = buildSearchParams({ kind: "multi_city", legs: search.legs, departureToken: outbound.departureToken });
    if (!deps.cache?.get(backParams) && remaining() < 1) {
      stopAt(index, `search limit ${deps.maxSearches} reached: the return call needs 1, 0 remaining`);
      break;
    }
    const back = await fetchVerified(search, backParams, 1);
    if (!back.ok) {
      miss(search, back.reason, back.detail);
      continue;
    }
    note(search, back.search);
    const km = haversineKm(input.home, cityAt(search.fromPlace)) + haversineKm(cityAt(search.toPlace), input.home);
    const r = toPricedFare(first.search, back.search, { id: search.id, home: input.home.id, outboundTo: search.fromPlace, returnFrom: search.toPlace, km }, outbound);
    if (r.ok) priced.push(r.priced);
    else miss(search, r.reason, r.detail);
  }

  const reviewed = reviewPrices(priced);
  result.usable = reviewed.usable;
  result.held = reviewed.held;
  for (const p of [...reviewed.usable, ...reviewed.held]) {
    for (const f of p.flags) if (f.severity === "warn") result.warnings.push({ id: p.id, detail: `${f.code}: ${f.detail}` });
  }
  return result;
}
