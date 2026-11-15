import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { readCode } from "../helpers/mailpit";

export { readCode };

// Shared by the real-login tests. Needs the local Supabase stack running:
//   LAYOVER_TEST_SUPABASE_URL  API URL
//   LAYOVER_TEST_SUPABASE_KEY  publishable (or anon) key
//   LAYOVER_TEST_MAILPIT_URL   optional, defaults to http://127.0.0.1:54324 (see ../helpers/mailpit.ts)

function required(name: string): string {
  const value = process.env[name];
  // Fail loudly. A missing stack must never read as a pass.
  if (!value) throw new Error(`${name} is not set. These tests need a running local Supabase stack.`);
  return value;
}

const supabaseUrl = required("LAYOVER_TEST_SUPABASE_URL");
const supabaseKey = required("LAYOVER_TEST_SUPABASE_KEY");

/** A client with no session. */
export const newClient = (): SupabaseClient =>
  createClient(supabaseUrl, supabaseKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

export interface TestUser {
  db: SupabaseClient;
  userId: string;
  email: string;
}

/** A client holding a real session obtained with an emailed code. */
export async function signInWithEmailCode(label: string): Promise<TestUser> {
  const email = `${label}-${randomUUID().slice(0, 8)}@example.test`;
  const db = newClient();
  const sent = await db.auth.signInWithOtp({ email });
  if (sent.error) throw new Error(`signInWithOtp failed: ${sent.error.message}`);

  const token = await readCode(email);
  const verified = await db.auth.verifyOtp({ email, token, type: "email" });
  if (verified.error || !verified.data.session) throw new Error(`verifyOtp failed: ${verified.error?.message}`);
  const userId = verified.data.user?.id;
  if (!userId) throw new Error("No user after verifyOtp");
  return { db, userId, email };
}
