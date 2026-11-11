import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Store } from "@/server/store";

const token = "a".repeat(43);
const tripId = randomUUID();
let store: Partial<Store>;

vi.mock("@/server/supabase-store", () => ({
  createRequestServices: async () => ({ store, auth: {} }),
}));

const { GET } = await import("./route");

const call = async (path: string, cookie?: string) => {
  const res = await GET(
    new NextRequest(`https://app.example${path}`, {
      headers: cookie ? { cookie: `layover_pending_invite=${cookie}` } : {},
    }),
  );
  return { location: res.headers.get("location"), setCookie: res.headers.get("set-cookie") ?? "" };
};

beforeEach(() => {
  store = {
    currentUserId: async () => randomUUID(),
    getDisplayName: async () => "Sam",
    joinWithInvite: vi.fn(async () => tripId),
    getTripIfMember: vi.fn(async () => null),
    getInvitePreview: vi.fn(async () => ({ tripName: "Asia", inviterName: "Alex", memberCount: 3, startDate: null, endDate: null, departureAirport: null })),
  };
});

describe("GET /auth/continue", () => {
  it("sends a signed-in user with a pending invite to the confirmation page and never joins", async () => {
    const res = await call("/auth/continue?next=%2Ftrips", token);
    expect(res.location).toBe("https://app.example/join/confirm");
    expect(store.joinWithInvite).not.toHaveBeenCalled();
    expect(res.setCookie).not.toContain("Max-Age=0");
  });

  it("does not join for a user who still needs a name", async () => {
    store.getDisplayName = async () => "";
    const res = await call("/auth/continue", token);
    expect(res.location).toContain("/welcome");
    expect(store.joinWithInvite).not.toHaveBeenCalled();
  });

  it("goes straight to the trip, without joining, when already a member", async () => {
    store.getTripIfMember = vi.fn(async () => tripId);
    const res = await call("/auth/continue", token);
    expect(res.location).toBe(`https://app.example/trips/${tripId}`);
    expect(res.setCookie).toContain("Max-Age=0");
    expect(store.joinWithInvite).not.toHaveBeenCalled();
  });

  it("shows the neutral page and clears the cookie for a dead or malformed link", async () => {
    store.getInvitePreview = vi.fn(async () => null);
    for (const value of [token, "bad-token"]) {
      const res = await call("/auth/continue", value);
      expect(res.location).toBe("https://app.example/invite-invalid");
      expect(res.setCookie).toContain("Max-Age=0");
    }
    expect(store.joinWithInvite).not.toHaveBeenCalled();
  });

  it("without an invite just continues to the requested page", async () => {
    expect((await call("/auth/continue?next=%2Ftrips%2Fabc")).location).toBe("https://app.example/trips/abc");
    expect(store.joinWithInvite).not.toHaveBeenCalled();
  });

  it("sends a signed-out visitor to sign in without joining", async () => {
    store.currentUserId = async () => null;
    expect((await call("/auth/continue", token)).location).toContain("/sign-in");
    expect(store.joinWithInvite).not.toHaveBeenCalled();
  });
});
