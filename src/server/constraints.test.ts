import { randomUUID } from "node:crypto";
import { describe, expect, it, vi, type Mock } from "vitest";
import {
  addFixedEvent,
  addManualQuote,
  removeFixedEvent,
  removeQuote,
  setDestinationConstraint,
  setMyAvailability,
  setTripConstraints,
  setTripDates,
} from "./constraints";
import { ServiceError } from "./errors";
import { listScenarios, runScenario } from "./scenarios";
import type { PlanningStore, QuoteRow, Role, ScenarioRow, Store } from "./store";

const alice = randomUUID(); // coordinator
const bob = randomUUID(); // member
const eve = randomUUID(); // outsider
const tripId = randomUUID();
const tokyo = randomUUID();
const seoul = randomUUID();

function fake(userId: string | null, over: Record<string, unknown> = {}): Fake {
  const roles: Record<string, Role> = { [alice]: "coordinator", [bob]: "member" };
  const scenarios: ScenarioRow[] = [];
  const quoteRow = (i: Record<string, unknown>) => ({ id: randomUUID(), adults: 1, source: "manual", provider: null, fetchedAt: "x", ...i }) as unknown as QuoteRow;
  const store = {
    currentUserId: async () => userId,
    getRole: async (t: string, u: string) => (t === tripId ? (roles[u] ?? null) : null),
    getTrip: async () => ({ id: tripId, name: "Asia", startDate: "2027-03-01", endDate: "2027-03-08", status: "planning", groupTargetMinor: null, baseCurrency: "USD" }),
    listMembers: async () => [
      { userId: alice, role: "coordinator" as Role, displayName: "Alice", homeAirport: null },
      { userId: bob, role: "member" as Role, displayName: "Bob", homeAirport: null },
    ],
    listDestinations: async () => [
      { id: tokyo, name: "Tokyo", suggestedBy: alice },
      { id: seoul, name: "Seoul", suggestedBy: alice },
    ],
    listPreferences: async () => [],
    getBudget: vi.fn(async () => {
      throw new Error("budgets must not be read");
    }),
    setTripDates: vi.fn(async () => {}),
    getTripConstraints: async () => null,
    upsertTripConstraints: vi.fn(async (_t: string, r: unknown) => r),
    listDestinationConstraints: async () => [],
    upsertDestinationConstraint: vi.fn(async (_t: string, r: unknown) => r),
    listFixedEvents: async () => [],
    insertFixedEvent: vi.fn(async (_t: string, e: Record<string, unknown>) => ({ id: randomUUID(), ...e })),
    deleteFixedEvent: vi.fn(async () => true),
    listAvailability: async () => [],
    setMyAvailability: vi.fn(async () => {}),
    listQuotes: async () => [],
    insertManualQuote: vi.fn(async (q: Record<string, unknown>) => quoteRow(q)),
    deleteQuote: vi.fn(async () => true),
    listScenarios: async () => scenarios,
    findScenario: vi.fn(async (_t: string, v: string, h: string) => scenarios.find((s) => s.engineVersion === v && s.inputHash === h) ?? null),
    insertScenario: vi.fn(async (i: { engineVersion: string; inputHash: string; ok: boolean; createdBy: string; result: unknown }) => {
      const row: ScenarioRow = { id: randomUUID(), engineVersion: i.engineVersion, inputHash: i.inputHash, ok: i.ok, createdBy: i.createdBy, createdAt: "now", result: i.result };
      scenarios.push(row);
      return row;
    }),
    ...over,
  };
  return store as unknown as Fake;
}

type MockKeys = "insertManualQuote" | "insertScenario" | "findScenario" | "getBudget" | "setTripDates" | "upsertTripConstraints" | "upsertDestinationConstraint" | "insertFixedEvent" | "deleteFixedEvent" | "deleteQuote" | "setMyAvailability";

type Fake = Omit<Store & PlanningStore, MockKeys> & Record<MockKeys, Mock>;

