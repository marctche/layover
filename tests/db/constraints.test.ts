import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asAnon, asUser, attempt, connect, createTripAs, createUser, scene, type Scene } from "./helpers";

// Each test runs in a transaction that is rolled back.
let c: Client;
let s: Scene;
let tokyo: string;
let seoul: string;

beforeAll(async () => {
  c = await connect();
});
afterAll(async () => {
  await c.end();
});
beforeEach(async () => {
  await c.query("begin");
  s = await scene(c);
  tokyo = await destination(s.tripId, s.bob, "Tokyo");
  seoul = await destination(s.tripId, s.carol, "Seoul");
});
afterEach(async () => {
  await c.query("rollback");
});

async function destination(tripId: string, userId: string, name: string): Promise<string> {
  await asUser(c, userId);
  const r = await c.query("insert into public.destinations (trip_id, name, suggested_by) values ($1, $2, $3) returning id", [
    tripId,
    name,
    userId,
  ]);
  return r.rows[0].id as string;
}

const count = async (table: string, where = "true") =>
  ((await c.query(`select count(*)::int as n from public.${table} where ${where}`)).rows[0] as { n: number }).n;

const NEW_TABLES = [
  "trip_constraints",
  "destination_constraints",
  "trip_fixed_events",
  "member_availability",
  "member_availability_ranges",
  "quotes",
  "route_scenarios",
];

const INSERT_QUOTE = `insert into public.quotes
  (trip_id, kind, mode, from_destination_id, to_destination_id, duration_minutes, amount_minor, currency, source, created_by)
  values ($1, 'leg', 'flight', $2, $3, 150, 20000, 'USD', $4, $5) returning id`;

const INSERT_SCENARIO = `insert into public.route_scenarios (trip_id, engine_version, input_hash, input, result, ok, created_by)
  values ($1, 'v1', $2, '{}', '{}', true, $3)`;
const hash = (n: string) => n.repeat(64).slice(0, 64);

/** Seed one row in every new table as the right actors, ending as admin. */
async function seedAll() {
  await asUser(c, s.coordinator);
  await c.query("insert into public.trip_constraints (trip_id, departure_airport, start_destination_id) values ($1, 'YYZ', $2)", [s.tripId, tokyo]);
  await c.query("insert into public.destination_constraints (trip_id, destination_id, min_nights) values ($1, $2, 3)", [s.tripId, tokyo]);
  await c.query("insert into public.trip_fixed_events (trip_id, destination_id, label, start_date, end_date) values ($1, $2, 'Match', '2027-03-02', '2027-03-04')", [s.tripId, seoul]);
  await c.query(INSERT_QUOTE, [s.tripId, tokyo, seoul, "manual", s.coordinator]);
  await asUser(c, s.bob);
  await c.query("select public.set_my_availability($1, 2, $2::jsonb)", [s.tripId, JSON.stringify([{ start_date: "2027-03-01", end_date: "2027-03-10" }])]);
  await c.query(INSERT_SCENARIO, [s.tripId, hash("a"), s.bob]);
  await asAdmin(c);
}

describe("access to the new tables", () => {
  it("shows an outsider and anon nothing", async () => {
    await seedAll();
    await asUser(c, s.outsider);
    for (const t of NEW_TABLES) expect(await count(t), t).toBe(0);
    await asAnon(c);
    for (const t of NEW_TABLES) expect((await attempt(c, `select * from public.${t}`)).error?.code, t).toBe("42501");
  });

  it("lets every member read all of them", async () => {
    await seedAll();
    for (const user of [s.coordinator, s.bob, s.carol]) {
      await asUser(c, user);
      for (const t of NEW_TABLES) expect(await count(t), `${t} as ${user}`).toBeGreaterThan(0);
    }
  });

  it("has row-level security on every one, and no grant to anon", async () => {
    await asAdmin(c);
    const rls = await c.query(
      "select relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and relname = any($1) and not relrowsecurity",
      [NEW_TABLES],
    );
    expect(rls.rows).toEqual([]);
    const grants = await c.query(
      "select table_name from information_schema.role_table_grants where table_schema = 'public' and grantee = 'anon' and table_name = any($1)",
      [NEW_TABLES],
    );
    expect(grants.rows).toEqual([]);
  });
});

