import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateRouteOptions } from "@/domain";
import { HOME_ID, buildEngineInput, hashEngineInput, type EngineSnapshot } from "./engine-input";
import type { QuoteRow } from "./store";

const NOW = new Date("2026-11-10T12:00:00Z");
const alice = "00000000-0000-4000-8000-00000000000a";
const bob = "00000000-0000-4000-8000-00000000000b";
const tokyo = "10000000-0000-4000-8000-000000000001";
const seoul = "10000000-0000-4000-8000-000000000002";
const hk = "10000000-0000-4000-8000-000000000003";

function quote(over: Partial<QuoteRow> = {}): QuoteRow {
  return {
    id: randomUUID(),
    kind: "leg",
    mode: "flight",
    fromDestinationId: tokyo,
    toDestinationId: seoul,
    returnFromDestinationId: null,
    originAirport: null,
    destinationAirport: null,
    durationMinutes: 150,
    returnMinutes: null,
    amountMinor: 20000,
    currency: "USD",
    adults: 1,
    source: "manual",
    provider: null,
    fetchedAt: "2026-11-09T00:00:00Z",
    expiresAt: null,
    createdBy: alice,
    ...over,
  };
}

function snapshot(over: Partial<EngineSnapshot> = {}): EngineSnapshot {
  return {
    trip: {
      id: randomUUID(),
      name: "Asia",
      startDate: "2027-03-01",
      endDate: "2027-03-11",
      status: "planning",
      groupTargetMinor: null,
      baseCurrency: "USD",
    },
    constraints: null,
    members: [
      { userId: bob, role: "member", displayName: "Bob", homeAirport: "YYZ" },
      { userId: alice, role: "coordinator", displayName: "Alice", homeAirport: null },
    ],
    destinations: [
      { id: seoul, name: "Seoul", suggestedBy: alice },
      { id: tokyo, name: "Tokyo", suggestedBy: alice },
    ],
    destinationConstraints: [],
    fixedEvents: [],
    preferences: [
      { destinationId: tokyo, userId: bob, score: 2 },
      { destinationId: seoul, userId: alice, score: 1 },
    ],
    quotes: [],
    ...over,
  };
}

const ok = (snap: EngineSnapshot) => {
  const r = buildEngineInput(snap, NOW);
  if (!r.ok) throw new Error(JSON.stringify(r.issues));
  return r;
};

