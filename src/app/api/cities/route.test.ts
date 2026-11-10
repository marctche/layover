import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

let userId: string | null;

vi.mock("@/server/supabase-store", () => ({
  createRequestServices: async () => ({ store: { currentUserId: async () => userId }, auth: {} }),
}));

const { GET } = await import("./route");

const call = (query: string) => GET(new NextRequest(`https://app.example/api/cities${query}`));

beforeEach(() => {
  userId = "11111111-1111-4111-8111-111111111111";
});

describe("GET /api/cities", () => {
  it("returns 401 without a signed-in user", async () => {
    userId = null;
    const res = await call("?q=par");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  it("returns at most 8 matches with name and country only", async () => {
    const res = await call("?q=s");
    expect(res.status).toBe(200);
    const { results } = (await res.json()) as { results: Record<string, unknown>[] };
    expect(results).toHaveLength(8);
    expect(Object.keys(results[0] ?? {}).sort()).toEqual(["country", "id", "name"]);
  });

  it("finds Paris first for 'par'", async () => {
    const { results } = (await (await call("?q=par")).json()) as { results: { name: string; country: string }[] };
    expect(results[0]).toMatchObject({ name: "Paris", country: "France" });
  });

  it("returns an empty list for a missing query and 400 for one over 60 characters", async () => {
    expect(await (await call("")).json()).toEqual({ results: [] });
    expect((await call(`?q=${"a".repeat(61)}`)).status).toBe(400);
  });
});