const code = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  return e instanceof ServiceError ? e.code : (e as Error | null)?.message ?? null;
};

const legInput = { tripId, kind: "leg", mode: "flight", fromDestinationId: tokyo, toDestinationId: seoul, durationMinutes: 150, amountMinor: 20000, currency: "USD" };

describe("coordinator-only writes", () => {
  const writes: [string, (s: Fake) => Promise<unknown>][] = [
    ["setTripDates", (s) => setTripDates(s, { tripId, startDate: "2027-03-01", endDate: "2027-03-08" })],
    ["setTripConstraints", (s) => setTripConstraints(s, { tripId })],
    ["setDestinationConstraint", (s) => setDestinationConstraint(s, { tripId, destinationId: tokyo })],
    ["addFixedEvent", (s) => addFixedEvent(s, { tripId, destinationId: tokyo, label: "x", startDate: "2027-03-02", endDate: "2027-03-03" })],
    ["removeFixedEvent", (s) => removeFixedEvent(s, { tripId, eventId: randomUUID() })],
    ["addManualQuote", (s) => addManualQuote(s, legInput)],
    ["removeQuote", (s) => removeQuote(s, { tripId, quoteId: randomUUID() })],
  ];

  for (const [name, call] of writes) {
    it(`${name}: a member is forbidden, an outsider sees not_found, signed-out is unauthenticated, the coordinator succeeds`, async () => {
      const member = fake(bob);
      expect(await code(call(member))).toBe("forbidden");
      expect(await code(call(fake(eve)))).toBe("not_found");
      expect(await code(call(fake(null)))).toBe("unauthenticated");
      expect(await code(call(fake(alice)))).toBeNull();
      // Nothing reached the store for the member.
      for (const fn of [member.setTripDates, member.upsertTripConstraints, member.upsertDestinationConstraint, member.insertFixedEvent, member.deleteFixedEvent, member.insertManualQuote, member.deleteQuote]) {
        expect(fn).not.toHaveBeenCalled();
      }
    });
  }
});

