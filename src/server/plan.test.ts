import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { ServiceError } from "./errors";
import { addCandidateCity, getPlanView, removeCandidateCity, updateDestinationConstraint, updateTripConstraints } from "./plan";
import type { PlanningStore, Role, Store, TripConstraintsRow } from "./store";

const alice = randomUUID(); // coordinator
const bob = randomUUID(); // member
const eve = randomUUID(); // outsider
const tripId = randomUUID();
const tokyo = randomUUID();
const seoul = randomUUID();

const saved: TripConstraintsRow = {
  departureAirport: "YYZ",
  startDestinationId: tokyo,
  endDestinationId: seoul,
  earliestStart: null,
  latestEnd: null,
  minNights: 5,
  maxNights: 20,
};

function fake(userId: string | null, over: Record<string, unknown> = {}) {
  const roles: Record<string, Role> = { [alice]: "coordinator", [bob]: "member" };
  const store = {
    currentUserId: async () => userId,
    getRole: async (t: string, u: string) => (t === tripId ? (roles[u] ?? null) : null),
    getTrip: async () => ({ id: tripId, name: "Asia", startDate: null, endDate: null, status: "planning", groupTargetMinor: null, baseCurrency: "USD" }),
    listMembers: async () => [],
    listDestinations: async () => [
      { id: tokyo, name: "Tokyo, Japan", suggestedBy: alice },
      { id: seoul, name: "Seoul, South Korea", suggestedBy: alice },
    ],
    listPreferences: async () => [],
    getBudget: vi.fn(async (_t: string, u: string) => ({ tripId, band: u === bob ? ("2k_3k" as const) : ("4k_plus" as const), ceilingMinor: u === bob ? 111 : 987654321, currency: "USD", flexibilityMinor: null })),
    getTripConstraints: vi.fn(async () => saved),
    upsertTripConstraints: vi.fn(async (_t: string, r: unknown) => r),
    listDestinationConstraints: vi.fn(async () => [{ destinationId: tokyo, minNights: 3, maxNights: 6, mustInclude: false, lockPosition: 2 }]),
    upsertDestinationConstraint: vi.fn(async (_t: string, r: unknown) => r),
    listFixedEvents: async () => [],
    listAvailability: async () => [
      { userId: alice, flexibilityDays: 1, ranges: [] },
      { userId: bob, flexibilityDays: 4, ranges: [{ startDate: "2027-03-01", endDate: "2027-03-09" }] },
    ],
    ...over,
  };
  return store as unknown as Store & PlanningStore & { getBudget: ReturnType<typeof vi.fn>; upsertTripConstraints: ReturnType<typeof vi.fn>; upsertDestinationConstraint: ReturnType<typeof vi.fn> };
}

const code = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (x: unknown) => x);
  return e instanceof ServiceError ? e.code : null;
};

describe("getPlanView", () => {
  it("returns only the caller's own budget and availability", async () => {
    const s = fake(bob);
    const view = await getPlanView(s, { tripId });
    expect(view.myBudget?.ceilingMinor).toBe(111);
    expect(view.myBudget?.band).toBe("2k_3k");
    expect(view.myAvailability?.flexibilityDays).toBe(4);
    // The store was only ever asked for the caller's budget.
    expect(s.getBudget.mock.calls.every((c) => c[1] === bob)).toBe(true);
    const json = JSON.stringify(view);
    // Unmistakable sentinel for alice's private ceiling, plus a check that the field it lives in
    // is only ever present once (bob's own), so this cannot pass vacuously.
    expect(json).not.toContain("987654321");
    expect(json.match(/"ceilingMinor"/g)).toHaveLength(1);
    // The other traveler's band is absent too: only one band field, and it is bob's.
    expect(json.match(/"band"/g)).toHaveLength(1);
    expect(json).not.toContain("4k_plus");
    expect(JSON.stringify(view)).not.toContain(alice + '","flexibilityDays');
  });

  it("is not_found for an outsider and unauthenticated when signed out", async () => {
    expect(await code(getPlanView(fake(eve), { tripId }))).toBe("not_found");
    expect(await code(getPlanView(fake(null), { tripId }))).toBe("unauthenticated");
  });
});

describe("updateTripConstraints", () => {
  it("saving the airport keeps the start and end city and the nights", async () => {
    const s = fake(alice);
    await updateTripConstraints(s, { tripId, departureAirport: "LHR" });
    expect(s.upsertTripConstraints).toHaveBeenCalledWith(tripId, { ...saved, departureAirport: "LHR" });
  });

  it("rejects an airport code that is not in the catalog and stores nothing", async () => {
    const s = fake(alice);
    const err = await updateTripConstraints(s, { tripId, departureAirport: "ZZZ" }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ServiceError);
    expect((err as ServiceError).code).toBe("invalid_input");
    expect((err as ServiceError).message).toBe("Choose an airport from the list.");
    expect(s.upsertTripConstraints).not.toHaveBeenCalled();
  });

  it("clears the airport with null", async () => {
    const s = fake(alice);
    await updateTripConstraints(s, { tripId, departureAirport: null });
    expect(s.upsertTripConstraints).toHaveBeenCalledWith(tripId, { ...saved, departureAirport: null });
  });

  it("can clear a field by naming it null, and starts from an empty row on first save", async () => {
    const s = fake(alice);
    await updateTripConstraints(s, { tripId, endDestinationId: null });
    expect(s.upsertTripConstraints).toHaveBeenCalledWith(tripId, { ...saved, endDestinationId: null });
    const first = fake(alice, { getTripConstraints: async () => null });
    await updateTripConstraints(first, { tripId, departureAirport: "YYZ" });
    expect(first.upsertTripConstraints).toHaveBeenCalledWith(tripId, expect.objectContaining({ departureAirport: "YYZ", startDestinationId: null }));
  });

  it("validates the merged row and is coordinator only", async () => {
    expect(await code(updateTripConstraints(fake(alice), { tripId, startDestinationId: seoul }))).toBe("invalid_input");
    const member = fake(bob);
    expect(await code(updateTripConstraints(member, { tripId, departureAirport: "LHR" }))).toBe("forbidden");
    expect(member.upsertTripConstraints).not.toHaveBeenCalled();
    expect(await code(updateTripConstraints(fake(alice), { tripId, userId: bob }))).toBe("invalid_input");
  });
});

