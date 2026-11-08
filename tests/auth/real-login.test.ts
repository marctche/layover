import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

// Signs in with real emailed codes against a local Supabase stack, then checks that row-level
// security holds for real sessions (not just for simulated roles). Needs the stack running:
//   LAYOVER_TEST_SUPABASE_URL  API URL
//   LAYOVER_TEST_SUPABASE_KEY  publishable (or anon) key
//   LAYOVER_TEST_MAILPIT_URL   optional, defaults to http://127.0.0.1:54324

function required(name: string): string {
  const value = process.env[name];
  // Fail loudly. A missing stack must never read as a pass.
  if (!value) throw new Error(`${name} is not set. These tests need a running local Supabase stack.`);
  return value;
}

const supabaseUrl = required("LAYOVER_TEST_SUPABASE_URL");
const supabaseKey = required("LAYOVER_TEST_SUPABASE_KEY");
const mailpitUrl = process.env.LAYOVER_TEST_MAILPIT_URL ?? "http://127.0.0.1:54324";

const newClient = (): SupabaseClient =>
  createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

interface MailpitSearch {
  messages?: { ID: string }[];
}
interface MailpitMessage {
  Text?: string;
  HTML?: string;
}

/** Waits for the email sent to this address and returns the 6-digit code in it. */
async function readCode(email: string): Promise<string> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const search = await fetch(`${mailpitUrl}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`);
    const found = (await search.json()) as MailpitSearch;
    const id = found.messages?.[0]?.ID;
    if (id) {
      const message = (await (await fetch(`${mailpitUrl}/api/v1/message/${id}`)).json()) as MailpitMessage;
      const code = /<strong>(\d{6})<\/strong>/.exec(message.HTML ?? "")?.[1] ?? /\b(\d{6})\b/.exec(message.Text ?? "")?.[1];
      if (code) return code;
    }
    await sleep(500);
  }
  throw new Error(`No sign-in email arrived for ${email}`);
}

/** A client holding a real session obtained with an emailed code. */
async function signInWithEmailCode(label: string): Promise<{ db: SupabaseClient; userId: string; email: string }> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const db = newClient();
  const sent = await db.auth.signInWithOtp({ email });
  expect(sent.error).toBeNull();

  const token = await readCode(email);
  const verified = await db.auth.verifyOtp({ email, token, type: "email" });
  expect(verified.error).toBeNull();
  expect(verified.data.session).not.toBeNull();
  const userId = verified.data.user?.id;
  if (!userId) throw new Error("No user after verifyOtp");
  return { db, userId, email };
}

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
