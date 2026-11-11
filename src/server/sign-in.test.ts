import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  gateRedirect,
  getSessionState,
  postSignInTarget,
  safeNextPath,
  setDisplayName,
  signInWithMagicLink,
  startGoogleSignIn,
  verifyEmailCode,
} from "./auth";
import { ServiceError } from "./errors";
import { previewInvite } from "./invites";
import {
  PENDING_INVITE_COOKIE,
  isInviteTokenShape,
  pendingInviteCookie,
  inviteOutcomePath,
  redeemPendingInvite,
  resolveInviteConfirmation,
} from "./pending-invite";
import { isPublicPath, joinTokenFromPath, signInRedirect } from "./proxy-rules";
import type { AuthGateway, Store } from "./store";
import { listMyTrips } from "./trips";

const token = "a".repeat(43);
const tripId = randomUUID();

const rejectsWith = async (p: Promise<unknown>, code: string) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ServiceError);
  expect((err as ServiceError).code).toBe(code);
};

/** Only the members these tests use; the rest throw if touched. */
function store(overrides: Partial<Store>): Store {
  return new Proxy(overrides, {
    get(target, prop) {
      const value = (target as Record<string | symbol, unknown>)[prop];
      if (value === undefined) throw new Error(`unexpected store call: ${String(prop)}`);
      return value;
    },
  }) as Store;
}

describe("safeNextPath", () => {
  it("keeps ordinary paths, queries and hashes", () => {
    expect(safeNextPath("/trips")).toBe("/trips");
    expect(safeNextPath("/trips/1?tab=members#top")).toBe("/trips/1?tab=members#top");
    expect(safeNextPath("/")).toBe("/");
  });

  it("rejects anything that can leave the site", () => {
    const bad = [
      null,
      undefined,
      "",
      "trips",
      "//evil.com",
      "/\\evil.com",
      "/\t/evil.com",
      "/\n/evil.com",
      "/\r/evil.com",
      "/ /evil.com",
      "/ /evil.com",
      "/\u0000/evil.com",
      "https://evil.com",
      "javascript:alert(1)",
      "/" + "a".repeat(3000),
    ];
    for (const next of bad) expect(safeNextPath(next), String(next)).toBe("/");
  });

  it("treats an encoded double slash as a path on this site", () => {
    expect(safeNextPath("/%2F%2Fevil.com")).toBe("/%2F%2Fevil.com");
  });

  it("never returns a value that resolves off-site", () => {
    for (const next of ["/\t/evil.com", "/%2F%2Fevil.com", "/a/../../evil.com", "/..//evil.com", "/.//evil.com"]) {
      const resolved = new URL(safeNextPath(next), "https://app.example");
      expect(resolved.origin, next).toBe("https://app.example");
    }
  });
});

describe("postSignInTarget", () => {
  it("defaults to the trip list and never loops through the sign-in pages", () => {
    expect(postSignInTarget(null)).toBe("/trips");
    expect(postSignInTarget("/sign-in?next=/x")).toBe("/trips");
    expect(postSignInTarget("/welcome")).toBe("/trips");
    expect(postSignInTarget("/auth/continue?next=%2Ftrips")).toBe("/trips");
    expect(postSignInTarget("//evil.com")).toBe("/trips");
    expect(postSignInTarget("/trips/abc")).toBe("/trips/abc");
  });
});

describe("email and Google sign-in services", () => {
  const gateway = (ok = true): AuthGateway => ({
    sendMagicLink: vi.fn(async () => {}),
    exchangeCode: vi.fn(async () => ok),
    googleSignInUrl: vi.fn(async () => "https://accounts.example/o/oauth"),
    verifyEmailCode: vi.fn(async () => ok),
    signOut: vi.fn(async () => {}),
  });

  it("starts Google with a callback URL carrying only a safe next path", async () => {
    const auth = gateway();
    await expect(startGoogleSignIn(auth, "https://app.example", { next: "/trips/1" })).resolves.toBe(
      "https://accounts.example/o/oauth",
    );
    expect(auth.googleSignInUrl).toHaveBeenCalledWith("https://app.example/auth/callback?next=%2Ftrips%2F1");
    await startGoogleSignIn(auth, "https://app.example", { next: "/\t/evil.com" });
    expect(auth.googleSignInUrl).toHaveBeenLastCalledWith("https://app.example/auth/callback?next=%2F");
  });

  it("never puts an invite token in the email redirect", async () => {
    const auth = gateway();
    await signInWithMagicLink(auth, "https://app.example", { email: "a@b.co", next: "/trips" });
    const redirectTo = vi.mocked(auth.sendMagicLink).mock.calls[0]?.[1];
    expect(redirectTo).toBe("https://app.example/auth/callback?next=%2Ftrips");
  });

  it("verifies only a 6-digit code and fails closed", async () => {
    const auth = gateway();
    await expect(verifyEmailCode(auth, { email: "a@b.co", code: " 123456 " })).resolves.toBeUndefined();
    expect(auth.verifyEmailCode).toHaveBeenCalledWith("a@b.co", "123456");
    for (const code of ["12345", "1234567", "abcdef", "", "12 456"]) {
      await rejectsWith(verifyEmailCode(auth, { email: "a@b.co", code }), "invalid_input");
    }
    await rejectsWith(verifyEmailCode(gateway(false), { email: "a@b.co", code: "123456" }), "unauthenticated");
    await rejectsWith(verifyEmailCode(auth, { email: "nope", code: "123456" }), "invalid_input");
  });
});