describe("only the coordinator writes constraints", () => {
  const writes: [string, string, (x: Scene, d: { tokyo: string; seoul: string }) => unknown[]][] = [
    ["trip_constraints", "insert into public.trip_constraints (trip_id, departure_airport) values ($1, 'YYZ')", (x) => [x.tripId]],
    ["destination_constraints", "insert into public.destination_constraints (trip_id, destination_id) values ($1, $2)", (x, d) => [x.tripId, d.tokyo]],
    ["trip_fixed_events", "insert into public.trip_fixed_events (trip_id, destination_id, label, start_date, end_date) values ($1, $2, 'x', '2027-03-02', '2027-03-03')", (x, d) => [x.tripId, d.tokyo]],
  ];

  for (const [table, sql, args] of writes) {
    it(`${table}: coordinator inserts, members and outsiders cannot`, async () => {
      const a = args(s, { tokyo, seoul });
      for (const user of [s.bob, s.carol, s.outsider]) {
        await asUser(c, user);
        expect((await attempt(c, sql, a)).error, `${table} as ${user}`).toBeDefined();
      }
      await asAdmin(c);
      expect(await count(table)).toBe(0);
      await asUser(c, s.coordinator);
      expect((await attempt(c, sql, a)).error).toBeUndefined();
    });
  }

  it("refuses member updates and deletes on constraints and events", async () => {
    await seedAll();
    await asUser(c, s.bob);
    const upd = await c.query("update public.destination_constraints set min_nights = 9 where destination_id = $1", [tokyo]);
    const del = await c.query("delete from public.trip_fixed_events where trip_id = $1", [s.tripId]);
    const upd2 = await c.query("update public.trip_constraints set departure_airport = 'NRT' where trip_id = $1", [s.tripId]);
    expect([upd.rowCount, del.rowCount, upd2.rowCount]).toEqual([0, 0, 0]);
    await asAdmin(c);
    expect(await count("destination_constraints", "min_nights = 3")).toBe(1);
    expect(await count("trip_fixed_events")).toBe(1);
  });

  it("lets only the coordinator set confirmed dates, only those columns, only while planning", async () => {
    await asUser(c, s.bob);
    expect((await c.query("update public.trips set start_date = '2027-03-01', end_date = '2027-03-08' where id = $1", [s.tripId])).rowCount).toBe(0);
    await asUser(c, s.coordinator);
    expect((await c.query("update public.trips set start_date = '2027-03-01', end_date = '2027-03-08' where id = $1", [s.tripId])).rowCount).toBe(1);
    expect((await attempt(c, "update public.trips set name = 'Mine' where id = $1", [s.tripId])).error?.code).toBe("42501");
    expect((await attempt(c, "update public.trips set status = 'approved' where id = $1", [s.tripId])).error?.code).toBe("42501");
    expect((await attempt(c, "update public.trips set start_date = '2027-03-01', end_date = null where id = $1", [s.tripId])).error).toBeDefined();
    await asAdmin(c);
    await c.query("update public.trips set status = 'approved' where id = $1", [s.tripId]);
    await asUser(c, s.coordinator);
    expect((await c.query("update public.trips set start_date = '2027-04-01', end_date = '2027-04-08' where id = $1", [s.tripId])).rowCount).toBe(0);
  });

  it("enforces ranges and stay rules in the database", async () => {
    await asUser(c, s.coordinator);
    const bad = (sql: string, args: unknown[]) => attempt(c, sql, args);
    expect((await bad("insert into public.trip_constraints (trip_id, earliest_start, latest_end) values ($1, '2027-04-01', '2027-03-01')", [s.tripId])).error).toBeDefined();
    expect((await bad("insert into public.trip_constraints (trip_id, min_nights, max_nights) values ($1, 9, 3)", [s.tripId])).error).toBeDefined();
    expect((await bad("insert into public.destination_constraints (trip_id, destination_id, min_nights, max_nights) values ($1, $2, 4, 2)", [s.tripId, tokyo])).error).toBeDefined();
    expect((await bad("insert into public.trip_fixed_events (trip_id, destination_id, label, start_date, end_date) values ($1, $2, 'x', '2027-03-05', '2027-03-01')", [s.tripId, tokyo])).error).toBeDefined();
    expect((await bad("insert into public.trip_constraints (trip_id, departure_airport) values ($1, 'toronto')", [s.tripId])).error).toBeDefined();
  });

  it("allows one lock position per trip", async () => {
    await asUser(c, s.coordinator);
    await c.query("insert into public.destination_constraints (trip_id, destination_id, lock_position) values ($1, $2, 1)", [s.tripId, tokyo]);
    const dup = await attempt(c, "insert into public.destination_constraints (trip_id, destination_id, lock_position) values ($1, $2, 1)", [s.tripId, seoul]);
    expect(dup.error?.code).toBe("23505");
  });
});