describe("updateDestinationConstraint", () => {
  it("toggling must-visit keeps nights and lock position", async () => {
    const s = fake(alice);
    await updateDestinationConstraint(s, { tripId, destinationId: tokyo, mustInclude: true });
    expect(s.upsertDestinationConstraint).toHaveBeenCalledWith(tripId, { destinationId: tokyo, minNights: 3, maxNights: 6, mustInclude: true, lockPosition: 2 });
  });

  it("uses defaults for a city with no saved rules, rejects unknown cities, and is coordinator only", async () => {
    const s = fake(alice);
    await updateDestinationConstraint(s, { tripId, destinationId: seoul, minNights: 2 });
    expect(s.upsertDestinationConstraint).toHaveBeenCalledWith(tripId, { destinationId: seoul, minNights: 2, maxNights: null, mustInclude: false, lockPosition: null });
    expect(await code(updateDestinationConstraint(fake(alice), { tripId, destinationId: randomUUID(), mustInclude: true }))).toBe("not_found");
    expect(await code(updateDestinationConstraint(fake(bob), { tripId, destinationId: tokyo, mustInclude: true }))).toBe("forbidden");
  });
});

describe("removeCandidateCity", () => {
  it("lets the coordinator remove a city", async () => {
    const deleteDestination = vi.fn(async () => true);
    await removeCandidateCity(fake(alice, { deleteDestination }), { tripId, destinationId: tokyo });
    expect(deleteDestination).toHaveBeenCalledWith(tripId, tokyo);
  });

  it("is forbidden for a member and not_found for an outsider, without deleting", async () => {
    const deleteDestination = vi.fn(async () => true);
    expect(await code(removeCandidateCity(fake(bob, { deleteDestination }), { tripId, destinationId: tokyo }))).toBe("forbidden");
    expect(await code(removeCandidateCity(fake(eve, { deleteDestination }), { tripId, destinationId: tokyo }))).toBe("not_found");
    expect(await code(removeCandidateCity(fake(null, { deleteDestination }), { tripId, destinationId: tokyo }))).toBe("unauthenticated");
    expect(deleteDestination).not.toHaveBeenCalled();
  });

  it("is not_found for an unknown id and invalid_input for a malformed one", async () => {
    const none = vi.fn(async () => false);
    expect(await code(removeCandidateCity(fake(alice, { deleteDestination: none }), { tripId, destinationId: randomUUID() }))).toBe("not_found");
    expect(await code(removeCandidateCity(fake(alice), { tripId, destinationId: "x" }))).toBe("invalid_input");
  });
});

describe("addCandidateCity", () => {
  const insert = () => vi.fn(async (i: { name: string; suggestedBy: string }) => ({ id: randomUUID(), name: i.name, suggestedBy: i.suggestedBy }));

  it("lets any member add a city as themselves", async () => {
    const insertDestination = insert();
    await addCandidateCity(fake(bob, { insertDestination }), { tripId, name: "Paris, France" });
    expect(insertDestination).toHaveBeenCalledWith({
      tripId,
      name: "Paris, France",
      suggestedBy: bob,
      lat: expect.any(Number),
      lng: expect.any(Number),
    });
  });

  it("stores no coordinates for a name that is not in the catalog", async () => {
    const insertDestination = insert();
    await addCandidateCity(fake(bob, { insertDestination }), { tripId, name: "Nowhereville, Atlantis" });
    expect(insertDestination).toHaveBeenCalledWith({ tripId, name: "Nowhereville, Atlantis", suggestedBy: bob });
  });

  it("refuses a duplicate and a ninth city with a readable conflict", async () => {
    const insertDestination = insert();
    const dup = await addCandidateCity(fake(bob, { insertDestination }), { tripId, name: "tokyo, japan" }).catch((e: ServiceError) => e);
    expect(dup).toMatchObject({ code: "conflict" });
    expect((dup as ServiceError).message).toContain("already on the list");
    const full = Array.from({ length: 8 }, (_, i) => ({ id: randomUUID(), name: `City ${i}`, suggestedBy: alice }));
    const ninth = await addCandidateCity(fake(bob, { insertDestination, listDestinations: async () => full }), { tripId, name: "Paris, France" }).catch((e: ServiceError) => e);
    expect((ninth as ServiceError).message).toContain("at most 8");
    expect(insertDestination).not.toHaveBeenCalled();
  });

  it("is not_found for an outsider", async () => {
    expect(await code(addCandidateCity(fake(eve), { tripId, name: "Paris, France" }))).toBe("not_found");
  });
});
