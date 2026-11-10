import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  asAdmin,
  asAnon,
  asUser,
  attempt,
  connect,
  createTripAs,
  createUser,
  inviteAs,
  joinAs,
  newToken,
  scene,
  sha256Hex,
  type Scene,
} from "./helpers";

// Every test runs in a transaction that is rolled back, so tests do not see each other's data.
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

const count = async (table: string) =>
  ((await c.query(`select count(*)::int as n from public.${table}`)).rows[0] as { n: number }).n;

async function setBudget(userId: string, ceiling: number) {
  await asUser(c, userId);
  await c.query("insert into public.member_budgets (trip_id, user_id, ceiling_minor) values ($1, $2, $3)", [
    s.tripId,
    userId,
    ceiling,
  ]);
}

describe("non-members see nothing", () => {
  it("reads no rows from any table", async () => {
    await asUser(c, s.carol);
    await c.query("insert into public.destinations (trip_id, name, suggested_by) values ($1, 'Kyoto', $2)", [
      s.tripId,
      s.carol,
    ]);
    await setBudget(s.bob, 100000);

    await asUser(c, s.outsider);
    for (const table of ["trips", "trip_members", "invitations", "destinations", "destination_preferences", "member_budgets"]) {
      expect(await count(table), table).toBe(0);
    }
    // The outsider can read only their own profile, not any trip member's.
    const profiles = await c.query("select id from public.profiles");
    expect(profiles.rows.map((r) => r.id)).toEqual([s.outsider]);
  });

  it("cannot write into a trip they are not in", async () => {
    await asUser(c, s.outsider);
    const dest = await attempt(c, "insert into public.destinations (trip_id, name, suggested_by) values ($1, 'X', $2)", [
      s.tripId,
      s.outsider,
    ]);
    expect(dest.error).toBeDefined();
    const budget = await attempt(
      c,
      "insert into public.member_budgets (trip_id, user_id, ceiling_minor) values ($1, $2, 5)",
      [s.tripId, s.outsider],
    );
    expect(budget.error).toBeDefined();
    await asAdmin(c);
    expect(await count("destinations")).toBe(0);
    expect(await count("member_budgets")).toBe(0);
  });

  it("lets the coordinator list invitations without any token column", async () => {
    await inviteAs(c, s.coordinator, s.tripId);
    await asUser(c, s.coordinator);
    const res = await c.query(
      "select id, trip_id, expires_at, revoked_at from public.invitations where trip_id = $1 order by created_at desc",
      [s.tripId],
    );
    expect(res.rowCount).toBe(1);
    expect(Object.keys(res.rows[0] as object).sort()).toEqual(["expires_at", "id", "revoked_at", "trip_id"]);
    await asUser(c, s.bob);
    const asMember = await c.query("select id from public.invitations where trip_id = $1", [s.tripId]);
    expect(asMember.rowCount).toBe(0);
  });

  it("does not see invitations as a plain member either", async () => {
    await asUser(c, s.bob);
    expect(await count("invitations")).toBe(0);
  });
});

