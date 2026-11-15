import { createHash, randomBytes, randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { newClient, readCode, signInWithEmailCode, type TestUser } from "./helpers";

// supabase-store imports the cookie-bound client factory, which pulls in next/headers. These
// tests build their own clients with real sessions and never call it.
vi.mock("@/db/server", () => ({ createServerDb: vi.fn() }));

import { createAuthGateway, createSupabaseStore } from "@/server/supabase-store";
import type { PlanningStore, Store } from "@/server/store";

// Runs every query in supabase-store.ts against the real local stack, as real signed-in users
// (row-level security applies), plus the negative cases: an outsider gets nothing, and one
// member cannot read another member's private budget.

type S = Store & PlanningStore;

const sha256Hex = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
const newToken = () => randomBytes(32).toString("base64url");
const inDays = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString();

const START = "2027-03-01";
const END = "2027-03-20";

describe("supabase-store against the real database", () => {
  let alice: TestUser; // coordinator
  let bob: TestUser; // member
  let carol: TestUser; // outsider, never joins
  let dave: TestUser; // joins, then is removed
  let a: S;
  let b: S;
  let c: S;
  let d: S;
  let anon: S;
  let tripId: string;
  let tokyo: string;
  let seoul: string;
  let inviteToken: string;
  let inviteId: string;

  beforeAll(async () => {
    [alice, bob, carol, dave] = await Promise.all([
      signInWithEmailCode("alice"),
      signInWithEmailCode("bob"),
      signInWithEmailCode("carol"),
      signInWithEmailCode("dave"),
    ]);
    a = createSupabaseStore(alice.db);
    b = createSupabaseStore(bob.db);
    c = createSupabaseStore(carol.db);
    d = createSupabaseStore(dave.db);
    anon = createSupabaseStore(newClient());

    await a.setDisplayName(alice.userId, "Alice");
    await b.setDisplayName(bob.userId, "Bob");
    await c.setDisplayName(carol.userId, "Carol");
    await d.setDisplayName(dave.userId, "Dave");

    tripId = await a.createTrip({ name: "Asia", baseCurrency: "USD", groupTargetMinor: 300000 });
    inviteToken = newToken();
    const invite = await a.insertInvite({
      tripId,
      tokenHash: sha256Hex(inviteToken),
      createdBy: alice.userId,
      expiresAt: inDays(7),
    });
    inviteId = invite.id;
    expect(await b.joinWithInvite(inviteToken)).toBe(tripId);

    tokyo = (await a.insertDestination({ tripId, name: "Tokyo", suggestedBy: alice.userId, lat: 35.68, lng: 139.69 })).id;
    seoul = (await b.insertDestination({ tripId, name: "Seoul", suggestedBy: bob.userId })).id;
  });

  describe("session and profile", () => {
    it("currentUserId is the verified user, and null with no session", async () => {
      expect(await a.currentUserId()).toBe(alice.userId);
      expect(await anon.currentUserId()).toBeNull();
    });

    it("reads and writes the caller's own display name", async () => {
      expect(await a.getDisplayName(alice.userId)).toBe("Alice");
      await a.setDisplayName(alice.userId, "Alice A");
      expect(await a.getDisplayName(alice.userId)).toBe("Alice A");
      await a.setDisplayName(alice.userId, "Alice");
    });

    it("hides a stranger's profile and refuses to rename someone else", async () => {
      // Carol shares no trip with Alice, so row-level security returns no profile row.
      expect(await c.getDisplayName(alice.userId)).toBeNull();
      expect(await c.getDisplayName(randomUUID())).toBeNull();
      await expect(b.setDisplayName(alice.userId, "Hacked")).rejects.toMatchObject({ code: "not_found" });
      expect(await a.getDisplayName(alice.userId)).toBe("Alice");
    });

    it("rejects a display name over 80 characters", async () => {
      await expect(a.setDisplayName(alice.userId, "x".repeat(81))).rejects.toMatchObject({ code: "invalid_input" });
    });
  });

  describe("trips and members", () => {
    it("createTrip stores the trip and makes the creator the coordinator", async () => {
      const trip = await a.getTrip(tripId);
      expect(trip).toMatchObject({ id: tripId, name: "Asia", baseCurrency: "USD", status: "planning", groupTargetMinor: 300000 });
      expect(trip?.startDate).toBeNull();
      expect(await a.getRole(tripId, alice.userId)).toBe("coordinator");
      expect(await b.getRole(tripId, bob.userId)).toBe("member");
    });

    it("createTrip validates its input", async () => {
      await expect(a.createTrip({ name: "   ", baseCurrency: "USD" })).rejects.toMatchObject({ code: "invalid_input" });
      await expect(a.createTrip({ name: "Bad", baseCurrency: "usd" })).rejects.toMatchObject({ code: "invalid_input" });
      await expect(anon.createTrip({ name: "Nope", baseCurrency: "USD" })).rejects.toMatchObject({ code: "forbidden" });
    });

    it("listMyTrips returns only trips the user belongs to, with their role", async () => {
      expect((await a.listMyTrips(alice.userId)).find((t) => t.id === tripId)?.role).toBe("coordinator");
      expect((await b.listMyTrips(bob.userId)).find((t) => t.id === tripId)?.role).toBe("member");
      expect(await c.listMyTrips(carol.userId)).toEqual([]);
      // Asking for someone else's memberships still only returns what row-level security allows.
      expect((await c.listMyTrips(alice.userId)).filter((t) => t.id === tripId)).toEqual([]);
    });

    it("an outsider cannot read the trip, its role list or its members", async () => {
      expect(await c.getTrip(tripId)).toBeNull();
      expect(await c.getRole(tripId, alice.userId)).toBeNull();
      expect(await c.listMembers(tripId)).toEqual([]);
      expect(await anon.getTrip(tripId)).toBeNull();
    });

    it("listMembers shows every member with display names, in join order", async () => {
      const members = await b.listMembers(tripId);
      expect(members.map((m) => [m.displayName, m.role])).toEqual([
        ["Alice", "coordinator"],
        ["Bob", "member"],
      ]);
      expect(members[0]?.userId).toBe(alice.userId);
    });

    it("setTripDates is coordinator-only and can be cleared", async () => {
      await a.setTripDates(tripId, START, END);
      expect(await b.getTrip(tripId)).toMatchObject({ startDate: START, endDate: END });
      await expect(b.setTripDates(tripId, "2028-01-01", "2028-01-05")).rejects.toMatchObject({ code: "forbidden" });
      await expect(c.setTripDates(tripId, "2028-01-01", "2028-01-05")).rejects.toMatchObject({ code: "forbidden" });
      expect(await a.getTrip(tripId)).toMatchObject({ startDate: START, endDate: END });
      // End before start and half-set dates violate table checks.
      await expect(a.setTripDates(tripId, END, START)).rejects.toMatchObject({ code: "invalid_input" });
      await expect(a.setTripDates(tripId, START, null)).rejects.toMatchObject({ code: "invalid_input" });
    });
  });

  describe("invitations", () => {
    it("the coordinator lists and reads invitations, a member does not", async () => {
      expect((await a.listInvites(tripId)).map((i) => i.id)).toContain(inviteId);
      expect(await a.getInvite(inviteId)).toMatchObject({ id: inviteId, tripId, revokedAt: null });
      expect(await b.listInvites(tripId)).toEqual([]);
      expect(await b.getInvite(inviteId)).toBeNull();
      expect(await c.listInvites(tripId)).toEqual([]);
    });

    it("a member cannot create an invitation, and the expiry window is enforced", async () => {
      await expect(
        b.insertInvite({ tripId, tokenHash: sha256Hex(newToken()), createdBy: bob.userId, expiresAt: inDays(7) }),
      ).rejects.toMatchObject({ code: "forbidden" });
      await expect(
        a.insertInvite({ tripId, tokenHash: sha256Hex(newToken()), createdBy: alice.userId, expiresAt: inDays(120) }),
      ).rejects.toMatchObject({ code: "forbidden" });
      // The token hash is unique.
      await expect(
        a.insertInvite({ tripId, tokenHash: sha256Hex(inviteToken), createdBy: alice.userId, expiresAt: inDays(7) }),
      ).rejects.toMatchObject({ code: "conflict" });
    });

    it("getInvitePreview works signed out and shows only the preview facts", async () => {
      const preview = await anon.getInvitePreview(inviteToken);
      expect(preview).toEqual({
        tripName: "Asia",
        inviterName: "Alice",
        memberCount: 2,
        startDate: START,
        endDate: END,
        departureAirport: null,
      });
    });

    it("getInvitePreview returns null for unknown, short and empty tokens", async () => {
      expect(await anon.getInvitePreview(newToken())).toBeNull();
      expect(await anon.getInvitePreview("short")).toBeNull();
      expect(await anon.getInvitePreview("")).toBeNull();
      expect(await c.getInvitePreview("x".repeat(300))).toBeNull();
    });

    it("getTripIfMember returns the trip id for a member and null for everyone else", async () => {
      expect(await b.getTripIfMember(inviteToken)).toBe(tripId);
      expect(await a.getTripIfMember(inviteToken)).toBe(tripId);
      expect(await c.getTripIfMember(inviteToken)).toBeNull();
      expect(await b.getTripIfMember(newToken())).toBeNull();
      // Signed out, the database refuses the call outright.
      await expect(anon.getTripIfMember(inviteToken)).rejects.toMatchObject({ code: "forbidden" });
    });

    it("joinWithInvite rejects a member who is already in, naming the trip", async () => {
      await expect(b.joinWithInvite(inviteToken)).rejects.toMatchObject({ code: "already_member", tripId });
    });

    it("joinWithInvite rejects unknown and malformed tokens, and signed-out callers", async () => {
      await expect(c.joinWithInvite(newToken())).rejects.toMatchObject({ code: "invite_invalid" });
      await expect(c.joinWithInvite("short")).rejects.toMatchObject({ code: "invite_invalid" });
      await expect(anon.joinWithInvite(inviteToken)).rejects.toMatchObject({ code: "forbidden" });
      expect(await c.getRole(tripId, carol.userId)).toBeNull();
    });

    it("revokeInvite by a member does nothing, by the coordinator ends the link", async () => {
      const token = newToken();
      const invite = await a.insertInvite({ tripId, tokenHash: sha256Hex(token), createdBy: alice.userId, expiresAt: inDays(7) });
      expect(await anon.getInvitePreview(token)).not.toBeNull();

      await b.revokeInvite(invite.id);
      expect((await a.getInvite(invite.id))?.revokedAt).toBeNull();
      expect(await anon.getInvitePreview(token)).not.toBeNull();

      await a.revokeInvite(invite.id);
      expect((await a.getInvite(invite.id))?.revokedAt).not.toBeNull();
      expect(await anon.getInvitePreview(token)).toBeNull();
      await expect(c.joinWithInvite(token)).rejects.toMatchObject({ code: "invite_invalid" });
      expect(await c.getTripIfMember(token)).toBeNull();
      // Revoking again is the same end state, not an error.
      await a.revokeInvite(invite.id);
    });
  });

  describe("destinations", () => {
    it("members list destinations with coordinates, in creation order", async () => {
      const list = await b.listDestinations(tripId);
      expect(list.map((x) => x.name)).toEqual(["Tokyo", "Seoul"]);
      expect(list[0]).toMatchObject({ id: tokyo, suggestedBy: alice.userId, lat: 35.68, lng: 139.69 });
      expect(list[1]).toMatchObject({ id: seoul, suggestedBy: bob.userId, lat: null, lng: null });
    });

    it("an outsider sees no destinations and cannot add one", async () => {
      expect(await c.listDestinations(tripId)).toEqual([]);
      await expect(c.insertDestination({ tripId, name: "Osaka", suggestedBy: carol.userId })).rejects.toMatchObject({ code: "forbidden" });
    });

    it("a member cannot suggest a city as someone else", async () => {
      await expect(b.insertDestination({ tripId, name: "Osaka", suggestedBy: alice.userId })).rejects.toMatchObject({ code: "forbidden" });
    });

    it("rejects a duplicate name and out-of-range coordinates", async () => {
      await expect(a.insertDestination({ tripId, name: " tokyo ", suggestedBy: alice.userId })).rejects.toMatchObject({ code: "conflict" });
      await expect(a.insertDestination({ tripId, name: "Pole", suggestedBy: alice.userId, lat: 95, lng: 0 })).rejects.toMatchObject({ code: "invalid_input" });
    });

    it("only the coordinator can remove a city, and everything that depends on it goes too", async () => {
      const osaka = (await a.insertDestination({ tripId, name: "Osaka", suggestedBy: alice.userId, lat: 34.69, lng: 135.5 })).id;
      await b.upsertPreference({ tripId, destinationId: osaka, userId: bob.userId, score: 2 });
      await a.upsertDestinationConstraint(tripId, { destinationId: osaka, minNights: 2, maxNights: 4, mustInclude: false, lockPosition: null });
      await a.insertFixedEvent(tripId, { destinationId: osaka, label: "Festival", startDate: "2027-03-05", endDate: "2027-03-06" });
      await a.insertManualQuote({
        tripId,
        createdBy: alice.userId,
        kind: "leg",
        mode: "train",
        fromDestinationId: tokyo,
        toDestinationId: osaka,
        returnFromDestinationId: null,
        originAirport: null,
        destinationAirport: null,
        durationMinutes: 150,
        returnMinutes: null,
        amountMinor: 14000,
        currency: "USD",
        expiresAt: null,
      });
      const before = await a.getTripConstraints(tripId);
      await a.upsertTripConstraints(tripId, { ...(before ?? emptyConstraints()), endDestinationId: osaka });

      // A member and an outsider remove nothing.
      expect(await b.deleteDestination(tripId, osaka)).toBe(false);
      expect(await c.deleteDestination(tripId, osaka)).toBe(false);
      expect((await a.listDestinations(tripId)).map((x) => x.id)).toContain(osaka);

      expect(await a.deleteDestination(tripId, osaka)).toBe(true);
      expect(await a.deleteDestination(tripId, osaka)).toBe(false);
      expect((await a.listDestinations(tripId)).map((x) => x.id)).not.toContain(osaka);
      expect((await a.listPreferences(tripId)).filter((p) => p.destinationId === osaka)).toEqual([]);
      expect((await a.listDestinationConstraints(tripId)).filter((x) => x.destinationId === osaka)).toEqual([]);
      expect((await a.listFixedEvents(tripId)).filter((e) => e.destinationId === osaka)).toEqual([]);
      expect((await a.listQuotes(tripId)).filter((q) => q.toDestinationId === osaka)).toEqual([]);
      // The trip constraint that pointed at it is cleared, not left dangling.
      expect((await a.getTripConstraints(tripId))?.endDestinationId).toBeNull();
      // Unknown ids remove nothing.
      expect(await a.deleteDestination(tripId, randomUUID())).toBe(false);
    });
  });

  describe("preferences", () => {
    it("a member upserts their own score and the group can read it", async () => {
      const first = await b.upsertPreference({ tripId, destinationId: tokyo, userId: bob.userId, score: 1 });
      expect(first).toEqual({ destinationId: tokyo, userId: bob.userId, score: 1 });
      await b.upsertPreference({ tripId, destinationId: tokyo, userId: bob.userId, score: -2 });
      await a.upsertPreference({ tripId, destinationId: tokyo, userId: alice.userId, score: 2 });

      const list = await a.listPreferences(tripId);
      const tokyoScores = list.filter((p) => p.destinationId === tokyo).map((p) => [p.userId, p.score]).sort();
      expect(tokyoScores).toEqual(
        [[alice.userId, 2], [bob.userId, -2]].sort(),
      );
      expect(await b.listPreferences(tripId)).toHaveLength(list.length);
    });

    it("cannot score as someone else, outside the trip, or out of range", async () => {
      await expect(b.upsertPreference({ tripId, destinationId: seoul, userId: alice.userId, score: 2 })).rejects.toMatchObject({ code: "forbidden" });
      await expect(c.upsertPreference({ tripId, destinationId: seoul, userId: carol.userId, score: 2 })).rejects.toMatchObject({ code: "forbidden" });
      await expect(b.upsertPreference({ tripId, destinationId: seoul, userId: bob.userId, score: 3 })).rejects.toMatchObject({ code: "invalid_input" });
      expect(await c.listPreferences(tripId)).toEqual([]);
    });
  });

  describe("budgets (private)", () => {
    it("a member stores and reads back their own band, ceiling and currency", async () => {
      const row = await a.upsertBudget({
        tripId,
        userId: alice.userId,
        band: "2k_3k",
        ceilingMinor: 300000,
        currency: "USD",
        flexibilityMinor: 25000,
      });
      expect(row).toEqual({ tripId, band: "2k_3k", ceilingMinor: 300000, currency: "USD", flexibilityMinor: 25000 });

      const updated = await a.upsertBudget({ tripId, userId: alice.userId, band: "3k_4k", ceilingMinor: 400000, currency: "USD", flexibilityMinor: null });
      expect(updated.band).toBe("3k_4k");
      expect(await a.getBudget(tripId, alice.userId)).toEqual(updated);
    });

    it("the open-ended band is stored with no ceiling", async () => {
      const row = await b.upsertBudget({ tripId, userId: bob.userId, band: "4k_plus", ceilingMinor: null, currency: "CAD", flexibilityMinor: null });
      expect(row).toMatchObject({ band: "4k_plus", ceilingMinor: null, currency: "CAD" });
      expect(await b.getBudget(tripId, bob.userId)).toEqual(row);
    });

    it("a member cannot read another member's budget, not even the coordinator", async () => {
      // Both rows exist (Alice and Bob above). Neither can see the other's.
      expect(await b.getBudget(tripId, alice.userId)).toBeNull();
      expect(await a.getBudget(tripId, bob.userId)).toBeNull();
      expect(await c.getBudget(tripId, alice.userId)).toBeNull();
      // The same through raw table access, not only the store's filter.
      const seenByBob = await bob.db.from("member_budgets").select("user_id, band").eq("trip_id", tripId);
      expect(seenByBob.error).toBeNull();
      expect(seenByBob.data).toEqual([{ user_id: bob.userId, band: "4k_plus" }]);
      const seenByAlice = await alice.db.from("member_budgets").select("user_id").eq("trip_id", tripId);
      expect(seenByAlice.data).toEqual([{ user_id: alice.userId }]);
    });

    it("cannot write another member's budget or one outside the trip", async () => {
      await expect(b.upsertBudget({ tripId, userId: alice.userId, band: "under_2k", ceilingMinor: 200000, currency: "USD", flexibilityMinor: null })).rejects.toMatchObject({ code: "forbidden" });
      await expect(c.upsertBudget({ tripId, userId: carol.userId, band: "under_2k", ceilingMinor: 200000, currency: "USD", flexibilityMinor: null })).rejects.toMatchObject({ code: "forbidden" });
      expect((await a.getBudget(tripId, alice.userId))?.band).toBe("3k_4k");
    });

    it("a budget must have a band or a ceiling, and a sane currency", async () => {
      await expect(a.upsertBudget({ tripId, userId: alice.userId, band: null as never, ceilingMinor: null, currency: "USD", flexibilityMinor: null })).rejects.toMatchObject({ code: "invalid_input" });
      await expect(a.upsertBudget({ tripId, userId: alice.userId, band: "2k_3k", ceilingMinor: 300000, currency: "usd", flexibilityMinor: null })).rejects.toMatchObject({ code: "invalid_input" });
    });
  });

  describe("trip constraints, destination constraints and fixed events", () => {
    it("trip constraints start empty, are written by the coordinator and read by members", async () => {
      // A trip nobody has configured has no constraints row.
      const fresh = await a.createTrip({ name: "Empty", baseCurrency: "USD" });
      expect(await a.getTripConstraints(fresh)).toBeNull();
      const written = await a.upsertTripConstraints(tripId, {
        departureAirport: "YVR",
        startDestinationId: tokyo,
        endDestinationId: seoul,
        earliestStart: START,
        latestEnd: END,
        minNights: 5,
        maxNights: 18,
      });
      expect(written).toMatchObject({ departureAirport: "YVR", startDestinationId: tokyo, endDestinationId: seoul, minNights: 5, maxNights: 18 });
      expect(await b.getTripConstraints(tripId)).toEqual(written);
      // The invite preview picks up the departure airport.
      expect((await anon.getInvitePreview(inviteToken))?.departureAirport).toBe("YVR");
    });

    it("trip constraints refuse members, outsiders and invalid values", async () => {
      const row = await a.getTripConstraints(tripId);
      if (!row) throw new Error("constraints missing");
      await expect(b.upsertTripConstraints(tripId, { ...row, minNights: 1 })).rejects.toMatchObject({ code: "forbidden" });
      await expect(c.upsertTripConstraints(tripId, row)).rejects.toMatchObject({ code: "forbidden" });
      expect(await c.getTripConstraints(tripId)).toBeNull();
      await expect(a.upsertTripConstraints(tripId, { ...row, departureAirport: "yvr" })).rejects.toMatchObject({ code: "invalid_input" });
      await expect(a.upsertTripConstraints(tripId, { ...row, minNights: 10, maxNights: 5 })).rejects.toMatchObject({ code: "invalid_input" });
      await expect(a.upsertTripConstraints(tripId, { ...row, startDestinationId: randomUUID() })).rejects.toMatchObject({ code: "not_found" });
      expect(await a.getTripConstraints(tripId)).toEqual(row);
    });

    it("destination constraints round trip, lock positions are unique, members cannot write", async () => {
      const tokyoRow = { destinationId: tokyo, minNights: 3, maxNights: 6, mustInclude: true, lockPosition: 1 };
      expect(await a.upsertDestinationConstraint(tripId, tokyoRow)).toEqual(tokyoRow);
      const changed = await a.upsertDestinationConstraint(tripId, { ...tokyoRow, minNights: 4 });
      expect(changed.minNights).toBe(4);
      expect(await b.listDestinationConstraints(tripId)).toEqual([changed]);

      await expect(a.upsertDestinationConstraint(tripId, { destinationId: seoul, minNights: 2, maxNights: null, mustInclude: false, lockPosition: 1 })).rejects.toMatchObject({ code: "conflict" });
      await expect(b.upsertDestinationConstraint(tripId, { destinationId: seoul, minNights: 2, maxNights: null, mustInclude: false, lockPosition: null })).rejects.toMatchObject({ code: "forbidden" });
      await expect(a.upsertDestinationConstraint(tripId, { destinationId: seoul, minNights: 5, maxNights: 2, mustInclude: false, lockPosition: null })).rejects.toMatchObject({ code: "invalid_input" });
      expect(await c.listDestinationConstraints(tripId)).toEqual([]);
    });

    it("fixed events: coordinator adds and removes, members read, others cannot", async () => {
      const event = await a.insertFixedEvent(tripId, { destinationId: seoul, label: "Concert", startDate: "2027-03-10", endDate: "2027-03-11" });
      expect(event).toMatchObject({ destinationId: seoul, label: "Concert", startDate: "2027-03-10", endDate: "2027-03-11" });
      expect(await b.listFixedEvents(tripId)).toEqual([event]);
      expect(await c.listFixedEvents(tripId)).toEqual([]);

      await expect(b.insertFixedEvent(tripId, { destinationId: seoul, label: "Mine", startDate: START, endDate: START })).rejects.toMatchObject({ code: "forbidden" });
      await expect(a.insertFixedEvent(tripId, { destinationId: seoul, label: "Backwards", startDate: END, endDate: START })).rejects.toMatchObject({ code: "invalid_input" });
      await expect(a.insertFixedEvent(tripId, { destinationId: seoul, label: "  ", startDate: START, endDate: START })).rejects.toMatchObject({ code: "invalid_input" });

      expect(await b.deleteFixedEvent(tripId, event.id)).toBe(false);
      expect(await c.deleteFixedEvent(tripId, event.id)).toBe(false);
      expect(await a.deleteFixedEvent(tripId, event.id)).toBe(true);
      expect(await a.deleteFixedEvent(tripId, event.id)).toBe(false);
      expect(await a.listFixedEvents(tripId)).toEqual([]);
    });
  });

  describe("availability", () => {
    it("a member replaces their own ranges atomically and the group reads them", async () => {
      await b.setMyAvailability(tripId, 3, [
        { startDate: "2027-03-10", endDate: "2027-03-15" },
        { startDate: "2027-03-01", endDate: "2027-03-05" },
      ]);
      const first = (await a.listAvailability(tripId)).find((x) => x.userId === bob.userId);
      expect(first).toEqual({
        userId: bob.userId,
        flexibilityDays: 3,
        ranges: [
          { startDate: "2027-03-01", endDate: "2027-03-05" },
          { startDate: "2027-03-10", endDate: "2027-03-15" },
        ],
      });

      await b.setMyAvailability(tripId, 0, [{ startDate: "2027-03-02", endDate: "2027-03-04" }]);
      const second = (await b.listAvailability(tripId)).find((x) => x.userId === bob.userId);
      expect(second).toEqual({ userId: bob.userId, flexibilityDays: 0, ranges: [{ startDate: "2027-03-02", endDate: "2027-03-04" }] });
    });

    it("only touches the caller's own availability", async () => {
      await a.setMyAvailability(tripId, 1, []);
      const all = await a.listAvailability(tripId);
      expect(all.find((x) => x.userId === alice.userId)).toEqual({ userId: alice.userId, flexibilityDays: 1, ranges: [] });
      expect(all.find((x) => x.userId === bob.userId)?.ranges).toHaveLength(1);
    });

    it("an outsider cannot set or read availability", async () => {
      await expect(c.setMyAvailability(tripId, 0, [])).rejects.toMatchObject({ code: "forbidden" });
      expect(await c.listAvailability(tripId)).toEqual([]);
    });

    it("rejects bad ranges, bad dates, too many ranges and too much flexibility, leaving data intact", async () => {
      await expect(b.setMyAvailability(tripId, 0, [{ startDate: "2027-03-09", endDate: "2027-03-01" }])).rejects.toMatchObject({ code: "invalid_input" });
      await expect(b.setMyAvailability(tripId, 0, [{ startDate: "not-a-date", endDate: "2027-03-01" }])).rejects.toMatchObject({ code: "invalid_input" });
      await expect(b.setMyAvailability(tripId, 99, [])).rejects.toMatchObject({ code: "invalid_input" });
      const many = Array.from({ length: 21 }, () => ({ startDate: "2027-03-01", endDate: "2027-03-02" }));
      await expect(b.setMyAvailability(tripId, 0, many)).rejects.toMatchObject({ code: "invalid_input" });
      const bobs = (await b.listAvailability(tripId)).find((x) => x.userId === bob.userId);
      expect(bobs?.ranges).toEqual([{ startDate: "2027-03-02", endDate: "2027-03-04" }]);
    });
  });

  describe("quotes", () => {
    const leg = (over: Partial<Parameters<PlanningStore["insertManualQuote"]>[0]> = {}): Parameters<PlanningStore["insertManualQuote"]>[0] => ({
      tripId,
      createdBy: alice.userId,
      kind: "leg",
      mode: "flight",
      fromDestinationId: tokyo,
      toDestinationId: seoul,
      returnFromDestinationId: null,
      originAirport: "NRT",
      destinationAirport: "ICN",
      durationMinutes: 150,
      returnMinutes: null,
      amountMinor: 21000,
      currency: "USD",
      expiresAt: null,
      ...over,
    });

    it("the coordinator adds a manual quote and members read it", async () => {
      const q = await a.insertManualQuote(leg());
      expect(q).toMatchObject({ kind: "leg", mode: "flight", source: "manual", amountMinor: 21000, currency: "USD", adults: 1, createdBy: alice.userId });
      expect(new Date(q.fetchedAt).getTime()).not.toBeNaN();
      expect((await b.listQuotes(tripId)).map((x) => x.id)).toContain(q.id);
      expect(await c.listQuotes(tripId)).toEqual([]);
      expect(await b.deleteQuote(tripId, q.id)).toBe(false);
      expect(await c.deleteQuote(tripId, q.id)).toBe(false);
      expect(await a.deleteQuote(tripId, q.id)).toBe(true);
      expect(await a.deleteQuote(tripId, q.id)).toBe(false);
    });

    it("accepts a long-haul fare with a return leg", async () => {
      const q = await a.insertManualQuote(
        leg({ kind: "long_haul_fare", fromDestinationId: null, toDestinationId: tokyo, returnFromDestinationId: seoul, originAirport: "YVR", destinationAirport: "NRT", durationMinutes: 600, returnMinutes: 660, amountMinor: 120000 }),
      );
      expect(q).toMatchObject({ kind: "long_haul_fare", returnFromDestinationId: seoul, returnMinutes: 660 });
      expect(await a.deleteQuote(tripId, q.id)).toBe(true);
    });

    it("refuses members, outsiders and malformed quotes", async () => {
      await expect(b.insertManualQuote(leg({ createdBy: bob.userId }))).rejects.toMatchObject({ code: "forbidden" });
      await expect(c.insertManualQuote(leg({ createdBy: carol.userId }))).rejects.toMatchObject({ code: "forbidden" });
      // Attributing a quote to another user is refused.
      await expect(a.insertManualQuote(leg({ createdBy: bob.userId }))).rejects.toMatchObject({ code: "forbidden" });
      await expect(a.insertManualQuote(leg({ toDestinationId: tokyo }))).rejects.toMatchObject({ code: "invalid_input" });
      await expect(a.insertManualQuote(leg({ amountMinor: -1 }))).rejects.toMatchObject({ code: "invalid_input" });
      await expect(a.insertManualQuote(leg({ durationMinutes: 0 }))).rejects.toMatchObject({ code: "invalid_input" });
      await expect(a.insertManualQuote(leg({ fromDestinationId: randomUUID() }))).rejects.toMatchObject({ code: "not_found" });
      expect((await a.listQuotes(tripId)).filter((q) => q.mode === "flight" && q.amountMinor === 21000)).toEqual([]);
    });
  });

  describe("saved route scenarios", () => {
    const hash = () => createHash("sha256").update(randomUUID()).digest("hex");

    it("a member saves a result, finds it by version and hash, and the group lists it", async () => {
      const inputHash = hash();
      const saved = await b.insertScenario({
        tripId,
        engineVersion: "test-1",
        inputHash,
        input: { cities: ["Tokyo", "Seoul"] },
        // Mirrors a result that includes an estimated leg (a stored shape, not engine output).
        result: { routes: [{ legs: [{ from: "Tokyo", to: "Seoul", source: "estimate" }] }] },
        ok: true,
        createdBy: bob.userId,
      });
      expect(saved).toMatchObject({ engineVersion: "test-1", inputHash, ok: true, createdBy: bob.userId });
      expect(saved.result).toEqual({ routes: [{ legs: [{ from: "Tokyo", to: "Seoul", source: "estimate" }] }] });

      expect((await a.findScenario(tripId, "test-1", inputHash))?.id).toBe(saved.id);
      expect(await a.findScenario(tripId, "test-2", inputHash)).toBeNull();
      expect(await a.findScenario(tripId, "test-1", hash())).toBeNull();
      expect((await a.listScenarios(tripId)).map((s) => s.id)).toContain(saved.id);
    });

    it("the same version and input cannot be saved twice", async () => {
      const inputHash = hash();
      const row = { tripId, engineVersion: "test-1", inputHash, input: {}, result: {}, ok: false, createdBy: alice.userId };
      await a.insertScenario(row);
      await expect(a.insertScenario(row)).rejects.toMatchObject({ code: "conflict" });
    });

    it("an outsider cannot read or save scenarios, and nobody can save as someone else", async () => {
      const inputHash = hash();
      await expect(c.insertScenario({ tripId, engineVersion: "test-1", inputHash, input: {}, result: {}, ok: true, createdBy: carol.userId })).rejects.toMatchObject({ code: "forbidden" });
      await expect(b.insertScenario({ tripId, engineVersion: "test-1", inputHash, input: {}, result: {}, ok: true, createdBy: alice.userId })).rejects.toMatchObject({ code: "forbidden" });
      await expect(a.insertScenario({ tripId, engineVersion: "test-1", inputHash: "nothex", input: {}, result: {}, ok: true, createdBy: alice.userId })).rejects.toMatchObject({ code: "invalid_input" });
      expect(await c.listScenarios(tripId)).toEqual([]);
      expect(await c.findScenario(tripId, "test-1", inputHash)).toBeNull();
    });
  });

  describe("removing a member", () => {
    it("takes the membership, preferences and budget, and leaves the city they suggested", async () => {
      const token = newToken();
      await a.insertInvite({ tripId, tokenHash: sha256Hex(token), createdBy: alice.userId, expiresAt: inDays(7) });
      expect(await d.joinWithInvite(token)).toBe(tripId);
      const berlin = (await d.insertDestination({ tripId, name: "Berlin", suggestedBy: dave.userId })).id;
      await d.upsertPreference({ tripId, destinationId: tokyo, userId: dave.userId, score: 1 });
      await d.upsertBudget({ tripId, userId: dave.userId, band: "under_2k", ceilingMinor: 200000, currency: "USD", flexibilityMinor: null });
      expect((await a.listMembers(tripId)).map((m) => m.userId)).toContain(dave.userId);

      // Only the coordinator, never oneself, never a stranger.
      await expect(b.removeMember(tripId, dave.userId)).rejects.toMatchObject({ code: "forbidden" });
      await expect(c.removeMember(tripId, dave.userId)).rejects.toMatchObject({ code: "forbidden" });
      await expect(a.removeMember(tripId, alice.userId)).rejects.toMatchObject({ code: "invalid_input" });
      await expect(a.removeMember(tripId, carol.userId)).rejects.toMatchObject({ code: "not_found" });

      await a.removeMember(tripId, dave.userId);
      expect(await d.getRole(tripId, dave.userId)).toBeNull();
      expect(await d.getTrip(tripId)).toBeNull();
      expect(await d.getBudget(tripId, dave.userId)).toBeNull();
      expect((await a.listMembers(tripId)).map((m) => m.userId)).not.toContain(dave.userId);
      expect((await a.listPreferences(tripId)).filter((p) => p.userId === dave.userId)).toEqual([]);
      expect((await a.listDestinations(tripId)).map((x) => x.id)).toContain(berlin);
      // The same link still works to rejoin, since the link is reusable.
      expect(await d.joinWithInvite(token)).toBe(tripId);
    });
  });

  describe("auth gateway", () => {
    it("signs in with an emailed code, rejects a wrong one, and signs out", async () => {
      const email = `gateway-${randomUUID().slice(0, 8)}@example.test`;
      const db = newClient();
      const gateway = createAuthGateway(db);
      const store = createSupabaseStore(db);

      await gateway.sendMagicLink(email, "http://127.0.0.1:3000/auth/callback");
      const code = await readCode(email);
      const wrong = code === "000000" ? "111111" : "000000";
      expect(await gateway.verifyEmailCode(email, wrong)).toBe(false);
      expect(await store.currentUserId()).toBeNull();

      expect(await gateway.verifyEmailCode(email, code)).toBe(true);
      expect(await store.currentUserId()).not.toBeNull();

      await gateway.signOut();
      expect(await store.currentUserId()).toBeNull();
    });

    it("exchangeCode refuses a code that was never issued", async () => {
      expect(await createAuthGateway(newClient()).exchangeCode("not-a-real-code")).toBe(false);
    });
  });
});

function emptyConstraints() {
  return {
    departureAirport: null,
    startDestinationId: null,
    endDestinationId: null,
    earliestStart: null,
    latestEnd: null,
    minNights: null,
    maxNights: null,
  };
}