describe("references stay inside the trip", () => {
  let otherTrip: string;
  let otherDest: string;

  beforeEach(async () => {
    await asAdmin(c);
    const other = await createUser(c, "other");
    otherTrip = await createTripAs(c, other, "Other");
    otherDest = await destination(otherTrip, other, "Lima");
    await asAdmin(c);
  });

  it("rejects destinations of another trip in every new table", async () => {
    await asUser(c, s.coordinator);
    const cases: [string, unknown[]][] = [
      ["insert into public.trip_constraints (trip_id, start_destination_id) values ($1, $2)", [s.tripId, otherDest]],
      ["insert into public.trip_constraints (trip_id, end_destination_id) values ($1, $2)", [s.tripId, otherDest]],
      ["insert into public.destination_constraints (trip_id, destination_id) values ($1, $2)", [s.tripId, otherDest]],
      ["insert into public.trip_fixed_events (trip_id, destination_id, label, start_date, end_date) values ($1, $2, 'x', '2027-03-01', '2027-03-02')", [s.tripId, otherDest]],
      [INSERT_QUOTE, [s.tripId, tokyo, otherDest, "manual", s.coordinator]],
      [INSERT_QUOTE, [s.tripId, otherDest, tokyo, "manual", s.coordinator]],
    ];
    for (const [sql, args] of cases) {
      expect((await attempt(c, sql, args)).error?.code, sql).toBe("23503");
    }
  });

  it("rejects a coordinator writing into a trip they do not coordinate", async () => {
    await asUser(c, s.coordinator);
    expect((await attempt(c, "insert into public.trip_constraints (trip_id) values ($1)", [otherTrip])).error).toBeDefined();
    expect((await attempt(c, INSERT_QUOTE, [otherTrip, otherDest, otherDest, "manual", s.coordinator])).error).toBeDefined();
  });
});

