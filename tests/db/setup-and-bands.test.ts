import type { Client } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { asAdmin, asAnon, asUser, attempt, connect, scene, type Scene } from "./helpers";

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
  tokyo = await destination("Tokyo");
  seoul = await destination("Seoul");
});
afterEach(async () => {
  await c.query("rollback");
});

async function destination(name: string): Promise<string> {
  await asUser(c, s.bob);
  const r = await c.query("insert into public.destinations (trip_id, name, suggested_by) values ($1, $2, $3) returning id", [
    s.tripId,
    name,
    s.bob,
  ]);
  return r.rows[0].id as string;
}

const count = async (table: string, where = "true") =>
  ((await c.query(`select count(*)::int as n from public.${table} where ${where}`)).rows[0] as { n: number }).n;

describe("deleting a destination", () => {
  async function seedDependents() {
    await asUser(c, s.coordinator);
    await c.query("insert into public.trip_constraints (trip_id, departure_airport, start_destination_id, end_destination_id) values ($1, 'YYZ', $2, $3)", [s.tripId, tokyo, seoul]);
    await c.query("insert into public.destination_constraints (trip_id, destination_id, min_nights) values ($1, $2, 3)", [s.tripId, tokyo]);
    await c.query("insert into public.trip_fixed_events (trip_id, destination_id, label, start_date, end_date) values ($1, $2, 'Match', '2027-03-02', '2027-03-04')", [s.tripId, tokyo]);
    await c.query(
      `insert into public.quotes (trip_id, kind, mode, from_destination_id, to_destination_id, duration_minutes, amount_minor, currency, source, created_by)
       values ($1, 'leg', 'flight', $2, $3, 150, 20000, 'USD', 'manual', $4)`,
      [s.tripId, tokyo, seoul, s.coordinator],
    );
    await asUser(c, s.carol);
    await c.query("insert into public.destination_preferences (trip_id, destination_id, user_id, score) values ($1, $2, $3, 1)", [s.tripId, tokyo, s.carol]);
  }

  it("lets the coordinator delete, taking dependent rows and clearing trip references", async () => {
    await seedDependents();
    await asUser(c, s.coordinator);
    expect((await c.query("delete from public.destinations where id = $1", [tokyo])).rowCount).toBe(1);
    expect(await count("destinations", `id = '${tokyo}'`)).toBe(0);
    expect(await count("destination_constraints")).toBe(0);
    expect(await count("trip_fixed_events")).toBe(0);
    expect(await count("quotes")).toBe(0);
    expect(await count("destination_preferences")).toBe(0);
    const tc = await c.query("select start_destination_id, end_destination_id from public.trip_constraints");
    expect(tc.rows).toEqual([{ start_destination_id: null, end_destination_id: seoul }]);
  });

  it("does not let a member (even the one who suggested it) or an outsider delete", async () => {
    for (const who of [s.bob, s.carol, s.outsider]) {
      await asUser(c, who);
      expect((await c.query("delete from public.destinations where id = $1", [tokyo])).rowCount, who).toBe(0);
    }
    await asAdmin(c);
    expect(await count("destinations", `id = '${tokyo}'`)).toBe(1);
  });

  it("does not let anon delete", async () => {
    await asAnon(c);
    expect((await attempt(c, "delete from public.destinations where id = $1", [tokyo])).error?.code).toBe("42501");
  });

  it("does not let a coordinator of another trip delete", async () => {
    await asUser(c, s.outsider);
    const other = await c.query("select public.create_trip('Other', 'USD') as id");
    expect(other.rowCount).toBe(1);
    expect((await c.query("delete from public.destinations where id = $1", [tokyo])).rowCount).toBe(0);
  });
});

