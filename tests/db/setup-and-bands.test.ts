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

describe("budget bands", () => {
  const BAND_SENTINEL = 987654321;
  const insertBand = (user: string, band: string, ceiling: number | null) =>
    c.query("insert into public.member_budgets (trip_id, user_id, band, ceiling_minor) values ($1, $2, $3, $4)", [s.tripId, user, band, ceiling]);

  it("lets the owner store a band with and without a ceiling", async () => {
    await asUser(c, s.bob);
    await insertBand(s.bob, "2k_3k", 300000);
    await asUser(c, s.carol);
    await insertBand(s.carol, "4k_plus", null);
    expect((await c.query("select band, ceiling_minor from public.member_budgets")).rows).toEqual([{ band: "4k_plus", ceiling_minor: null }]);
  });

  it("rejects an unknown band and a row with neither band nor ceiling", async () => {
    await asUser(c, s.bob);
    expect((await attempt(c, "insert into public.member_budgets (trip_id, user_id, band, ceiling_minor) values ($1, $2, '5k', 1)", [s.tripId, s.bob])).error?.code).toBe("23514");
    expect((await attempt(c, "insert into public.member_budgets (trip_id, user_id) values ($1, $2)", [s.tripId, s.bob])).error?.code).toBe("23514");
  });

  it("hides a member's band from the coordinator, other members, outsiders and anon", async () => {
    await asUser(c, s.bob);
    await insertBand(s.bob, "3k_4k", BAND_SENTINEL);
    for (const who of [s.coordinator, s.carol, s.outsider]) {
      await asUser(c, who);
      expect(await count("member_budgets"), who).toBe(0);
      expect((await c.query("select band, ceiling_minor from public.member_budgets where user_id = $1", [s.bob])).rowCount, who).toBe(0);
    }
    await asAnon(c);
    expect((await attempt(c, "select band from public.member_budgets")).error?.code).toBe("42501");
    await asUser(c, s.bob);
    expect((await c.query("select ceiling_minor::int as v from public.member_budgets")).rows).toEqual([{ v: BAND_SENTINEL }]);
  });

  it("stops another member from changing a band", async () => {
    await asUser(c, s.bob);
    await insertBand(s.bob, "under_2k", 200000);
    await asUser(c, s.carol);
    expect((await c.query("update public.member_budgets set band = '4k_plus', ceiling_minor = null where user_id = $1", [s.bob])).rowCount).toBe(0);
    await asAdmin(c);
    expect((await c.query("select band from public.member_budgets where user_id = $1", [s.bob])).rows).toEqual([{ band: "under_2k" }]);
  });
});