describe("quotes", () => {
  it("lets the coordinator add a manual quote as themselves, and nothing else", async () => {
    await asUser(c, s.coordinator);
    expect((await attempt(c, INSERT_QUOTE, [s.tripId, tokyo, seoul, "manual", s.coordinator])).error).toBeUndefined();
    // Not as someone else, and not with no creator.
    expect((await attempt(c, INSERT_QUOTE, [s.tripId, tokyo, seoul, "manual", s.bob])).error).toBeDefined();
    expect((await attempt(c, INSERT_QUOTE, [s.tripId, tokyo, seoul, "manual", null])).error).toBeDefined();
  });

  it("refuses live, estimate and synthetic from any signed-in user, coordinator included", async () => {
    for (const user of [s.coordinator, s.bob, s.outsider]) {
      await asUser(c, user);
      for (const source of ["live", "estimate", "synthetic"]) {
        const r = await attempt(c, INSERT_QUOTE, [s.tripId, tokyo, seoul, source, user]);
        expect(r.error, `${source} as ${user}`).toBeDefined();
      }
    }
    await asAdmin(c);
    expect(await count("quotes")).toBe(0);
  });

  it("refuses an unknown source value even for the service role", async () => {
    await asAdmin(c);
    await c.query("set local role service_role");
    expect((await attempt(c, INSERT_QUOTE, [s.tripId, tokyo, seoul, "oracle", null])).error?.code).toBe("23514");
  });

  it("lets the service role write a synthetic quote, which members read back as synthetic", async () => {
    await asAdmin(c);
    await c.query("set local role service_role");
    const r = await c.query(INSERT_QUOTE, [s.tripId, tokyo, seoul, "synthetic", null]);
    expect(r.rowCount).toBe(1);
    await asUser(c, s.carol);
    const rows = await c.query("select source from public.quotes where trip_id = $1", [s.tripId]);
    expect(rows.rows).toEqual([{ source: "synthetic" }]);
  });

  it("lets members read but not delete; the coordinator deletes", async () => {
    await asUser(c, s.coordinator);
    const id = (await c.query(INSERT_QUOTE, [s.tripId, tokyo, seoul, "manual", s.coordinator])).rows[0].id as string;
    await asUser(c, s.bob);
    expect(await count("quotes")).toBe(1);
    expect((await c.query("delete from public.quotes where id = $1", [id])).rowCount).toBe(0);
    await asUser(c, s.coordinator);
    expect((await c.query("delete from public.quotes where id = $1", [id])).rowCount).toBe(1);
  });

  it("refuses updates by anyone signed in", async () => {
    await asUser(c, s.coordinator);
    await c.query(INSERT_QUOTE, [s.tripId, tokyo, seoul, "manual", s.coordinator]);
    expect((await attempt(c, "update public.quotes set source = 'live'")).error?.code).toBe("42501");
    expect((await attempt(c, "update public.quotes set amount_minor = 1")).error?.code).toBe("42501");
  });

  it("checks the shape of legs and fares", async () => {
    await asAdmin(c);
    await c.query("set local role service_role");
    const leg = (from: string | null, to: string | null) =>
      attempt(c, INSERT_QUOTE, [s.tripId, from, to, "synthetic", null]);
    expect((await leg(null, null)).error?.code).toBe("23514"); // no end named
    expect((await leg(tokyo, tokyo)).error?.code).toBe("23514"); // same place
    expect((await leg(null, tokyo)).error).toBeUndefined(); // home to Tokyo
    expect((await leg(seoul, null)).error).toBeUndefined(); // Seoul to home
    const fare = (back: string | null, returnMinutes: number | null) =>
      attempt(
        c,
        `insert into public.quotes (trip_id, kind, mode, to_destination_id, return_from_destination_id, duration_minutes, return_minutes, amount_minor, currency, source)
         values ($1, 'long_haul_fare', 'flight', $2, $3, 700, $4, 150000, 'USD', 'estimate')`,
        [s.tripId, tokyo, back, returnMinutes],
      );
    expect((await fare(seoul, 720)).error).toBeUndefined();
    expect((await fare(null, 720)).error?.code).toBe("23514");
    expect((await fare(seoul, null)).error?.code).toBe("23514");
    expect((await attempt(c, "update public.quotes set expires_at = fetched_at - interval '1 day' where kind = 'long_haul_fare'")).error?.code).toBe("23514");
  });
});

describe("route_scenarios", () => {
  it("lets a member save a run as themselves, and everyone in the trip read it", async () => {
    await asUser(c, s.bob);
    expect((await attempt(c, INSERT_SCENARIO, [s.tripId, hash("a"), s.bob])).error).toBeUndefined();
    await asUser(c, s.carol);
    expect(await count("route_scenarios")).toBe(1);
    await asUser(c, s.outsider);
    expect(await count("route_scenarios")).toBe(0);
  });

  it("refuses a run saved as someone else, by an outsider, or with no creator", async () => {
    await asUser(c, s.bob);
    expect((await attempt(c, INSERT_SCENARIO, [s.tripId, hash("a"), s.carol])).error).toBeDefined();
    expect((await attempt(c, INSERT_SCENARIO, [s.tripId, hash("a"), null])).error).toBeDefined();
    await asUser(c, s.outsider);
    expect((await attempt(c, INSERT_SCENARIO, [s.tripId, hash("a"), s.outsider])).error).toBeDefined();
  });

  it("refuses updates and deletes by everyone, the coordinator included", async () => {
    await asUser(c, s.bob);
    await c.query(INSERT_SCENARIO, [s.tripId, hash("a"), s.bob]);
    for (const user of [s.bob, s.coordinator]) {
      await asUser(c, user);
      expect((await attempt(c, "update public.route_scenarios set ok = false")).error?.code, user).toBe("42501");
      expect((await attempt(c, "delete from public.route_scenarios")).error?.code, user).toBe("42501");
    }
    await asAdmin(c);
    expect(await count("route_scenarios", "ok")).toBe(1);
  });

  it("allows one run per trip, engine version and input hash", async () => {
    await asUser(c, s.bob);
    await c.query(INSERT_SCENARIO, [s.tripId, hash("a"), s.bob]);
    expect((await attempt(c, INSERT_SCENARIO, [s.tripId, hash("a"), s.carol])).error).toBeDefined();
    expect((await attempt(c, INSERT_SCENARIO, [s.tripId, hash("b"), s.bob])).error).toBeUndefined();
    expect((await attempt(c, INSERT_SCENARIO.replace("'v1'", "'v2'"), [s.tripId, hash("a"), s.bob])).error).toBeUndefined();
  });

  it("rejects a malformed hash", async () => {
    await asUser(c, s.bob);
    expect((await attempt(c, INSERT_SCENARIO, [s.tripId, "not-a-hash", s.bob])).error?.code).toBe("23514");
  });
});