describe("input validation", () => {
  it("rejects unknown keys such as a role, a user id or a source", async () => {
    const s = fake(alice);
    expect(await code(setTripConstraints(s, { tripId, userId: bob }))).toBe("invalid_input");
    expect(await code(addManualQuote(s, { ...legInput, source: "live" }))).toBe("invalid_input");
    expect(await code(addManualQuote(s, { ...legInput, adults: 2 }))).toBe("invalid_input");
    expect(await code(setMyAvailability(s, { tripId, ranges: [], userId: bob }))).toBe("invalid_input");
  });

  describe("trip dates and fixed events", () => {
    const withDates = (start: string | null, end: string | null, events: { startDate: string; endDate: string }[] = []) =>
      fake(alice, {
        getTrip: async () => ({ id: tripId, name: "Asia", startDate: start, endDate: end, status: "planning", groupTargetMinor: null, baseCurrency: "USD" }),
        listFixedEvents: async () => events.map((e) => ({ id: randomUUID(), destinationId: tokyo, label: "Concert", ...e })),
      });
    const event = (startDate: string, endDate = startDate) => ({ tripId, destinationId: tokyo, label: "Concert", startDate, endDate });

    it("accepts an event on any night of the trip, including the first and the last", async () => {
      const s = withDates("2027-03-01", "2027-03-08");
      expect(await code(addFixedEvent(s, event("2027-03-01")))).toBeNull();
      expect(await code(addFixedEvent(s, event("2027-03-07")))).toBeNull();
      expect(await code(addFixedEvent(s, event("2027-03-02", "2027-03-07")))).toBeNull();
    });

    it("rejects an event on the end date, before the start, or after the end", async () => {
      const s = withDates("2027-03-01", "2027-03-08");
      expect(await code(addFixedEvent(s, event("2027-03-08")))).toBe("invalid_input");
      expect(await code(addFixedEvent(s, event("2027-02-28")))).toBe("invalid_input");
      expect(await code(addFixedEvent(s, event("2027-03-07", "2027-03-08")))).toBe("invalid_input");
      expect(s.insertFixedEvent).not.toHaveBeenCalled();
    });

    it("requires trip dates before adding an event", async () => {
      const s = withDates(null, null);
      expect(await code(addFixedEvent(s, event("2027-03-02")))).toBe("invalid_input");
      expect(s.insertFixedEvent).not.toHaveBeenCalled();
    });

    it("rejects a date change that strands an event, naming it", async () => {
      const s = withDates("2027-03-01", "2027-03-08", [{ startDate: "2027-03-06", endDate: "2027-03-07" }]);
      const err = await setTripDates(s, { tripId, startDate: "2027-03-01", endDate: "2027-03-07" }).catch((e: ServiceError) => e);
      expect((err as ServiceError).code).toBe("invalid_input");
      expect((err as ServiceError).message).toContain("Concert");
      expect(await code(setTripDates(s, { tripId, startDate: "2027-03-07", endDate: "2027-03-14" }))).toBe("invalid_input");
      expect(await code(setTripDates(s, { tripId, startDate: null, endDate: null }))).toBe("invalid_input");
      expect(s.setTripDates).not.toHaveBeenCalled();
      expect(await code(setTripDates(s, { tripId, startDate: "2027-03-01", endDate: "2027-03-09" }))).toBeNull();
    });

    it("requires 1 to 60 nights", async () => {
      const s = withDates("2027-03-01", "2027-03-08");
      expect(await code(setTripDates(s, { tripId, startDate: "2027-03-01", endDate: "2027-03-01" }))).toBe("invalid_input");
      expect(await code(setTripDates(s, { tripId, startDate: "2027-03-01", endDate: "2027-05-01" }))).toBe("invalid_input");
      expect(await code(setTripDates(s, { tripId, startDate: "2027-03-01", endDate: "2027-03-02" }))).toBeNull();
      expect(await code(setTripDates(s, { tripId, startDate: "2027-03-01", endDate: "2027-04-30" }))).toBeNull();
    });

    it("lets dates be cleared when there are no events", async () => {
      expect(await code(setTripDates(withDates("2027-03-01", "2027-03-08"), { tripId, startDate: null, endDate: null }))).toBeNull();
    });
  });

  it("rejects inconsistent windows, nights, dates and quotes", async () => {
    const s = fake(alice);
    expect(await code(setTripDates(s, { tripId, startDate: "2027-03-01", endDate: null }))).toBe("invalid_input");
    expect(await code(setTripDates(s, { tripId, startDate: "2027-03-09", endDate: "2027-03-01" }))).toBe("invalid_input");
    expect(await code(setTripConstraints(s, { tripId, earliestStart: "2027-04-01", latestEnd: "2027-03-01" }))).toBe("invalid_input");
    expect(await code(setTripConstraints(s, { tripId, minNights: 9, maxNights: 3 }))).toBe("invalid_input");
    expect(await code(setTripConstraints(s, { tripId, startDestinationId: tokyo, endDestinationId: tokyo }))).toBe("invalid_input");
    expect(await code(setDestinationConstraint(s, { tripId, destinationId: tokyo, minNights: 4, maxNights: 2 }))).toBe("invalid_input");
    expect(await code(addManualQuote(s, { ...legInput, fromDestinationId: null, toDestinationId: null }))).toBe("invalid_input");
    expect(await code(addManualQuote(s, { ...legInput, currency: "usd" }))).toBe("invalid_input");
    expect(await code(addManualQuote(s, { ...legInput, expiresAt: "2020-01-01T00:00:00Z" }))).toBe("invalid_input");
    expect(await code(addManualQuote(s, { tripId, kind: "long_haul_fare", mode: "train", toDestinationId: tokyo, returnFromDestinationId: seoul, returnMinutes: 5, durationMinutes: 5, amountMinor: 1, currency: "USD" }))).toBe("invalid_input");
    expect(s.insertManualQuote).not.toHaveBeenCalled();
  });

  it("applies the documented defaults", async () => {
    const s = fake(alice);
    await setDestinationConstraint(s, { tripId, destinationId: tokyo });
    expect(s.upsertDestinationConstraint).toHaveBeenCalledWith(tripId, { destinationId: tokyo, minNights: 1, maxNights: null, mustInclude: false, lockPosition: null });
  });

  it("stores manual quotes with the caller as creator and no way to name a source", async () => {
    const s = fake(alice);
    await addManualQuote(s, legInput);
    expect(s.insertManualQuote.mock.calls[0]?.[0]).toMatchObject({ tripId, createdBy: alice, kind: "leg", returnFromDestinationId: null });
    expect(s.insertManualQuote.mock.calls[0]?.[0]).not.toHaveProperty("source");
  });
});