describe("buildEngineInput mapping", () => {
  it("takes currency and dates from the trip and cities from destinations", () => {
    const { input } = ok(snapshot());
    expect(input.currency).toBe("USD");
    expect([input.startDate, input.endDate]).toEqual(["2027-03-01", "2027-03-11"]);
    expect(input.cities.map((c) => c.id)).toEqual([tokyo, seoul]); // sorted by id
    expect(input.cities.map((c) => c.name)).toEqual(["Tokyo", "Seoul"]);
  });

  it("defaults a destination without constraints to min 1 night, no max, optional", () => {
    const { input } = ok(snapshot());
    for (const c of input.cities) {
      expect(c.minNights).toBe(1);
      expect(c.maxNights).toBeUndefined();
    }
    expect(input.mustInclude).toBeUndefined();
    expect(input.lockedOrder).toBeUndefined();
    expect(input.startCity).toBeUndefined();
    expect(input.endCity).toBeUndefined();
  });

  it("maps stay rules, must-visit, lock order and start and end cities", () => {
    const { input } = ok(
      snapshot({
        destinationConstraints: [
          { destinationId: tokyo, minNights: 3, maxNights: 5, mustInclude: true, lockPosition: 2 },
          { destinationId: seoul, minNights: 2, maxNights: null, mustInclude: false, lockPosition: 1 },
        ],
        constraints: {
          departureAirport: "YYZ",
          startDestinationId: seoul,
          endDestinationId: tokyo,
          earliestStart: null,
          latestEnd: null,
          minNights: null,
          maxNights: null,
        },
      }),
    );
    expect(input.cities.find((c) => c.id === tokyo)).toMatchObject({ minNights: 3, maxNights: 5 });
    expect(input.cities.find((c) => c.id === seoul)).toMatchObject({ minNights: 2 });
    expect(input.mustInclude).toEqual([tokyo]);
    expect(input.lockedOrder).toEqual([seoul, tokyo]);
    expect([input.startCity, input.endCity]).toEqual([seoul, tokyo]);
  });

  it("maps fixed events and preferences", () => {
    const eventId = randomUUID();
    const { input } = ok(
      snapshot({ fixedEvents: [{ id: eventId, destinationId: hk, label: "Sevens", startDate: "2027-03-05", endDate: "2027-03-07" }] }),
    );
    expect(input.fixedEvents).toEqual([{ id: eventId, cityId: hk, startDate: "2027-03-05", endDate: "2027-03-07", label: "Sevens" }]);
    expect(input.preferences).toEqual([
      { travelerId: alice, cityId: seoul, score: 1 },
      { travelerId: bob, cityId: tokyo, score: 2 },
    ]);
  });

  it("makes travelers from members, all sharing one home", () => {
    const { input } = ok(snapshot());
    expect(input.travelers).toEqual([
      { id: alice, name: "Alice", home: HOME_ID },
      { id: bob, name: "Bob", home: HOME_ID },
    ]);
  });

  it("enters lodging and daily costs as zero synthetic, never live", () => {
    const { input } = ok(snapshot());
    expect(input.cityCosts).toHaveLength(2);
    for (const c of input.cityCosts) {
      for (const q of [c.lodgingPerPersonPerNight, c.dailySpendPerPerson]) {
        expect(q.source).toBe("synthetic");
        expect(q.price.amountMinor).toBe(0);
      }
    }
  });

  it("maps city legs, home legs and long-haul fares with their source metadata", () => {
    const homeOut = quote({ fromDestinationId: null, toDestinationId: tokyo, amountMinor: 90000 });
    const homeBack = quote({ fromDestinationId: seoul, toDestinationId: null, amountMinor: 80000 });
    const fare = quote({
      kind: "long_haul_fare",
      fromDestinationId: null,
      toDestinationId: tokyo,
      returnFromDestinationId: seoul,
      returnMinutes: 800,
      durationMinutes: 780,
      amountMinor: 150000,
      provider: "me",
    });
    const { input } = ok(snapshot({ quotes: [quote(), homeOut, homeBack, fare] }));
    expect(input.legs).toHaveLength(3);
    expect(input.legs.find((l) => l.from === HOME_ID)).toMatchObject({ to: tokyo, pricePerPerson: { source: "manual" } });
    expect(input.legs.find((l) => l.to === HOME_ID)).toMatchObject({ from: seoul });
    expect(input.longHaulFares).toEqual([
      {
        home: HOME_ID,
        outboundTo: tokyo,
        returnFrom: seoul,
        outboundMinutes: 780,
        returnMinutes: 800,
        pricePerPerson: { price: { amountMinor: 150000, currency: "USD" }, source: "manual", provider: "me", fetchedAt: "2026-11-09T00:00:00Z" },
      },
    ]);
  });

  it("produces input the engine accepts", () => {
    const quotes = [
      quote({ fromDestinationId: null, toDestinationId: tokyo }),
      quote({ fromDestinationId: null, toDestinationId: seoul }),
      quote({ fromDestinationId: tokyo, toDestinationId: null }),
      quote({ fromDestinationId: seoul, toDestinationId: null }),
      quote({ fromDestinationId: tokyo, toDestinationId: seoul }),
      quote({ fromDestinationId: seoul, toDestinationId: tokyo }),
    ];
    const result = generateRouteOptions(ok(snapshot({ quotes })).input);
    expect(result.ok).toBe(true);
  });
});

describe("quote filtering", () => {
  const reasons = (quotes: QuoteRow[]) =>
    ok(snapshot({ quotes })).excludedQuotes.map((e) => [e.quoteId, e.reason]);

  it("drops an expired quote and says why", () => {
    const q = quote({ expiresAt: "2026-11-10T11:59:59Z" });
    const r = ok(snapshot({ quotes: [q] }));
    expect(r.input.legs).toEqual([]);
    expect(reasons([q])).toEqual([[q.id, "expired"]]);
  });

  it("treats a quote expiring exactly now as expired, and a future one as live", () => {
    const now = quote({ expiresAt: NOW.toISOString() });
    const future = quote({ expiresAt: "2026-11-10T12:00:01Z" });
    expect(reasons([now, future])).toEqual([[now.id, "expired"]]);
  });

  it("drops a quote in another currency", () => {
    const q = quote({ currency: "EUR" });
    expect(reasons([q])).toEqual([[q.id, "currency_mismatch"]]);
    expect(ok(snapshot({ quotes: [q] })).input.legs).toEqual([]);
  });

  it("drops a quote for more than one adult", () => {
    const q = quote({ adults: 2 });
    expect(reasons([q])).toEqual([[q.id, "adults_not_one"]]);
    expect(ok(snapshot({ quotes: [q] })).input.legs).toEqual([]);
  });

  it("reports one reason per dropped quote and keeps good ones", () => {
    const good = quote();
    const bad = quote({ currency: "EUR", adults: 3 });
    const r = ok(snapshot({ quotes: [good, bad] }));
    expect(r.input.legs).toHaveLength(1);
    expect(r.excludedQuotes).toEqual([{ quoteId: bad.id, reason: "currency_mismatch" }]);
  });
});