describe("member availability", () => {
  const ranges = (...r: [string, string][]) => JSON.stringify(r.map(([start_date, end_date]) => ({ start_date, end_date })));
  const set = (user: string, days: number, r: string) =>
    asUser(c, user).then(() => c.query("select public.set_my_availability($1, $2, $3::jsonb)", [s.tripId, days, r]));

  it("lets a member write their own ranges and flexibility, replacing the previous ones", async () => {
    await set(s.bob, 2, ranges(["2027-03-01", "2027-03-10"], ["2027-04-01", "2027-04-05"]));
    await set(s.bob, 5, ranges(["2027-05-01", "2027-05-09"]));
    await asAdmin(c);
    expect(await count("member_availability_ranges", `user_id = '${s.bob}'`)).toBe(1);
    expect((await c.query("select flexibility_days from public.member_availability where user_id = $1", [s.bob])).rows).toEqual([{ flexibility_days: 5 }]);
  });

  it("lets the whole group read it, and nobody else", async () => {
    await set(s.bob, 2, ranges(["2027-03-01", "2027-03-10"]));
    await asUser(c, s.carol);
    expect(await count("member_availability")).toBe(1);
    expect(await count("member_availability_ranges")).toBe(1);
    await asUser(c, s.outsider);
    expect(await count("member_availability")).toBe(0);
  });

  it("does not let a member write, change or delete another member's rows", async () => {
    await set(s.bob, 2, ranges(["2027-03-01", "2027-03-10"]));
    await asUser(c, s.carol);
    expect((await attempt(c, "insert into public.member_availability (trip_id, user_id) values ($1, $2)", [s.tripId, s.carol])).error).toBeUndefined();
    expect((await attempt(c, "insert into public.member_availability (trip_id, user_id) values ($1, $2)", [s.tripId, s.coordinator])).error).toBeDefined();
    expect((await attempt(c, "insert into public.member_availability_ranges (trip_id, user_id, start_date, end_date) values ($1, $2, '2027-01-01', '2027-01-02')", [s.tripId, s.bob])).error).toBeDefined();
    expect((await c.query("update public.member_availability set flexibility_days = 40 where user_id = $1", [s.bob])).rowCount).toBe(0);
    expect((await c.query("delete from public.member_availability_ranges where user_id = $1", [s.bob])).rowCount).toBe(0);
    expect((await c.query("delete from public.member_availability where user_id = $1", [s.bob])).rowCount).toBe(0);
    await asAdmin(c);
    expect(await count("member_availability_ranges", `user_id = '${s.bob}'`)).toBe(1);
    expect(await count("member_availability", `user_id = '${s.bob}' and flexibility_days = 2`)).toBe(1);
  });

  it("gives the coordinator no write access to a member's availability", async () => {
    await set(s.bob, 2, ranges(["2027-03-01", "2027-03-10"]));
    await asUser(c, s.coordinator);
    expect((await c.query("update public.member_availability set flexibility_days = 40 where user_id = $1", [s.bob])).rowCount).toBe(0);
    expect((await c.query("delete from public.member_availability_ranges where user_id = $1", [s.bob])).rowCount).toBe(0);
  });

  it("refuses outsiders and anon from the function, and bad ranges from members", async () => {
    await asUser(c, s.outsider);
    expect((await attempt(c, "select public.set_my_availability($1, 1, '[]')", [s.tripId])).error?.code).toBe("42501");
    await asAnon(c);
    expect((await attempt(c, "select public.set_my_availability($1, 1, '[]')", [s.tripId])).error?.code).toBe("42501");
    await asUser(c, s.bob);
    expect((await attempt(c, "select public.set_my_availability($1, 99, '[]')", [s.tripId])).error?.code).toBe("23514");
    expect((await attempt(c, "select public.set_my_availability($1, 1, $2::jsonb)", [s.tripId, ranges(["2027-03-10", "2027-03-01"])])).error?.code).toBe("23514");
    expect((await attempt(c, "select public.set_my_availability($1, 1, '{}')", [s.tripId])).error?.code).toBe("22023");
  });

  it("disappears with the member", async () => {
    await set(s.bob, 2, ranges(["2027-03-01", "2027-03-10"]));
    await asUser(c, s.coordinator);
    await c.query("select public.remove_member($1, $2)", [s.tripId, s.bob]);
    await asAdmin(c);
    expect(await count("member_availability", `user_id = '${s.bob}'`)).toBe(0);
    expect(await count("member_availability_ranges", `user_id = '${s.bob}'`)).toBe(0);
  });
});