describe("member availability", () => {
  it("lets any member write their own and refuses outsiders", async () => {
    const s = fake(bob);
    await setMyAvailability(s, { tripId, flexibilityDays: 3, ranges: [{ startDate: "2027-03-01", endDate: "2027-03-10" }] });
    expect(s.setMyAvailability).toHaveBeenCalledWith(tripId, 3, [{ startDate: "2027-03-01", endDate: "2027-03-10" }]);
    expect(await code(setMyAvailability(fake(eve), { tripId, ranges: [] }))).toBe("not_found");
    expect(await code(setMyAvailability(s, { tripId, ranges: [{ startDate: "2027-03-10", endDate: "2027-03-01" }] }))).toBe("invalid_input");
  });
});

describe("runScenario", () => {
  it("never reads a budget, even for the viewer", async () => {
    const s = fake(bob);
    const r = await runScenario(s, { tripId });
    expect(r.ok).toBe(true);
    expect(s.getBudget).not.toHaveBeenCalled();
  });

  it("saves the run once and reuses it for the same input", async () => {
    const s = fake(bob);
    const first = await runScenario(s, { tripId });
    const second = await runScenario(fake(alice, { findScenario: s.findScenario, insertScenario: s.insertScenario }), { tripId });
    expect(first.ok && first.reused).toBe(false);
    expect(second.ok && second.reused).toBe(true);
    expect(s.insertScenario).toHaveBeenCalledTimes(1);
    expect(s.insertScenario.mock.calls[0]?.[0]).toMatchObject({ createdBy: bob, ok: false }); // no quotes: engine reports no feasible route
  });

  it("returns a typed error, saves nothing, when dates are missing", async () => {
    const s = fake(bob, { getTrip: async () => ({ id: tripId, name: "A", startDate: null, endDate: null, status: "planning", groupTargetMinor: null, baseCurrency: "USD" }) });
    const r = await runScenario(s, { tripId });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.issues[0]?.code).toBe("missing_dates");
    expect(s.insertScenario).not.toHaveBeenCalled();
  });

  it("is members only", async () => {
    expect(await code(runScenario(fake(eve), { tripId }))).toBe("not_found");
    expect(await code(runScenario(fake(null), { tripId }))).toBe("unauthenticated");
  });

  it("returns the simultaneous winner when the unique index rejects the insert", async () => {
    const winner: ScenarioRow = { id: "w", engineVersion: "v", inputHash: "h", ok: true, createdBy: alice, createdAt: "t", result: {} };
    let calls = 0;
    const s = fake(bob, {
      findScenario: vi.fn(async () => (calls++ === 0 ? null : winner)),
      insertScenario: vi.fn(async () => {
        throw new ServiceError("conflict");
      }),
    });
    const r = await runScenario(s, { tripId });
    expect(r.ok && r.scenario).toBe(winner);
  });

  it("lists scenarios with the current input hash for staleness", async () => {
    const s = fake(bob);
    const run = await runScenario(s, { tripId });
    const list = await listScenarios(s, { tripId });
    expect(list.scenarios).toHaveLength(1);
    expect(run.ok && run.scenario.inputHash).toBe(list.currentInputHash);
  });
});
