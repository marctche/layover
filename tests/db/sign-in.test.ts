import { randomUUID } from "node:crypto";
import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asAdmin,
  asAnon,
  asUser,
  attempt,
  connect,
  inviteAs,
  joinAs,
  newToken,
  scene,
  sha256Hex,
  type Scene,
} from "./helpers";

// Every test runs in a transaction that is rolled back.
let c: Client;
let s: Scene;

beforeAll(async () => {
  c = await connect();
});
afterAll(async () => {
  await c.end();
});
beforeEach(async () => {
  await c.query("begin");
  s = await scene(c);
});
afterEach(async () => {
  await c.query("rollback");
});

const preview = (token: string) => c.query("select * from public.invite_preview($1)", [token]);

async function setName(userId: string, name: string) {
  await asAdmin(c);
  await c.query("update public.profiles set display_name = $2 where id = $1", [userId, name]);
}

describe("invite_preview", () => {
  it("returns exactly the trip name, inviter name and member count for a live invite", async () => {
    await setName(s.coordinator, "Alex");
    const token = await inviteAs(c, s.coordinator, s.tripId);

    await asAnon(c);
    const res = await preview(token);
    expect(res.fields.map((f) => f.name)).toEqual(["trip_name", "inviter_name", "member_count"]);
    expect(res.rows).toEqual([{ trip_name: "Asia", inviter_name: "Alex", member_count: 3 }]);
  });

  it("is callable signed out and signed in, and names the person who made the link", async () => {
    await setName(s.bob, "Bobby");
    // Only coordinators can create links through the app; insert one as admin to check
    // that the inviter's name comes from created_by.
    const token = newToken();
    await asAdmin(c);
    await c.query(
      "insert into public.invitations (trip_id, token_hash, created_by, expires_at) values ($1, $2, $3, now() + interval '1 day')",
      [s.tripId, sha256Hex(token), s.bob],
    );

    for (const act of [() => asAnon(c), () => asUser(c, s.outsider), () => asUser(c, s.bob)]) {
      await act();
      const res = await preview(token);
      expect(res.rows).toEqual([{ trip_name: "Asia", inviter_name: "Bobby", member_count: 3 }]);
    }
  });

  it("returns the same empty result for unknown, expired, revoked and malformed tokens", async () => {
    const live = await inviteAs(c, s.coordinator, s.tripId);

    // Expired: created two days ago, expired yesterday.
    await asAdmin(c);
    const expired = newToken();
    await c.query(
      "insert into public.invitations (trip_id, token_hash, created_by, created_at, expires_at) values ($1, $2, $3, now() - interval '2 days', now() - interval '1 day')",
      [s.tripId, sha256Hex(expired), s.coordinator],
    );
    // Revoked.
    const revoked = await inviteAs(c, s.coordinator, s.tripId);
    await asAdmin(c);
    await c.query("update public.invitations set revoked_at = now() where token_hash = $1", [sha256Hex(revoked)]);

    await asAnon(c);
    expect((await preview(live)).rowCount).toBe(1);

    const results = [];
    for (const bad of [newToken(), expired, revoked, "", "short", "x".repeat(300), live.slice(0, -1), live + "x"]) {
      results.push(await preview(bad));
    }
    const nullResult = await c.query("select * from public.invite_preview(null)");
    results.push(nullResult);

    for (const res of results) {
      expect(res.rowCount).toBe(0);
      expect(res.rows).toEqual([]);
      expect(res.fields.map((f) => f.name)).toEqual(["trip_name", "inviter_name", "member_count"]);
    }
  });

  it("does not make the underlying tables readable to anon", async () => {
    await inviteAs(c, s.coordinator, s.tripId);
    await asAnon(c);
    for (const table of ["invitations", "trips", "trip_members", "profiles", "member_budgets"]) {
      const res = await attempt(c, `select * from public.${table}`);
      // Either no privilege at all or no visible rows. Never data.
      expect(res.error !== undefined || res.rowCount === 0, table).toBe(true);
    }
  });

  it("reflects the member count as people join", async () => {
    const token = await inviteAs(c, s.coordinator, s.tripId);
    await joinAs(c, s.outsider, token);
    await asAnon(c);
    expect((await preview(token)).rows[0]).toMatchObject({ member_count: 4 });
  });
});

describe("invite_trip_if_member", () => {
  const tripIfMember = async (token: string) =>
    (await c.query("select public.invite_trip_if_member($1) as id", [token])).rows[0].id as string | null;

  it("returns the trip only for a member holding a live link", async () => {
    const token = await inviteAs(c, s.coordinator, s.tripId);
    await asUser(c, s.bob);
    expect(await tripIfMember(token)).toBe(s.tripId);
    await asUser(c, s.outsider);
    expect(await tripIfMember(token)).toBeNull();
    expect(await tripIfMember(newToken())).toBeNull();
    expect(await tripIfMember("short")).toBeNull();
  });

  it("is not callable signed out", async () => {
    const token = await inviteAs(c, s.coordinator, s.tripId);
    await asAnon(c);
    const res = await attempt(c, "select public.invite_trip_if_member($1)", [token]);
    expect(res.error?.code).toBe("42501");
  });
});

describe("join_with_invite already_member", () => {
  it("reports the trip the member already belongs to in the error detail", async () => {
    const token = await inviteAs(c, s.coordinator, s.tripId);
    await asUser(c, s.bob);
    const res = await attempt(c, "select public.join_with_invite($1)", [token]);
    const error = res.error as { message: string; detail?: string } | undefined;
    expect(error?.message).toBe("already_member");
    expect(error?.detail).toBe(s.tripId);
  });
});

describe("new profiles", () => {
  const nameFor = async (metadata: string | null) => {
    await asAdmin(c);
    const id = randomUUID();
    await c.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3::jsonb)", [
      id,
      `new-${id.slice(0, 8)}@example.test`,
      metadata,
    ]);
    const res = await c.query("select display_name from public.profiles where id = $1", [id]);
    return (res.rows[0] as { display_name: string }).display_name;
  };

  it("start with an empty display name, not the email prefix", async () => {
    expect(await nameFor(null)).toBe("");
    expect(await nameFor("{}")).toBe("");
    expect(await nameFor('{"display_name": "   "}')).toBe("");
  });

  it("keep a name supplied by the identity provider", async () => {
    expect(await nameFor('{"full_name": "Pat Lee"}')).toBe("Pat Lee");
    expect(await nameFor('{"name": "Pat"}')).toBe("Pat");
    expect(await nameFor('{"display_name": "Sam", "full_name": "Pat Lee"}')).toBe("Sam");
    expect(await nameFor(`{"full_name": "${"x".repeat(120)}"}`)).toHaveLength(80);
  });
});