describe("members see the trip and the full member list", () => {
  it("lets every member read the trip and all members", async () => {
    for (const who of [s.coordinator, s.bob, s.carol]) {
      await asUser(c, who);
      expect(await count("trips"), "trips").toBe(1);
      const members = await c.query("select user_id, role from public.trip_members order by role");
      expect(members.rows.map((r) => r.user_id).sort()).toEqual([s.coordinator, s.bob, s.carol].sort());
      const names = await c.query("select display_name from public.profiles");
      expect(names.rowCount).toBe(3);
    }
  });

  it("makes the creator the only coordinator", async () => {
    await asAdmin(c);
    const r = await c.query("select user_id from public.trip_members where trip_id = $1 and role = 'coordinator'", [s.tripId]);
    expect(r.rows).toEqual([{ user_id: s.coordinator }]);
  });

  it("shares preferences between members", async () => {
    await asUser(c, s.bob);
    const d = await c.query("insert into public.destinations (trip_id, name, suggested_by) values ($1, 'Seoul', $2) returning id", [
      s.tripId,
      s.bob,
    ]);
    await c.query("insert into public.destination_preferences (trip_id, destination_id, user_id, score) values ($1, $2, $3, 2)", [
      s.tripId,
      d.rows[0].id,
      s.bob,
    ]);
    await asUser(c, s.carol);
    expect(await count("destination_preferences")).toBe(1);
  });

  it("rejects a preference outside -2..2, or for someone else", async () => {
    await asUser(c, s.bob);
    const d = await c.query("insert into public.destinations (trip_id, name, suggested_by) values ($1, 'Seoul', $2) returning id", [
      s.tripId,
      s.bob,
    ]);
    const insert = "insert into public.destination_preferences (trip_id, destination_id, user_id, score) values ($1, $2, $3, $4)";
    expect((await attempt(c, insert, [s.tripId, d.rows[0].id, s.bob, 3])).error?.code).toBe("23514");
    expect((await attempt(c, insert, [s.tripId, d.rows[0].id, s.bob, -3])).error?.code).toBe("23514");
    expect((await attempt(c, insert, [s.tripId, d.rows[0].id, s.carol, 1])).error).toBeDefined();
  });

  it("will not take a destination suggested as someone else", async () => {
    await asUser(c, s.bob);
    const r = await attempt(c, "insert into public.destinations (trip_id, name, suggested_by) values ($1, 'Seoul', $2)", [
      s.tripId,
      s.carol,
    ]);
    expect(r.error).toBeDefined();
  });
});

describe("budgets are private to their owner", () => {
  it("lets a traveler read and write their own budget", async () => {
    await setBudget(s.bob, 250000);
    const own = await c.query("select ceiling_minor::int as v from public.member_budgets");
    expect(own.rows).toEqual([{ v: 250000 }]);
    await c.query("update public.member_budgets set ceiling_minor = 300000 where user_id = $1", [s.bob]);
    expect((await c.query("select ceiling_minor::int as v from public.member_budgets")).rows).toEqual([{ v: 300000 }]);
  });

  it("hides a member's budget from the organizer (coordinator)", async () => {
    await setBudget(s.bob, 250000);
    await asUser(c, s.coordinator);
    expect(await count("member_budgets")).toBe(0);
    const direct = await c.query("select * from public.member_budgets where user_id = $1", [s.bob]);
    expect(direct.rowCount).toBe(0);
  });

  it("hides a member's budget from another member", async () => {
    await setBudget(s.bob, 250000);
    await asUser(c, s.carol);
    expect(await count("member_budgets")).toBe(0);
    expect((await c.query("select * from public.member_budgets where user_id = $1", [s.bob])).rowCount).toBe(0);
  });

  it("stops the organizer and members from changing or deleting another's budget", async () => {
    await setBudget(s.bob, 250000);
    for (const who of [s.coordinator, s.carol]) {
      await asUser(c, who);
      expect((await c.query("update public.member_budgets set ceiling_minor = 1 where user_id = $1", [s.bob])).rowCount).toBe(0);
      expect((await c.query("delete from public.member_budgets where user_id = $1", [s.bob])).rowCount).toBe(0);
      const forge = await attempt(
        c,
        "insert into public.member_budgets (trip_id, user_id, ceiling_minor) values ($1, $2, 1)",
        [s.tripId, s.bob],
      );
      expect(forge.error).toBeDefined();
    }
    await asAdmin(c);
    const r = await c.query("select ceiling_minor::int as v from public.member_budgets where user_id = $1", [s.bob]);
    expect(r.rows).toEqual([{ v: 250000 }]);
  });

  it("is not reachable through any view, helper function or coordinator policy", async () => {
    await asAdmin(c);
    const views = await c.query(`
      select distinct v.relname
      from pg_rewrite rw
      join pg_depend d on d.objid = rw.oid and d.deptype = 'n'
      join pg_class t on t.oid = d.refobjid and t.relname = 'member_budgets'
      join pg_class v on v.oid = rw.ev_class and v.oid <> t.oid
      where v.relkind in ('v', 'm')`);
    expect(views.rows).toEqual([]);

    const fns = await c.query(`
      select n.nspname || '.' || p.proname as fn
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname in ('public', 'app') and p.prosrc ilike '%member_budgets%'`);
    expect(fns.rows).toEqual([]);

    const policies = await c.query(
      "select policyname, coalesce(qual, '') || ' ' || coalesce(with_check, '') as expr from pg_policies where tablename = 'member_budgets'",
    );
    expect(policies.rowCount).toBeGreaterThan(0);
    for (const p of policies.rows) {
      expect(p.expr, p.policyname).toContain("current_user_id");
      expect(p.expr, p.policyname).not.toContain("is_coordinator");
    }
  });
});

