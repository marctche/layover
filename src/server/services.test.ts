import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { completeSignIn, safeNextPath, signInWithMagicLink } from "./auth";
import { ServiceError } from "./errors";
import { createInvite, hashInviteToken, joinWithInvite, revokeInvite } from "./invites";
import { setOwnBudget, setPreference, suggestDestination } from "./planning";
import type { AuthGateway, InviteRow, Role, Store } from "./store";
import { createTrip, getTrip, removeMember } from "./trips";

const alice = randomUUID(); // coordinator
const bob = randomUUID(); // member
const carol = randomUUID(); // not a member
const tripId = randomUUID();

/** A store that records calls. Memberships are fixed; everything else returns canned rows. */
function fakeStore(userId: string | null, overrides: Partial<Store> = {}): Store {
  const roles: Record<string, Role> = { [alice]: "coordinator", [bob]: "member" };
  return {
    currentUserId: async () => userId,
    createTrip: vi.fn(async () => tripId),
    removeMember: vi.fn(async () => {}),
    getRole: async (t, u) => (t === tripId ? (roles[u] ?? null) : null),
    getTrip: async () => ({
      id: tripId,
      name: "Asia",
      startDate: null,
      endDate: null,
      status: "planning",
      groupTargetMinor: null,
      baseCurrency: "USD",
    }),
    listMembers: async () => [],
    listDestinations: async () => [],
    listPreferences: async () => [],
    getBudget: vi.fn(async () => null),
    insertInvite: vi.fn(async (i): Promise<InviteRow> => ({
      id: randomUUID(),
      tripId: i.tripId,
      expiresAt: i.expiresAt,
      revokedAt: null,
    })),
    getInvite: async (id) => ({ id, tripId, expiresAt: "x", revokedAt: null }),
    revokeInvite: vi.fn(async () => {}),
    joinWithInvite: vi.fn(async () => tripId),
    insertDestination: vi.fn(async (i) => ({ id: randomUUID(), name: i.name, suggestedBy: i.suggestedBy })),
    upsertPreference: vi.fn(async (i) => ({ destinationId: i.destinationId, userId: i.userId, score: i.score })),
    upsertBudget: vi.fn(async (i) => ({ tripId: i.tripId, ceilingMinor: i.ceilingMinor })),
    ...overrides,
  };
}

const rejectsWith = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ServiceError);
  expect((err as ServiceError).code).toBe(code);
};

describe("input validation", () => {
  it("rejects bad trip input before touching the store", async () => {
    const store = fakeStore(alice);
    for (const bad of [
      {},
      { name: "   " },
      { name: "x", startDate: "2026-05-01" },
      { name: "x", startDate: "2026-05-10", endDate: "2026-05-01" },
      { name: "x", baseCurrency: "usd" },
      { name: "x" },
      { name: "x", groupTargetMinor: -1 },
      { name: "x", groupTargetMinor: 1.5 },
    ]) {
      await rejectsWith(createTrip(store, bad), "invalid_input");
    }
    expect(store.createTrip).not.toHaveBeenCalled();
  });

  it("rejects a client-supplied role or user id", async () => {
    const store = fakeStore(bob);
    await rejectsWith(createTrip(store, { name: "x", baseCurrency: "USD", role: "coordinator" }), "invalid_input");
    await rejectsWith(setOwnBudget(store, { tripId, ceilingMinor: 1, userId: alice }), "invalid_input");
    await rejectsWith(suggestDestination(store, { tripId, name: "Kyoto", suggestedBy: alice }), "invalid_input");
  });

  it("rejects out-of-range preference scores and malformed ids", async () => {
    const store = fakeStore(bob);
    const destinationId = randomUUID();
    await rejectsWith(setPreference(store, { tripId, destinationId, score: 3 }), "invalid_input");
    await rejectsWith(setPreference(store, { tripId, destinationId, score: -3 }), "invalid_input");
    await rejectsWith(setPreference(store, { tripId, destinationId, score: 0.5 }), "invalid_input");
    await rejectsWith(setPreference(store, { tripId: "nope", destinationId, score: 1 }), "invalid_input");
  });

  it("accepts scores from -2 to 2", async () => {
    const store = fakeStore(bob);
    for (const score of [-2, -1, 0, 1, 2]) {
      await expect(setPreference(store, { tripId, destinationId: randomUUID(), score })).resolves.toMatchObject({
        score,
      });
    }
  });
});