describe("onboarding gate", () => {
  it("is signed out without a user", async () => {
    const s = store({ currentUserId: async () => null });
    expect(await getSessionState(s)).toEqual({ state: "signed_out" });
  });

  it("needs a name when the display name is empty, blank or missing", async () => {
    const userId = randomUUID();
    for (const name of ["", "   ", null]) {
      const s = store({ currentUserId: async () => userId, getDisplayName: async () => name });
      expect(await getSessionState(s)).toEqual({ state: "needs_name", userId });
    }
  });

  it("is ready once there is a name", async () => {
    const userId = randomUUID();
    const s = store({ currentUserId: async () => userId, getDisplayName: async () => " Sam " });
    expect(await getSessionState(s)).toEqual({ state: "ready", userId, displayName: "Sam" });
  });

  it("redirects pages by state and keeps the destination", () => {
    expect(gateRedirect({ state: "signed_out" }, "/trips/1")).toBe("/sign-in?next=%2Ftrips%2F1");
    expect(gateRedirect({ state: "needs_name", userId: "u" }, "/trips/1")).toBe("/welcome?next=%2Ftrips%2F1");
    expect(gateRedirect({ state: "ready", userId: "u", displayName: "Sam" }, "/trips")).toBeNull();
    expect(gateRedirect({ state: "signed_out" }, "//evil.com")).toBe("/sign-in?next=%2F");
  });

  it("saves a trimmed name for the caller only", async () => {
    const userId = randomUUID();
    const setName = vi.fn(async () => {});
    const s = store({ currentUserId: async () => userId, setDisplayName: setName });
    await expect(setDisplayName(s, { displayName: "  Sam  " })).resolves.toEqual({ displayName: "Sam" });
    expect(setName).toHaveBeenCalledWith(userId, "Sam");
  });

  it("rejects empty, long and foreign-id names before touching the store", async () => {
    const setName = vi.fn(async () => {});
    const s = store({ currentUserId: async () => randomUUID(), setDisplayName: setName });
    for (const bad of [{ displayName: "" }, { displayName: "   " }, { displayName: "x".repeat(81) }, {}, { displayName: "a", userId: randomUUID() }]) {
      await rejectsWith(setDisplayName(s, bad), "invalid_input");
    }
    await expect(setDisplayName(s, { displayName: "x".repeat(80) })).resolves.toBeDefined();
    expect(setName).toHaveBeenCalledTimes(1);
  });

  it("requires a signed-in user to save a name", async () => {
    const s = store({ currentUserId: async () => null });
    await rejectsWith(setDisplayName(s, { displayName: "Sam" }), "unauthenticated");
  });
});

describe("pending invite cookie", () => {
  it("is httpOnly, lax, site-wide and lasts one hour", () => {
    const cookie = pendingInviteCookie(token, false);
    expect(cookie).toEqual({
      name: PENDING_INVITE_COOKIE,
      value: token,
      options: { httpOnly: true, secure: false, sameSite: "lax", path: "/", maxAge: 3600 },
    });
  });

  it("is Secure in production", () => {
    expect(pendingInviteCookie(token, true)?.options.secure).toBe(true);
  });

  it("is not set for malformed tokens", () => {
    for (const bad of ["", "short", "a".repeat(257), `${token}/`, `${token}%20`, "a b".padEnd(40, "c")]) {
      expect(pendingInviteCookie(bad, true), bad).toBeNull();
      expect(isInviteTokenShape(bad)).toBe(false);
    }
  });

  it("is redeemed once through the join service", async () => {
    const join = vi.fn(async () => tripId);
    const s = store({ currentUserId: async () => randomUUID(), joinWithInvite: join });
    expect(await redeemPendingInvite(s, undefined)).toEqual({ kind: "none" });
    expect(join).not.toHaveBeenCalled();
    expect(await redeemPendingInvite(s, token)).toEqual({ kind: "joined", tripId });
    expect(join).toHaveBeenCalledWith(token);
  });

  it("reports an existing membership with its trip", async () => {
    const s = store({
      currentUserId: async () => randomUUID(),
      joinWithInvite: async () => {
        throw new ServiceError("already_member", undefined, tripId);
      },
    });
    expect(await redeemPendingInvite(s, token)).toEqual({ kind: "already_member", tripId });
  });

  it("treats rejected and malformed tokens as invalid without calling the database for the latter", async () => {
    const join = vi.fn(async () => {
      throw new ServiceError("invite_invalid");
    });
    const s = store({ currentUserId: async () => randomUUID(), joinWithInvite: join });
    expect(await redeemPendingInvite(s, token)).toEqual({ kind: "invalid" });
    expect(await redeemPendingInvite(s, "bad token")).toEqual({ kind: "invalid" });
    expect(join).toHaveBeenCalledTimes(1);
  });

  it("does not hide other failures", async () => {
    const s = store({
      currentUserId: async () => randomUUID(),
      joinWithInvite: async () => {
        throw new ServiceError("internal");
      },
    });
    await rejectsWith(redeemPendingInvite(s, token), "internal");
  });
});