describe("direct writes to membership are refused", () => {
  it("refuses an insert into trip_members, whoever asks", async () => {
    const insert = "insert into public.trip_members (trip_id, user_id, role) values ($1, $2, $3)";
    await asUser(c, s.outsider);
    expect((await attempt(c, insert, [s.tripId, s.outsider, "member"])).error).toBeDefined();
    await asUser(c, s.coordinator);
    expect((await attempt(c, insert, [s.tripId, s.outsider, "member"])).error).toBeDefined();
    await asUser(c, s.bob);
    expect((await attempt(c, insert, [s.tripId, s.bob, "coordinator"])).error).toBeDefined();
    await asAnon(c);
    expect((await attempt(c, insert, [s.tripId, s.outsider, "member"])).error).toBeDefined();
    await asAdmin(c);
    expect(await count("trip_members")).toBe(3);
  });

  it("refuses updates and deletes of membership rows", async () => {
    await asUser(c, s.bob);
    expect((await attempt(c, "update public.trip_members set role = 'coordinator' where user_id = $1", [s.bob])).error).toBeDefined();
    expect((await attempt(c, "delete from public.trip_members where user_id = $1", [s.carol])).error).toBeDefined();
    await asUser(c, s.coordinator);
    expect((await attempt(c, "delete from public.trip_members where user_id = $1", [s.bob])).error).toBeDefined();
    await asAdmin(c);
    expect(await count("trip_members")).toBe(3);
  });

  it("refuses a direct insert into trips", async () => {
    await asUser(c, s.outsider);
    const r = await attempt(c, "insert into public.trips (name, created_by) values ('Mine', $1)", [s.outsider]);
    expect(r.error).toBeDefined();
  });

  it("refuses anonymous access to tables and functions", async () => {
    await asAnon(c);
    expect((await attempt(c, "select * from public.trips")).error?.code).toBe("42501");
    expect((await attempt(c, "select public.create_trip('x', 'USD')")).error?.code).toBe("42501");
    expect((await attempt(c, "select public.join_with_invite($1)", [newToken()])).error?.code).toBe("42501");
  });

  it("has row-level security enabled on every public table", async () => {
    await asAdmin(c);
    const r = await c.query(`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`);
    expect(r.rows).toEqual([]);
  });
});