describe("authentication", () => {
  it("requires a signed-in user", async () => {
    const store = fakeStore(null);
    await rejectsWith(createTrip(store, { name: "x", baseCurrency: "USD" }), "unauthenticated");
    await rejectsWith(getTrip(store, { tripId }), "unauthenticated");
    await rejectsWith(joinWithInvite(store, { token: "a".repeat(43) }), "unauthenticated");
    expect(store.joinWithInvite).not.toHaveBeenCalled();
  });
});

describe("createTrip", () => {
  it("requires an explicit currency and passes no identity to the store", async () => {
    const store = fakeStore(alice);
    await rejectsWith(createTrip(store, { name: "Asia" }), "invalid_input");
    await expect(createTrip(store, { name: " Asia ", baseCurrency: "CAD" })).resolves.toEqual({ tripId });
    expect(store.createTrip).toHaveBeenCalledWith({ name: "Asia", baseCurrency: "CAD" });
  });
});

describe("getTrip", () => {
  it("hides the trip from non-members as not_found", async () => {
    await rejectsWith(getTrip(fakeStore(carol), { tripId }), "not_found");
  });

  it("asks for the budget of the caller only", async () => {
    const store = fakeStore(bob);
    await getTrip(store, { tripId });
    expect(store.getBudget).toHaveBeenCalledTimes(1);
    expect(store.getBudget).toHaveBeenCalledWith(tripId, bob);
  });

  it("returns the caller's own budget and nothing else", async () => {
    const store = fakeStore(bob, {
      getBudget: async (t, u) => (u === bob ? { tripId: t, ceilingMinor: 150000 } : { tripId: t, ceilingMinor: 999 }),
    });
    const view = await getTrip(store, { tripId });
    expect(view.myBudget).toEqual({ tripId, ceilingMinor: 150000 });
    expect(JSON.stringify(view)).not.toContain("999");
    expect(view.viewerRole).toBe("member");
  });

  it("gives the coordinator no extra budget access", async () => {
    const store = fakeStore(alice);
    await getTrip(store, { tripId });
    expect(store.getBudget).toHaveBeenCalledWith(tripId, alice);
    expect(store.getBudget).not.toHaveBeenCalledWith(tripId, bob);
  });
});

