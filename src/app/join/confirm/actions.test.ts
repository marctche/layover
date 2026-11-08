import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/server/errors";
import type { Store } from "@/server/store";

const token = "a".repeat(43);
const tripId = randomUUID();

const jar = new Map<string, string>();
let store: Partial<Store>;

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name) } : undefined),
    set: (name: string, value: string, options: Record<string, unknown>) => {
      if (options.maxAge === 0) jar.delete(name);
      else jar.set(name, value);
    },
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("@/server/supabase-store", () => ({
  createRequestServices: async () => ({ store, auth: {} }),
}));

const { joinTripAction, declineInviteAction } = await import("./actions");

const run = async (fn: () => Promise<void>) => {
  try {
    await fn();
  } catch (e) {
    return (e as Error).message;
  }
  return "no redirect";
};

beforeEach(() => {
  jar.clear();
  jar.set("layover_pending_invite", token);
  store = {
    currentUserId: async () => randomUUID(),
    joinWithInvite: vi.fn(async () => tripId),
  };
});

describe("join confirmation actions", () => {
  it("joins once, clears the cookie and lands on the trip", async () => {
    expect(await run(joinTripAction)).toBe(`REDIRECT:/trips/${tripId}`);
    expect(store.joinWithInvite).toHaveBeenCalledTimes(1);
    expect(store.joinWithInvite).toHaveBeenCalledWith(token);
    expect(jar.has("layover_pending_invite")).toBe(false);
    // A second submit has no cookie, so nothing is tried again.
    expect(await run(joinTripAction)).toBe("REDIRECT:/trips");
    expect(store.joinWithInvite).toHaveBeenCalledTimes(1);
  });

  it("goes to the trip when already a member, and clears the cookie", async () => {
    store.joinWithInvite = vi.fn(async () => {
      throw new ServiceError("already_member", undefined, tripId);
    });
    expect(await run(joinTripAction)).toBe(`REDIRECT:/trips/${tripId}`);
    expect(jar.has("layover_pending_invite")).toBe(false);
  });

  it("shows the neutral invite page for a dead link, and clears the cookie", async () => {
    store.joinWithInvite = vi.fn(async () => {
      throw new ServiceError("invite_invalid");
    });
    expect(await run(joinTripAction)).toBe("REDIRECT:/invite-invalid");
    expect(jar.has("layover_pending_invite")).toBe(false);
  });

  it("sends signed-out callers to sign in without joining", async () => {
    store.currentUserId = async () => null;
    expect(await run(joinTripAction)).toBe("REDIRECT:/sign-in");
    expect(store.joinWithInvite).not.toHaveBeenCalled();
  });

  it("Not now clears the cookie and does not join", async () => {
    expect(await run(declineInviteAction)).toBe("REDIRECT:/trips");
    expect(store.joinWithInvite).not.toHaveBeenCalled();
    expect(jar.has("layover_pending_invite")).toBe(false);
  });
});
