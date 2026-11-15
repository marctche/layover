import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { newClient, readCode, signInWithEmailCode } from "./helpers";

// Signs in with real emailed codes against a local Supabase stack, then checks that row-level
// security holds for real sessions (not just for simulated roles). See helpers.ts for the
// environment the stack needs.

describe("real email-code login", () => {
  it("rejects a wrong code", async () => {
    const email = `wrong-${randomUUID().slice(0, 8)}@example.test`;
    const db = newClient();
    expect((await db.auth.signInWithOtp({ email })).error).toBeNull();
    const real = await readCode(email);
    const wrong = real === "000000" ? "111111" : "000000";
    const result = await db.auth.verifyOtp({ email, token: wrong, type: "email" });
    expect(result.error).not.toBeNull();
    expect(result.data.session).toBeNull();
  });

  it("gives a new user an empty display name", async () => {
    const { db, userId } = await signInWithEmailCode("fresh");
    const { data, error } = await db.from("profiles").select("display_name").eq("id", userId);
    expect(error).toBeNull();
    expect(data).toEqual([{ display_name: "" }]);
  });

  it("keeps one user's trip and budget invisible to another real session", async () => {
    const alice = await signInWithEmailCode("alice");
    const bob = await signInWithEmailCode("bob");
    expect(alice.userId).not.toBe(bob.userId);

    const created = await alice.db.rpc("create_trip", { p_name: "Asia", p_base_currency: "USD" });
    expect(created.error).toBeNull();
    const tripId = created.data as string;

    const budget = await alice.db
      .from("member_budgets")
      .insert({ trip_id: tripId, user_id: alice.userId, ceiling_minor: 250000 });
    expect(budget.error).toBeNull();

    // The owner sees the trip and the budget.
    const own = await alice.db.from("member_budgets").select("ceiling_minor").eq("trip_id", tripId);
    expect(own.error).toBeNull();
    expect(own.data).toEqual([{ ceiling_minor: 250000 }]);
    const ownTrip = await alice.db.from("trips").select("id").eq("id", tripId);
    expect(ownTrip.data).toHaveLength(1);

    // The owner's band is derived from the amount, and a non-member gets no bands.
    const ownBands = await alice.db.rpc("trip_member_bands", { p_trip_id: tripId });
    expect(ownBands.error).toBeNull();
    expect(ownBands.data).toEqual([{ user_id: alice.userId, band: "2k_3k" }]);
    const outsiderBands = await bob.db.rpc("trip_member_bands", { p_trip_id: tripId });
    expect(outsiderBands.error).toBeNull();
    expect(outsiderBands.data).toEqual([]);

    // A second real user sees none of it.
    for (const table of ["member_budgets", "trips", "trip_members", "destinations"]) {
      const res = await bob.db.from(table).select("*").limit(50);
      expect(res.error, table).toBeNull();
      expect(res.data, table).toEqual([]);
    }
    const byId = await bob.db.from("member_budgets").select("*").eq("trip_id", tripId).eq("user_id", alice.userId);
    expect(byId.data).toEqual([]);
    const tripById = await bob.db.from("trips").select("*").eq("id", tripId);
    expect(tripById.data).toEqual([]);

    // And cannot write to them.
    const write = await bob.db
      .from("member_budgets")
      .insert({ trip_id: tripId, user_id: alice.userId, ceiling_minor: 1 });
    expect(write.error).not.toBeNull();
    const update = await bob.db.from("member_budgets").update({ ceiling_minor: 1 }).eq("trip_id", tripId).select();
    expect(update.data ?? []).toEqual([]);

    // Alice's budget is unchanged.
    const after = await alice.db.from("member_budgets").select("ceiling_minor").eq("trip_id", tripId);
    expect(after.data).toEqual([{ ceiling_minor: 250000 }]);
  });
});
