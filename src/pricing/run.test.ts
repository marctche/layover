import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { generateRouteOptions } from "@/domain/engine/generate";
import { validateInput } from "@/domain/engine/validate";
import { asiaDryRun, europeDryRun } from "@/domain/planner/catalog";
import { planSearches } from "@/domain/planner/plan";
import type { PlannedSearch, PlannerInput } from "@/domain/planner/types";
import { FLIGHTS_ONLY_PROVIDER, buildFlightsOnlyTrip } from "./flights-only-trip";
import { renderReport } from "./report";
import { runPlan } from "./run";
import { fakeResponse, fakeSearch, memoryCache } from "./run.fixtures";
import { diskCache, cacheKey } from "./serpapi/cache";
import { SerpApiError, buildSearchParams, searchOnce } from "./serpapi/client";

function planOf(input: PlannerInput) {
  const plan = planSearches(input);
  if (!plan.ok) throw new Error("planner rejected the fixture");
  return plan;
}
const europe = planOf(europeDryRun);
const jaws = europe.searches.filter((s) => s.kind === "open_jaw");
const oneWays = europe.searches.filter((s) => s.kind === "one_way");
const run = (searches: PlannedSearch[], deps: Partial<Parameters<typeof runPlan>[1]> & { search: Parameters<typeof runPlan>[1]["search"] }) =>
  runPlan(searches, { input: europeDryRun, maxSearches: 100, ...deps });

describe("search limit", () => {
  it("stops before overspending and records the rest as not run", async () => {
    const fake = fakeSearch();
    const r = await run(europe.searches, { search: fake.search, maxSearches: 3 });
    expect(fake.calls).toHaveLength(2);
    expect(r.paidCalls).toBe(2);
    expect(r.notRun.map((n) => n.id)).toEqual(europe.searches.slice(1).map((s) => s.id));
    expect(r.usable).toHaveLength(1);
  });

  it("does not start an open-jaw when only 1 search remains", async () => {
    const fake = fakeSearch();
    const r = await run(europe.searches, { search: fake.search, maxSearches: 1 });
    expect(fake.calls).toHaveLength(0);
    expect(r.paidCalls).toBe(0);
    expect(r.notRun).toHaveLength(europe.searches.length);
    expect(r.notRun[0]?.reason).toMatch(/needs 2, 1 remaining/);
  });

  it("counts only uncached calls and never starts a call 2 it cannot pay for", async () => {
    const cache = memoryCache();
    const first = fakeSearch();
    await run(jaws.slice(0, 1), { search: first.search, cache });
    // Call 1 is now cached, call 2 is cached too: free even with a limit of 0.
    const again = fakeSearch();
    const r = await run(jaws.slice(0, 1), { search: again.search, cache, maxSearches: 0 });
    expect(again.calls).toHaveLength(0);
    expect(r.usable).toHaveLength(1);

    // Only call 1 cached, 0 left for call 2: the search is reported as not run.
    const half = memoryCache();
    const jaw = jaws[0] as PlannedSearch;
    const p1 = buildSearchParams({ kind: "multi_city", legs: jaw.legs });
    half.put(p1, { text: JSON.stringify(fakeResponse(p1)), fetchedAt: "2026-11-07T12:00:00.000Z" });
    const blocked = fakeSearch();
    const r2 = await run([jaw], { search: blocked.search, cache: half, maxSearches: 0 });
    expect(blocked.calls).toHaveLength(0);
    expect(r2.notRun).toHaveLength(1);
    expect(r2.usable).toHaveLength(0);
  });
});

describe("cache", () => {
  it("a cached call costs nothing and makes no call", async () => {
    const cache = memoryCache();
    const first = fakeSearch();
    const a = await run(europe.searches, { search: first.search, cache });
    expect(a.paidCalls).toBe(18);
    expect(a.cachedCalls).toBe(0);

    const second = fakeSearch({ override: () => { throw new Error("must not be called"); } });
    const b = await run(europe.searches, { search: second.search, cache, maxSearches: 0 });
    expect(second.calls).toHaveLength(0);
    expect(b.paidCalls).toBe(0);
    expect(b.cachedCalls).toBe(18);
    expect(b.usable).toHaveLength(a.usable.length);
  });
});