describe("no budget data in the engine input", () => {
  it("never sets a budget ceiling on a traveler and leaks no budget key anywhere", () => {
    const { input } = ok(snapshot());
    for (const t of input.travelers) expect(t).not.toHaveProperty("budgetCeiling");
    const json = JSON.stringify(input).toLowerCase();
    for (const word of ["budget", "ceiling", "headroom", "flexib"]) expect(json).not.toContain(word);
  });

  it("builds without a budget source: the snapshot type has no budget field", () => {
    const keys = Object.keys(snapshot());
    expect(keys.filter((k) => /budget/i.test(k))).toEqual([]);
  });
});

describe("hash stability", () => {
  it("is identical when every list comes back in a different order", () => {
    const quotes = [
      quote({ fromDestinationId: null, toDestinationId: tokyo, amountMinor: 1 }),
      quote({ fromDestinationId: tokyo, toDestinationId: seoul, amountMinor: 2 }),
      quote({ fromDestinationId: seoul, toDestinationId: tokyo, amountMinor: 3, provider: "p" }),
    ];
    const events = [
      { id: "20000000-0000-4000-8000-000000000001", destinationId: tokyo, label: "A", startDate: "2027-03-02", endDate: "2027-03-03" },
      { id: "20000000-0000-4000-8000-000000000002", destinationId: seoul, label: "B", startDate: "2027-03-05", endDate: "2027-03-06" },
    ];
    const a = snapshot({ quotes, fixedEvents: events });
    const b = snapshot({
      quotes: [...quotes].reverse(),
      fixedEvents: [...events].reverse(),
      members: [...a.members].reverse(),
      destinations: [...a.destinations].reverse(),
      preferences: [...a.preferences].reverse(),
      destinationConstraints: [],
    });
    b.trip = a.trip;
    expect(hashEngineInput(ok(b).input)).toBe(hashEngineInput(ok(a).input));
  });

  it("changes when a price changes", () => {
    const base = snapshot({ quotes: [quote()] });
    const changed = snapshot({ quotes: [{ ...base.quotes[0]!, amountMinor: 20001 }] });
    changed.trip = base.trip;
    expect(hashEngineInput(ok(changed).input)).not.toBe(hashEngineInput(ok(base).input));
  });
});

describe("dates", () => {
  const noDates = (constraints: EngineSnapshot["constraints"]) =>
    snapshot({ trip: { ...snapshot().trip, startDate: null, endDate: null }, constraints });
  const constraintRow = (over: Partial<NonNullable<EngineSnapshot["constraints"]>>) => ({
    departureAirport: null,
    startDestinationId: null,
    endDestinationId: null,
    earliestStart: null,
    latestEnd: null,
    minNights: null,
    maxNights: null,
    ...over,
  });

  it("returns a typed error naming what is missing when there are neither dates nor a window", () => {
    const r = buildEngineInput(noDates(null), NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues).toEqual([
      expect.objectContaining({
        code: "missing_dates",
        missing: ["confirmed_dates", "earliest_start", "latest_end", "min_nights", "max_nights"],
      }),
    ]);
  });

  it("names only the window parts that are still missing", () => {
    const r = buildEngineInput(noDates(constraintRow({ earliestStart: "2027-03-01", latestEnd: "2027-04-01" })), NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]).toMatchObject({ code: "missing_dates", missing: ["confirmed_dates", "min_nights", "max_nights"] });
  });

  it("stores a window plus a length but reports that route generation needs confirmed dates", () => {
    const row = constraintRow({ earliestStart: "2027-03-01", latestEnd: "2027-04-01", minNights: 7, maxNights: 14 });
    const r = buildEngineInput(noDates(row), NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues[0]?.code).toBe("flexible_dates_unsupported");
  });

  it("reports missing destinations alongside missing dates", () => {
    const r = buildEngineInput({ ...noDates(null), destinations: [] }, NOW);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.issues.map((i) => i.code)).toEqual(["missing_dates", "no_destinations"]);
  });
});