describe("invite preview", () => {
  it("returns what the store returns for a well-formed token", async () => {
    const preview = { tripName: "Asia", inviterName: "Alex", memberCount: 3, startDate: null, endDate: null, departureAirport: null };
    const get = vi.fn(async () => preview);
    expect(await previewInvite(store({ getInvitePreview: get }), { token })).toEqual(preview);
    expect(get).toHaveBeenCalledWith(token);
  });

  it("answers null for malformed input without a database call", async () => {
    const get = vi.fn(async () => null);
    const s = store({ getInvitePreview: get });
    for (const bad of [{}, { token: "short" }, { token: 5 }, null, { token, extra: 1 }]) {
      expect(await previewInvite(s, bad)).toBeNull();
    }
    expect(get).not.toHaveBeenCalled();
  });
});

describe("trip list", () => {
  it("requires a user and asks the store for that user's trips", async () => {
    const userId = randomUUID();
    const list = vi.fn(async () => []);
    await rejectsWith(listMyTrips(store({ currentUserId: async () => null, listMyTrips: list })), "unauthenticated");
    expect(list).not.toHaveBeenCalled();
    await listMyTrips(store({ currentUserId: async () => userId, listMyTrips: list }));
    expect(list).toHaveBeenCalledWith(userId);
  });
});

describe("proxy rules", () => {
  it("lets signed-out visitors reach only the public pages", () => {
    for (const path of ["/", "/sign-in", "/auth/callback", "/auth/continue", "/join/" + token, "/invite-invalid"]) {
      expect(isPublicPath(path), path).toBe(true);
    }
    for (const path of ["/trips", "/trips/abc", "/welcome", "/join", "/sign-in/x", "/auth/other"]) {
      expect(isPublicPath(path), path).toBe(false);
    }
  });

  it("builds a sign-in redirect that keeps the requested page", () => {
    expect(signInRedirect("/trips/abc", "?tab=1")).toBe("/sign-in?next=%2Ftrips%2Fabc%3Ftab%3D1");
    expect(signInRedirect("//evil.com", "")).toBe("/sign-in?next=%2F");
  });

  it("extracts the token from join paths only", () => {
    expect(joinTokenFromPath(`/join/${token}`)).toBe(token);
    expect(joinTokenFromPath(`/join/${token}/`)).toBe(token);
    expect(joinTokenFromPath("/join/")).toBeNull();
    expect(joinTokenFromPath(`/join/${token}/x`)).toBeNull();
    expect(joinTokenFromPath("/trips")).toBeNull();
  });
});

describe("invite confirmation (read-only)", () => {
  const userId = randomUUID();
  const preview = { tripName: "Asia", inviterName: "Alex", memberCount: 3, startDate: null, endDate: null, departureAirport: null };
  const base = () => ({
    currentUserId: async () => userId,
    joinWithInvite: vi.fn(async () => tripId),
    getTripIfMember: vi.fn(async () => null as string | null),
    getInvitePreview: vi.fn(async () => preview as typeof preview | null),
  });

  it("offers the preview and never joins", async () => {
    const b = base();
    expect(await resolveInviteConfirmation(store(b), token)).toEqual({ kind: "confirm", preview });
    expect(b.joinWithInvite).not.toHaveBeenCalled();
  });

  it("reports an existing membership, an unusable link and no cookie", async () => {
    const member = base();
    member.getTripIfMember = vi.fn(async () => tripId);
    expect(await resolveInviteConfirmation(store(member), token)).toEqual({ kind: "already_member", tripId });
    const dead = base();
    dead.getInvitePreview = vi.fn(async () => null);
    expect(await resolveInviteConfirmation(store(dead), token)).toEqual({ kind: "invalid" });
    expect(await resolveInviteConfirmation(store(base()), "bad token")).toEqual({ kind: "invalid" });
    expect(await resolveInviteConfirmation(store(base()), undefined)).toEqual({ kind: "none" });
    for (const b of [member, dead]) expect(b.joinWithInvite).not.toHaveBeenCalled();
  });

  it("requires a signed-in user", async () => {
    await rejectsWith(resolveInviteConfirmation(store({ currentUserId: async () => null }), token), "unauthenticated");
  });

  it("maps outcomes to pages", () => {
    expect(inviteOutcomePath({ kind: "joined", tripId })).toBe(`/trips/${tripId}`);
    expect(inviteOutcomePath({ kind: "already_member", tripId })).toBe(`/trips/${tripId}`);
    expect(inviteOutcomePath({ kind: "already_member", tripId: null })).toBe("/trips");
    expect(inviteOutcomePath({ kind: "invalid" })).toBe("/invite-invalid");
    expect(inviteOutcomePath({ kind: "none" })).toBe("/trips");
    expect(inviteOutcomePath({ kind: "declined" })).toBe("/trips");
  });
});