describe("failures", () => {
  it("a provider error becomes missing and the run continues", async () => {
    const target = buildSearchParams({ kind: "one_way", legs: (oneWays[0] as PlannedSearch).legs });
    const fake = fakeSearch();
    const search = async (params: Record<string, string>) => {
      if (cacheKey(params) === cacheKey(target)) throw new SerpApiError("HTTP 500");
      return fake.search(params);
    };
    const r = await run(oneWays, { search });
    expect(r.missing).toEqual([{ id: (oneWays[0] as PlannedSearch).id, kind: "one_way", reason: "provider_error", detail: "HTTP 500" }]);
    expect(r.usable).toHaveLength(oneWays.length - 1);
    expect(r.paidCalls).toBe(oneWays.length);
  });

  it("makes no call 2 when call 1 failed", async () => {
    const fake = fakeSearch({ override: () => JSON.stringify({ error: "Something went wrong" }) });
    const r = await run(jaws.slice(0, 1), { search: fake.search });
    expect(fake.calls).toHaveLength(1);
    expect(r.paidCalls).toBe(1);
    expect(r.missing).toHaveLength(1);
    expect(r.missing[0]?.reason).toBe("provider_error");
    expect(r.usable).toHaveLength(0);
  });

  it("makes no call 2 when call 1 has no departure_token", async () => {
    const fake = fakeSearch({
      override: (p) => {
        const body = fakeResponse(p) as { best_flights: Record<string, unknown>[] };
        for (const o of body.best_flights) delete o.departure_token;
        return JSON.stringify(body);
      },
    });
    const r = await run(jaws.slice(0, 1), { search: fake.search });
    expect(fake.calls).toHaveLength(1);
    expect(r.missing[0]?.detail).toMatch(/departure_token/);
  });
});

describe("held prices", () => {
  it("never reach the TripInput", async () => {
    const lowOne = (oneWays[0] as PlannedSearch).id;
    const lowParams = buildSearchParams({ kind: "one_way", legs: (oneWays[0] as PlannedSearch).legs });
    const fake = fakeSearch({
      price: (p) => (cacheKey(p) === cacheKey(lowParams) ? 5 : p.type === "3" ? 1000 : 100),
      extraPrices: (p) => (cacheKey(p) === cacheKey(lowParams) ? [100, 100, 100] : []),
    });
    const r = await run(europe.searches, { search: fake.search });
    expect(r.held.map((p) => p.id)).toEqual([lowOne]);
    expect(r.held[0]?.flags.some((f) => f.severity === "hold")).toBe(true);
    const trip = buildFlightsOnlyTrip(europeDryRun, r.usable);
    const held = r.held[0];
    expect(trip.legs).toHaveLength(oneWays.length - 1);
    expect(trip.legs.some((l) => held?.kind === "one_way" && l.from === held.leg.from && l.to === held.leg.to)).toBe(false);
  });
});

describe("flights-only TripInput", () => {
  it.each([
    ["europe", europeDryRun],
    ["asia", asiaDryRun],
  ])("passes validateInput and generates routes (%s)", async (_name, input) => {
    const plan = planOf(input);
    const fake = fakeSearch();
    const r = await runPlan(plan.searches, { input, maxSearches: 200, search: fake.search });
    const trip = buildFlightsOnlyTrip(input, r.usable);
    expect(validateInput(trip)).toEqual([]);
    const options = generateRouteOptions(trip);
    expect(options.ok).toBe(true);
    expect(trip.travelers).toEqual([{ id: "traveler", name: "Traveler", home: input.home.id }]);
    expect(trip.travelers[0]).not.toHaveProperty("budgetCeiling");
    expect(trip.preferences).toEqual([]);
  });

  it("labels the missing lodging and daily costs synthetic and zero, and keeps flight sources live", async () => {
    const fake = fakeSearch();
    const r = await run(europe.searches, { search: fake.search });
    const trip = buildFlightsOnlyTrip(europeDryRun, r.usable);
    expect(trip.cityCosts).toHaveLength(europeDryRun.cities.length);
    for (const c of trip.cityCosts) {
      for (const q of [c.lodgingPerPersonPerNight, c.dailySpendPerPerson]) {
        expect(q).toMatchObject({ source: "synthetic", provider: FLIGHTS_ONLY_PROVIDER });
        expect(q.price.amountMinor).toBe(0);
      }
    }
    const flightQuotes = [...trip.legs.map((l) => l.pricePerPerson), ...(trip.longHaulFares ?? []).map((f) => f.pricePerPerson)];
    expect(flightQuotes.length).toBeGreaterThan(0);
    for (const q of flightQuotes) {
      expect(q.source).toBe("live");
      expect(q.provider).toBe("serpapi");
      expect(q.price.amountMinor).toBeGreaterThan(0);
    }
  });
});