describe("exact budgets and bands", () => {
  const SENTINEL = 987654321; // 9,876,543.21: unmistakable if it ever leaks
  const insertAmount = (user: string, amount: number | null, band: string | null = null, currency?: string) =>
    c.query("insert into public.member_budgets (trip_id, user_id, ceiling_minor, band, currency) values ($1, $2, $3, $4, coalesce($5, 'USD'))", [
      s.tripId,
      user,
      amount,
      band,
      currency ?? null,
    ]);
  const bandOf = async (user: string) =>
    (await c.query("select band from public.member_budgets where user_id = $1", [user])).rows[0]?.band as string | undefined;

  it("derives the band from the amount at every boundary", async () => {
    await asUser(c, s.bob);
    const cases: [number, string][] = [
      [0, "under_2k"],
      [1, "under_2k"],
      [199_999, "under_2k"],
      [200_000, "2k_3k"],
      [299_999, "2k_3k"],
      [300_000, "3k_4k"],
      [399_999, "3k_4k"],
      [400_000, "4k_plus"],
    ];
    await insertAmount(s.bob, 0);
    for (const [amount, band] of cases) {
      await c.query("update public.member_budgets set ceiling_minor = $1 where user_id = $2", [amount, s.bob]);
      expect(await bandOf(s.bob), String(amount)).toBe(band);
    }
  });

  it("uses whole units for a zero-decimal currency", async () => {
    await asUser(c, s.bob);
    await insertAmount(s.bob, 1999, null, "JPY");
    expect(await bandOf(s.bob)).toBe("under_2k");
    await c.query("update public.member_budgets set ceiling_minor = 2000 where user_id = $1", [s.bob]);
    expect(await bandOf(s.bob)).toBe("2k_3k");
    await c.query("update public.member_budgets set ceiling_minor = 4000 where user_id = $1", [s.bob]);
    expect(await bandOf(s.bob)).toBe("4k_plus");
  });

  it("cannot be made to disagree: a client-supplied band is overwritten, a band-only edit is undone", async () => {
    await asUser(c, s.bob);
    await insertAmount(s.bob, 250_000, "4k_plus");
    expect(await bandOf(s.bob)).toBe("2k_3k");
    await c.query("update public.member_budgets set band = 'under_2k' where user_id = $1", [s.bob]);
    expect(await bandOf(s.bob)).toBe("2k_3k");
  });

  it("rejects an unknown band and a row with neither band nor amount", async () => {
    await asUser(c, s.bob);
    expect((await attempt(c, "insert into public.member_budgets (trip_id, user_id, band) values ($1, $2, '5k')", [s.tripId, s.bob])).error?.code).toBe("23514");
    expect((await attempt(c, "insert into public.member_budgets (trip_id, user_id) values ($1, $2)", [s.tripId, s.bob])).error?.code).toBe("23514");
  });

  it("lets the owner read their own exact amount", async () => {
    await asUser(c, s.bob);
    await insertAmount(s.bob, SENTINEL);
    expect((await c.query("select ceiling_minor::int as v, band from public.member_budgets")).rows).toEqual([{ v: SENTINEL, band: "4k_plus" }]);
  });

  it("hides another member's row from direct selects, for coordinator, members, outsiders and anon", async () => {
    await asUser(c, s.bob);
    await insertAmount(s.bob, SENTINEL);
    for (const who of [s.coordinator, s.carol, s.outsider]) {
      await asUser(c, who);
      expect(await count("member_budgets"), who).toBe(0);
      expect((await c.query("select band, ceiling_minor from public.member_budgets where user_id = $1", [s.bob])).rowCount, who).toBe(0);
    }
    await asAnon(c);
    expect((await attempt(c, "select band from public.member_budgets")).error?.code).toBe("42501");
  });

  it("stops another member from changing the amount", async () => {
    await asUser(c, s.bob);
    await insertAmount(s.bob, 100_000);
    await asUser(c, s.carol);
    expect((await c.query("update public.member_budgets set ceiling_minor = 500000 where user_id = $1", [s.bob])).rowCount).toBe(0);
    await asAdmin(c);
    expect((await c.query("select ceiling_minor::int as v, band from public.member_budgets where user_id = $1", [s.bob])).rows).toEqual([{ v: 100_000, band: "under_2k" }]);
  });
});

describe("trip_member_bands", () => {
  const SENTINEL = 987654321;
  const bands = async () => (await c.query("select user_id, band from public.trip_member_bands($1) order by band", [s.tripId])).rows;

  async function seed() {
    await asUser(c, s.bob);
    await c.query("insert into public.member_budgets (trip_id, user_id, ceiling_minor) values ($1, $2, $3)", [s.tripId, s.bob, 250_000]);
    await asUser(c, s.carol);
    await c.query("insert into public.member_budgets (trip_id, user_id, ceiling_minor) values ($1, $2, $3)", [s.tripId, s.carol, SENTINEL]);
  }

  it("shows every member the bands of the members who set a budget, and no amount", async () => {
    await seed();
    for (const who of [s.bob, s.carol, s.coordinator]) {
      await asUser(c, who);
      const res = await c.query("select * from public.trip_member_bands($1)", [s.tripId]);
      expect(res.fields.map((f) => f.name).sort(), who).toEqual(["band", "user_id"]);
      expect(res.rows.sort((a, b) => a.band.localeCompare(b.band)), who).toEqual([
        { user_id: s.bob, band: "2k_3k" },
        { user_id: s.carol, band: "4k_plus" },
      ]);
      expect(JSON.stringify(res.rows), who).not.toContain(String(SENTINEL));
    }
  });

  it("returns nothing to a non-member, to a member of another trip, and for an unknown trip", async () => {
    await seed();
    await asUser(c, s.outsider);
    expect(await bands()).toEqual([]);
    await c.query("select public.create_trip('Other', 'USD') as id");
    expect(await bands()).toEqual([]);
    await asUser(c, s.bob);
    expect((await c.query("select * from public.trip_member_bands($1)", ["00000000-0000-0000-0000-000000000000"])).rowCount).toBe(0);
  });

  it("is not callable by anon, and never exposes ceiling_minor", async () => {
    await seed();
    await asAnon(c);
    expect((await attempt(c, "select * from public.trip_member_bands($1)", [s.tripId])).error?.code).toBe("42501");
    await asUser(c, s.carol);
    expect((await attempt(c, "select ceiling_minor from public.trip_member_bands($1)", [s.tripId])).error?.code).toBe("42703");
  });

  it("stops returning a member's band once they leave the trip", async () => {
    await seed();
    await asUser(c, s.coordinator);
    await c.query("select public.remove_member($1, $2)", [s.tripId, s.bob]);
    await asUser(c, s.carol);
    expect(await bands()).toEqual([{ user_id: s.carol, band: "4k_plus" }]);
  });
});