describe("invitations", () => {
  it("lets only the coordinator create one", async () => {
    const insert =
      "insert into public.invitations (trip_id, token_hash, created_by, expires_at) values ($1, $2, $3, now() + interval '1 day')";
    await asUser(c, s.bob);
    expect((await attempt(c, insert, [s.tripId, sha256Hex(newToken()), s.bob])).error).toBeDefined();
    await asUser(c, s.outsider);
    expect((await attempt(c, insert, [s.tripId, sha256Hex(newToken()), s.outsider])).error).toBeDefined();
    await asUser(c, s.coordinator);
    expect((await attempt(c, insert, [s.tripId, sha256Hex(newToken()), s.coordinator])).error).toBeUndefined();
  });

  it("refuses an expiry beyond 90 days and a non-hash token_hash", async () => {
    await asUser(c, s.coordinator);
    const insert =
      "insert into public.invitations (trip_id, token_hash, created_by, expires_at) values ($1, $2, $3, now() + make_interval(days => $4))";
    expect((await attempt(c, insert, [s.tripId, sha256Hex(newToken()), s.coordinator, 91])).error).toBeDefined();
    // Plain text is refused by the table's own constraint, even for the database owner.
    await asAdmin(c);
    const plain = await attempt(c, insert, [s.tripId, newToken(), s.coordinator, 1]);
    expect(plain.error?.code).toBe("23514");
  });

  it("does not store the token in plain text", async () => {
    const token = await inviteAs(c, s.coordinator, s.tripId);
    await asAdmin(c);
    const rows = await c.query("select i::text as row from public.invitations i where trip_id = $1", [s.tripId]);
    expect(rows.rows.length).toBeGreaterThan(0);
    for (const r of rows.rows) expect(r.row).not.toContain(token);
    const hit = await c.query("select 1 from public.invitations where token_hash = $1", [sha256Hex(token)]);
    expect(hit.rowCount).toBe(1);
  });

  it("joins a valid invite as a plain member, recording the link used", async () => {
    const token = await inviteAs(c, s.coordinator, s.tripId);
    const tripId = await joinAs(c, s.outsider, token);
    expect(tripId).toBe(s.tripId);
    await asAdmin(c);
    const m = await c.query("select role from public.trip_members where trip_id = $1 and user_id = $2", [s.tripId, s.outsider]);
    expect(m.rows).toEqual([{ role: "member" }]);
    const via = await c.query(
      "select i.token_hash from public.trip_members m join public.invitations i on i.id = m.joined_via where m.user_id = $1",
      [s.outsider],
    );
    expect(via.rows).toEqual([{ token_hash: sha256Hex(token) }]);
  });

  it("lets two different users join with the same link", async () => {
    const token = await inviteAs(c, s.coordinator, s.tripId);
    await asAdmin(c);
    const other = await createUser(c, "other");
    await joinAs(c, s.outsider, token);
    await joinAs(c, other, token);
    await asAdmin(c);
    const n = await c.query("select count(*)::int as n from public.trip_members where trip_id = $1", [s.tripId]);
    expect(n.rows[0].n).toBe(5);
  });

  it("has no single-use columns", async () => {
    await asAdmin(c);
    const r = await c.query(
      "select column_name from information_schema.columns where table_schema = 'public' and table_name = 'invitations' and column_name in ('accepted_by', 'accepted_at')",
    );
    expect(r.rows).toEqual([]);
  });

  it("refuses an expired invite", async () => {
    await asAdmin(c);
    const token = newToken();
    await c.query(
      "insert into public.invitations (trip_id, token_hash, created_by, created_at, expires_at) values ($1, $2, $3, now() - interval '3 days', now() - interval '1 day')",
      [s.tripId, sha256Hex(token), s.coordinator],
    );
    await asUser(c, s.outsider);
    expect((await attempt(c, "select public.join_with_invite($1)", [token])).error?.message).toBe("invite_invalid");
    await asAdmin(c);
    expect(await count("trip_members")).toBe(3);
  });

  it("refuses a revoked invite, and the revocation cannot be undone", async () => {
    const token = await inviteAs(c, s.coordinator, s.tripId);
    await asUser(c, s.coordinator);
    const rev = await c.query("update public.invitations set revoked_at = now() where token_hash = $1", [sha256Hex(token)]);
    expect(rev.rowCount).toBe(1);
    const undo = await c.query("update public.invitations set revoked_at = null where token_hash = $1", [sha256Hex(token)]);
    expect(undo.rowCount).toBe(0);

    await asUser(c, s.outsider);
    expect((await attempt(c, "select public.join_with_invite($1)", [token])).error?.message).toBe("invite_invalid");
    await asAdmin(c);
    expect(await count("trip_members")).toBe(3);
  });

  it("lets only the coordinator revoke", async () => {
    const token = await inviteAs(c, s.coordinator, s.tripId);
    await asUser(c, s.bob);
    const r = await c.query("update public.invitations set revoked_at = now() where token_hash = $1", [sha256Hex(token)]);
    expect(r.rowCount).toBe(0);
    await asAdmin(c);
    const row = await c.query("select revoked_at from public.invitations where token_hash = $1", [sha256Hex(token)]);
    expect(row.rows[0].revoked_at).toBeNull();
  });

  it("refuses unknown and malformed tokens", async () => {
    await asUser(c, s.outsider);
    for (const bad of [newToken(), "short", "x".repeat(300)]) {
      expect((await attempt(c, "select public.join_with_invite($1)", [bad])).error?.message, bad.slice(0, 8)).toBe("invite_invalid");
    }
  });

  it("does not create a second membership on a repeated join", async () => {
    const first = await inviteAs(c, s.coordinator, s.tripId);
    await joinAs(c, s.outsider, first);
    await asUser(c, s.outsider);
    const r = await attempt(c, "select public.join_with_invite($1)", [first]);
    expect(r.error?.message).toBe("already_member");
    await asAdmin(c);
    const n = await c.query("select count(*)::int as n from public.trip_members where trip_id = $1 and user_id = $2", [s.tripId, s.outsider]);
    expect(n.rows[0].n).toBe(1);
  });

  it("needs a signed-in caller", async () => {
    const token = await inviteAs(c, s.coordinator, s.tripId);
    await c.query("reset role");
    await c.query("set local role authenticated");
    await c.query("select set_config('request.jwt.claim.sub', '', true), set_config('request.jwt.claims', '', true)");
    const r = await attempt(c, "select public.join_with_invite($1)", [token]);
    expect(r.error?.code).toBe("28000");
  });
});