describe("invites", () => {
  const now = () => new Date("2030-01-01T00:00:00.000Z");

  it("lets only the coordinator create one", async () => {
    await rejectsWith(createInvite(fakeStore(bob), { tripId }), "forbidden");
    await rejectsWith(createInvite(fakeStore(carol), { tripId }), "not_found");
  });

  it("stores only the hash of a 32-byte token and expires in 14 days by default", async () => {
    const store = fakeStore(alice);
    const out = await createInvite(store, { tripId }, now);

    expect(Buffer.from(out.token, "base64url")).toHaveLength(32);
    const call = vi.mocked(store.insertInvite).mock.calls[0]![0];
    expect(call.tokenHash).toBe(hashInviteToken(out.token));
    expect(call.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(call)).not.toContain(out.token);
    expect(call.createdBy).toBe(alice);
    expect(call.expiresAt).toBe("2030-01-15T00:00:00.000Z");
  });

  it("hashes like the database does (sha-256 of the utf-8 string, hex)", () => {
    expect(hashInviteToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("makes a different token each time and bounds the lifetime", async () => {
    const store = fakeStore(alice);
    const a = await createInvite(store, { tripId });
    const b = await createInvite(store, { tripId });
    expect(a.token).not.toBe(b.token);
    await rejectsWith(createInvite(store, { tripId, expiresInDays: 0 }), "invalid_input");
    await rejectsWith(createInvite(store, { tripId, expiresInDays: 91 }), "invalid_input");
  });

  it("lets only the coordinator revoke", async () => {
    const id = randomUUID();
    const memberStore = fakeStore(bob);
    await rejectsWith(revokeInvite(memberStore, { inviteId: id }), "forbidden");
    expect(memberStore.revokeInvite).not.toHaveBeenCalled();

    const coordStore = fakeStore(alice);
    await revokeInvite(coordStore, { inviteId: id });
    expect(coordStore.revokeInvite).toHaveBeenCalledWith(id);
  });

  it("treats an invisible invite as not_found", async () => {
    const store = fakeStore(bob, { getInvite: async () => null });
    await rejectsWith(revokeInvite(store, { inviteId: randomUUID() }), "not_found");
  });

  it("passes the plaintext token to the database join and surfaces its errors", async () => {
    const token = "t".repeat(43);
    const store = fakeStore(carol);
    await expect(joinWithInvite(store, { token })).resolves.toEqual({ tripId });
    expect(store.joinWithInvite).toHaveBeenCalledWith(token);

    const dup = fakeStore(carol, {
      joinWithInvite: async () => {
        throw new ServiceError("already_member");
      },
    });
    await rejectsWith(joinWithInvite(dup, { token }), "already_member");
    await rejectsWith(joinWithInvite(store, { token: "short" }), "invalid_input");
  });
});

describe("removeMember", () => {
  it("lets only the coordinator remove someone", async () => {
    const asMember = fakeStore(bob);
    await rejectsWith(removeMember(asMember, { tripId, userId: carol }), "forbidden");
    const outsider = fakeStore(carol);
    await rejectsWith(removeMember(outsider, { tripId, userId: bob }), "not_found");
    expect(asMember.removeMember).not.toHaveBeenCalled();
    expect(outsider.removeMember).not.toHaveBeenCalled();

    const coord = fakeStore(alice);
    await removeMember(coord, { tripId, userId: bob });
    expect(coord.removeMember).toHaveBeenCalledWith(tripId, bob);
  });

  it("refuses to remove the coordinator themselves", async () => {
    const store = fakeStore(alice);
    await rejectsWith(removeMember(store, { tripId, userId: alice }), "invalid_input");
    expect(store.removeMember).not.toHaveBeenCalled();
  });

  it("validates ids", async () => {
    await rejectsWith(removeMember(fakeStore(alice), { tripId, userId: "x" }), "invalid_input");
  });
});

describe("planning writes", () => {
  it("lets non-members do nothing", async () => {
    const store = fakeStore(carol);
    await rejectsWith(suggestDestination(store, { tripId, name: "Seoul" }), "not_found");
    await rejectsWith(setPreference(store, { tripId, destinationId: randomUUID(), score: 1 }), "not_found");
    await rejectsWith(setOwnBudget(store, { tripId, ceilingMinor: 1 }), "not_found");
    expect(store.insertDestination).not.toHaveBeenCalled();
    expect(store.upsertBudget).not.toHaveBeenCalled();
  });

  it("writes as the session user", async () => {
    const store = fakeStore(bob);
    await suggestDestination(store, { tripId, name: " Seoul " });
    expect(store.insertDestination).toHaveBeenCalledWith({ tripId, name: "Seoul", suggestedBy: bob });
    await setOwnBudget(store, { tripId, ceilingMinor: 250000 });
    expect(store.upsertBudget).toHaveBeenCalledWith({ tripId, userId: bob, ceilingMinor: 250000 });
  });

  it("rejects invalid budgets", async () => {
    const store = fakeStore(bob);
    await rejectsWith(setOwnBudget(store, { tripId, ceilingMinor: -5 }), "invalid_input");
    await rejectsWith(setOwnBudget(store, { tripId, ceilingMinor: 10.5 }), "invalid_input");
  });
});

describe("magic-link plumbing", () => {
  const gateway = (ok = true): AuthGateway => ({
    sendMagicLink: vi.fn(async () => {}),
    exchangeCode: vi.fn(async () => ok),
  });

  it("only follows same-site relative paths", () => {
    expect(safeNextPath("/trips/1")).toBe("/trips/1");
    for (const bad of [null, "", "https://evil.example", "//evil.example", "/\\evil.example", "trips"]) {
      expect(safeNextPath(bad)).toBe("/");
    }
  });

  it("builds the callback URL with a safe next path", async () => {
    const auth = gateway();
    await signInWithMagicLink(auth, "https://app.example", { email: "a@b.co", next: "//evil.example" });
    expect(auth.sendMagicLink).toHaveBeenCalledWith("a@b.co", "https://app.example/auth/callback?next=%2F");
    await expect(signInWithMagicLink(auth, "https://app.example", { email: "nope" })).rejects.toBeInstanceOf(
      ServiceError,
    );
  });

  it("exchanges the code and fails closed", async () => {
    await expect(completeSignIn(gateway(), "code", "/trips")).resolves.toBe("/trips");
    await rejectsWith(completeSignIn(gateway(false), "code", null), "unauthenticated");
    await rejectsWith(completeSignIn(gateway(), null, null), "invalid_input");
  });
});