describe("budget currency and flexibility stay private", () => {
  it("defaults the currency to the trip's and stores a different one as entered", async () => {
    await asUser(c, s.bob);
    await c.query("insert into public.member_budgets (trip_id, user_id, ceiling_minor) values ($1, $2, 100000)", [s.tripId, s.bob]);
    await asUser(c, s.carol);
    await c.query("insert into public.member_budgets (trip_id, user_id, ceiling_minor, currency, flexibility_minor) values ($1, $2, 90000, 'CAD', 15000)", [s.tripId, s.carol]);
    const own = await c.query("select ceiling_minor::int as ceiling, currency, flexibility_minor::int as flex from public.member_budgets");
    expect(own.rows).toEqual([{ ceiling: 90000, currency: "CAD", flex: 15000 }]);
    await asUser(c, s.bob);
    expect((await c.query("select currency, flexibility_minor from public.member_budgets")).rows).toEqual([{ currency: "USD", flexibility_minor: null }]);
  });

  it("hides them from the coordinator and other members, and refuses their writes", async () => {
    await asUser(c, s.bob);
    await c.query("insert into public.member_budgets (trip_id, user_id, ceiling_minor, flexibility_minor) values ($1, $2, 100000, 5000)", [s.tripId, s.bob]);
    for (const user of [s.coordinator, s.carol, s.outsider]) {
      await asUser(c, user);
      expect(await count("member_budgets"), user).toBe(0);
      expect((await c.query("update public.member_budgets set flexibility_minor = 1, currency = 'EUR' where user_id = $1", [s.bob])).rowCount, user).toBe(0);
    }
    await asAdmin(c);
    expect((await c.query("select flexibility_minor::int as f, currency from public.member_budgets")).rows).toEqual([{ f: 5000, currency: "USD" }]);
  });

  it("rejects a negative flexibility and a malformed currency", async () => {
    await asUser(c, s.bob);
    expect((await attempt(c, "insert into public.member_budgets (trip_id, user_id, ceiling_minor, flexibility_minor) values ($1, $2, 1, -1)", [s.tripId, s.bob])).error?.code).toBe("23514");
    expect((await attempt(c, "insert into public.member_budgets (trip_id, user_id, ceiling_minor, currency) values ($1, $2, 1, 'usd')", [s.tripId, s.bob])).error?.code).toBe("23514");
  });

  it("is not exposed through a view, a function body, or a coordinator policy", async () => {
    await asAdmin(c);
    const exposed = await c.query(
      "select policyname from pg_policies where tablename = 'member_budgets' and (coalesce(qual,'') || coalesce(with_check,'')) ilike '%is_coordinator%'",
    );
    expect(exposed.rows).toEqual([]);
    const fns = await c.query(
      "select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname in ('public','app') and p.prosrc ilike '%member_budgets%'",
    );
    expect(fns.rows).toEqual([]);
  });
});

describe("destination coordinates", () => {
  const insert = (lat: unknown, lng: unknown) =>
    attempt(c, "insert into public.destinations (trip_id, name, suggested_by, lat, lng) values ($1, 'Busan', $2, $3, $4)", [
      s.tripId,
      s.bob,
      lat,
      lng,
    ]);

  it("accepts valid coordinates or none, and rejects out-of-range or half-set pairs", async () => {
    await asUser(c, s.bob);
    expect((await insert(35.18, 129.08)).error).toBeUndefined();
    await c.query("delete from public.destinations where name = 'Busan'");
    expect((await insert(null, null)).error).toBeUndefined();
    await c.query("delete from public.destinations where name = 'Busan'");
    expect((await insert(91, 0)).error?.code).toBe("23514");
    expect((await insert(0, 181)).error?.code).toBe("23514");
    expect((await insert(10, null)).error?.code).toBe("23514");
  });
});