describe("concurrent joins (committed data, two connections)", () => {
  let a: Client;
  let b: Client;
  const createdTrips: string[] = [];
  const createdUsers: string[] = [];

  beforeAll(async () => {
    a = await connect();
    b = await connect();
  });
  afterAll(async () => {
    await a.end();
    await b.end();
  });
  afterEach(async () => {
    // Committed rows are removed explicitly. Trips go first, then users (profiles and memberships cascade).
    // Uses connection a, which is outside the per-test transaction that is rolled back.
    if (createdTrips.length) await a.query("delete from public.trips where id = any($1)", [createdTrips]);
    if (createdUsers.length) await a.query("delete from auth.users where id = any($1)", [createdUsers]);
    createdTrips.length = 0;
    createdUsers.length = 0;
  });

  async function committedTrip() {
    // Runs outside the per-test transaction: use a fresh connection that autocommits.
    const admin = await connect();
    try {
      const coordinator = await createUser(admin, "cc");
      const joiner1 = await createUser(admin, "j1");
      const joiner2 = await createUser(admin, "j2");
      createdUsers.push(coordinator, joiner1, joiner2);
      await admin.query("begin");
      const tripId = await createTripAs(admin, coordinator);
      createdTrips.push(tripId);
      const tokenA = await inviteAs(admin, coordinator, tripId);
      const tokenB = await inviteAs(admin, coordinator, tripId);
      await admin.query("commit");
      return { tripId, joiner1, joiner2, tokenA, tokenB };
    } finally {
      await admin.end();
    }
  }

  async function joinInTx(client: Client, userId: string, token: string) {
    await client.query("begin");
    try {
      await asUser(client, userId);
      await client.query("select public.join_with_invite($1)", [token]);
      await client.query("commit");
    } catch (e) {
      await client.query("rollback");
      throw e;
    }
  }

  it("lets one of two simultaneous joins by the same user through", async () => {
    const t = await committedTrip();
    const results = await Promise.allSettled([joinInTx(a, t.joiner1, t.tokenA), joinInTx(b, t.joiner1, t.tokenA)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as Error).message).toBe("already_member");
    const n = await c.query("select count(*)::int as n from public.trip_members where trip_id = $1 and user_id = $2", [t.tripId, t.joiner1]);
    expect(n.rows[0].n).toBe(1);
  });

  it("lets two different users both join at once with the same link", async () => {
    const t = await committedTrip();
    const results = await Promise.allSettled([joinInTx(a, t.joiner1, t.tokenA), joinInTx(b, t.joiner2, t.tokenA)]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);
    const n = await c.query("select count(*)::int as n from public.trip_members where trip_id = $1 and role = 'member'", [t.tripId]);
    expect(n.rows[0].n).toBe(2);
  });
});