describe("the API key", () => {
  const KEY = "sk-test-0123456789abcdef";
  let dir = "";
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it("never appears in cache files, reports or error messages", async () => {
    dir = mkdtempSync(path.join(tmpdir(), "serp-cache-"));
    const cache = diskCache(dir, { now: () => Date.parse("2026-11-07T13:00:00Z") });
    // The provider echoes the key in its body; the client must scrub it before anything is stored.
    const fetchLike = async (url: string) => {
      const params = Object.fromEntries(new URL(url).searchParams) as Record<string, string>;
      const { api_key, ...rest } = params;
      const body = JSON.stringify({ ...(fakeResponse(rest) as object), echoed: { api_key } });
      return { ok: true, status: 200, text: async () => body };
    };
    const r = await run(europe.searches, {
      cache,
      search: async (params) => ({ text: await searchOnce(params, { apiKey: KEY, fetch: fetchLike }), fetchedAt: "2026-11-07T12:00:00.000Z" }),
    });
    expect(r.usable.length).toBeGreaterThan(0);

    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) expect(readFileSync(path.join(dir, f), "utf8")).not.toContain(KEY);

    const options = generateRouteOptions(buildFlightsOnlyTrip(europeDryRun, r.usable));
    const report = renderReport({ name: "europe", generatedAt: "2026-11-07T12:00:00.000Z", input: europeDryRun, plan: europe, run: r, options });
    expect(report).not.toContain(KEY);
    expect(JSON.stringify(r)).not.toContain(KEY);
  });

  it("keeps the URL and key out of thrown errors", async () => {
    const messages: string[] = [];
    const attempts = [
      async (url: string): Promise<never> => { throw new Error(`connect failed for ${url}`); },
      async (url: string) => ({ ok: false, status: 502, text: async () => `Bad gateway ${url}` }),
      async (url: string) => ({ ok: false, status: 401, text: async () => { throw new Error(url); } }),
    ];
    for (const fetch of attempts) {
      await searchOnce({ engine: "google_flights" }, { apiKey: KEY, fetch }).catch((e: Error) => messages.push(e.message));
    }
    expect(messages).toHaveLength(3);
    for (const m of messages) {
      expect(m).not.toContain(KEY);
      expect(m).not.toContain("serpapi.com");
      expect(m).not.toContain("api_key");
    }
    const bodyWithKey = JSON.stringify({ error: `Invalid API key: ${KEY}` });
    const text = await searchOnce({}, { apiKey: KEY, fetch: async () => ({ ok: false, status: 401, text: async () => bodyWithKey }) });
    expect(text).not.toContain(KEY);
  });
});

describe("search parameters and cache key", () => {
  it("builds the live-tested one-way and open-jaw requests", () => {
    const [jaw] = jaws as [PlannedSearch];
    const [ow] = oneWays as [PlannedSearch];
    expect(buildSearchParams({ kind: "one_way", legs: ow.legs })).toEqual({
      engine: "google_flights", currency: "CAD", gl: "ca", hl: "en", adults: "1", travel_class: "1",
      type: "2", departure_id: "BCN", arrival_id: "CDG,ORY", outbound_date: "2026-12-17",
    });
    const first = buildSearchParams({ kind: "multi_city", legs: jaw.legs });
    expect(first).toMatchObject({ type: "3" });
    expect(first).not.toHaveProperty("departure_token");
    expect(JSON.parse(first.multi_city_json as string)).toHaveLength(2);
    expect(buildSearchParams({ kind: "multi_city", legs: jaw.legs, departureToken: "t" }).departure_token).toBe("t");
  });

  it("keys ignore api_key and parameter order", () => {
    expect(cacheKey({ a: "1", b: "2" })).toBe(cacheKey({ b: "2", a: "1", api_key: "secret" }));
    expect(cacheKey({ a: "1" })).not.toBe(cacheKey({ a: "2" }));
  });
});

describe("report", () => {
  it("labels an alternate airport as ground trip not included", async () => {
    // Index 1 picks YYZ at home (and FCO-side alternates), the primary is YOW.
    const fake = fakeSearch({ airportIndex: 1 });
    const r = await run(europe.searches, { search: fake.search });
    const options = generateRouteOptions(buildFlightsOnlyTrip(europeDryRun, r.usable));
    const report = renderReport({ name: "europe", generatedAt: "2026-11-07T12:00:00.000Z", input: europeDryRun, plan: europe, run: r, options });
    expect(report).toContain("ground trip to ottawa not included (YYZ is not the primary airport YOW)");
    expect(report).toMatch(/Flights only\. Lodging, daily costs, bags and ground transfers are excluded/);
    expect(report).toContain("City-to-city dates are approximate");

    const primary = await run(europe.searches, { search: fakeSearch().search });
    const quiet = renderReport({ name: "europe", generatedAt: "x", input: europeDryRun, plan: europe, run: primary, options: generateRouteOptions(buildFlightsOnlyTrip(europeDryRun, primary.usable)) });
    expect(quiet).not.toContain("ground trip to ottawa not included");
  });
});