describe("removing members", () => {
  const remove = (trip: string, user: string) =>
    attempt(c, "select public.remove_member($1, $2)", [trip, user]);

  it("lets the coordinator remove a member and deletes their preferences and budget", async () => {
    await asUser(c, s.bob);
    const d = await c.query(
      "insert into public.destinations (trip_id, name, suggested_by) values ($1, 'Seoul', $2) returning id",
      [s.tripId, s.bob],
    );
    await c.query("insert into public.destination_preferences (trip_id, destination_id, user_id, score) values ($1, $2, $3, 1)", [
      s.tripId,
      d.rows[0].id,
      s.bob,
    ]);
    await setBudget(s.bob, 250000);

    await asUser(c, s.coordinator);
    expect((await remove(s.tripId, s.bob)).error).toBeUndefined();

    await asAdmin(c);
    const q = async (table: string) =>
      (await c.query(`select count(*)::int as n from public.${table} where user_id = $1`, [s.bob])).rows[0].n;
    expect(await q("trip_members")).toBe(0);
    expect(await q("destination_preferences")).toBe(0);
    expect(await q("member_budgets")).toBe(0);
    // Their suggestion stays.
    const dest = await c.query("select suggested_by from public.destinations where id = $1", [d.rows[0].id]);
    expect(dest.rows).toEqual([{ suggested_by: s.bob }]);

    // They no longer see the trip.
    await asUser(c, s.bob);
    expect(await count("trips")).toBe(0);
  });

  it("refuses a member, an outsider and anon", async () => {
    await asUser(c, s.bob);
    expect((await remove(s.tripId, s.carol)).error?.code).toBe("42501");
    await asUser(c, s.outsider);
    expect((await remove(s.tripId, s.carol)).error?.code).toBe("42501");
    await asAnon(c);
    expect((await remove(s.tripId, s.carol)).error?.code).toBe("42501");
    await asAdmin(c);
    expect(await count("trip_members")).toBe(3);
  });

  it("refuses to remove the coordinator, and reports an unknown member", async () => {
    await asUser(c, s.coordinator);
    expect((await remove(s.tripId, s.coordinator)).error?.message).toBe("cannot_remove_self");
    expect((await remove(s.tripId, s.outsider)).error?.message).toBe("member_not_found");
    await asAdmin(c);
    expect(await count("trip_members")).toBe(3);
  });

  it("returns no value, so it exposes no budget", async () => {
    await setBudget(s.bob, 777123);
    await asUser(c, s.coordinator);
    const res = await c.query("select public.remove_member($1, $2) as r", [s.tripId, s.bob]);
    expect(JSON.stringify(res.rows)).not.toContain("777123");
    await asAdmin(c);
    const fn = await c.query("select pg_get_function_result(oid) as t from pg_proc where proname = 'remove_member'");
    expect(fn.rows).toEqual([{ t: "void" }]);
  });

  it("still refuses direct deletes, and a removed user rejoins only with a live link", async () => {
    await asUser(c, s.coordinator);
    expect((await attempt(c, "delete from public.trip_members where user_id = $1", [s.bob])).error).toBeDefined();
    await remove(s.tripId, s.bob);

    const live = await inviteAs(c, s.coordinator, s.tripId);
    const dead = await inviteAs(c, s.coordinator, s.tripId);
    await c.query("update public.invitations set revoked_at = now() where token_hash = $1", [sha256Hex(dead)]);

    await asUser(c, s.bob);
    expect((await attempt(c, "select public.join_with_invite($1)", [dead])).error?.message).toBe("invite_invalid");
    expect(await joinAs(c, s.bob, live)).toBe(s.tripId);
  });
});

describe("trip creation", () => {
  it("rejects bad trips at the database as well", async () => {
    await asUser(c, s.outsider);
    expect((await attempt(c, "select public.create_trip('   ', 'USD')")).error?.code).toBe("23514");
    expect((await attempt(c, "select public.create_trip('x', 'USD', '2026-05-10', '2026-05-01')")).error?.code).toBe("23514");
    expect((await attempt(c, "select public.create_trip('x', 'usd')")).error?.code).toBe("23514");
  });

  it("records the caller as the creator", async () => {
    const id = await createTripAs(c, s.outsider, "Mine");
    await asAdmin(c);
    const r = await c.query("select created_by from public.trips where id = $1", [id]);
    expect(r.rows).toEqual([{ created_by: s.outsider }]);
  });
});
