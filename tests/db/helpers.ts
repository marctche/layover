import { createHash, randomBytes, randomUUID } from "node:crypto";
import { Client } from "pg";

export function dbUrl(): string {
  const url = process.env.LAYOVER_TEST_DB_URL;
  if (!url) {
    // Fail loudly. A missing database must never read as a pass.
    throw new Error("LAYOVER_TEST_DB_URL is not set. These tests need a database with the migrations applied.");
  }
  return url;
}

export async function connect(): Promise<Client> {
  const client = new Client({ connectionString: dbUrl() });
  await client.connect();
  return client;
}

/** Act as a signed-in user for the rest of the current transaction. */
export async function asUser(c: Client, userId: string): Promise<void> {
  await c.query("reset role");
  await c.query("set local role authenticated");
  await c.query("select set_config('request.jwt.claim.sub', $1, true)", [userId]);
  await c.query("select set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: userId, role: "authenticated" }),
  ]);
}

export async function asAnon(c: Client): Promise<void> {
  await c.query("reset role");
  await c.query("set local role anon");
  await c.query("select set_config('request.jwt.claim.sub', '', true)");
  await c.query("select set_config('request.jwt.claims', '', true)");
}

export async function asAdmin(c: Client): Promise<void> {
  await c.query("reset role");
}

/** Run a statement that is expected to fail without aborting the surrounding transaction. */
export async function attempt(c: Client, text: string, values: unknown[] = []): Promise<{ error?: { code?: string; message: string }; rowCount: number }> {
  await c.query("savepoint attempt");
  try {
    const res = await c.query(text, values);
    await c.query("release savepoint attempt");
    return { rowCount: res.rowCount ?? 0 };
  } catch (e) {
    await c.query("rollback to savepoint attempt");
    return { error: e as { code?: string; message: string }, rowCount: 0 };
  }
}

export async function createUser(c: Client, name: string): Promise<string> {
  const id = randomUUID();
  await c.query("insert into auth.users (id, email) values ($1, $2)", [id, `${name}-${id.slice(0, 8)}@example.test`]);
  return id;
}

export const sha256Hex = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");
export const newToken = () => randomBytes(32).toString("base64url");

/** A trip created through the real function: coordinator plus two joined members and one outsider. */
export interface Scene {
  tripId: string;
  coordinator: string;
  bob: string;
  carol: string;
  outsider: string;
}

export async function createTripAs(c: Client, userId: string, name = "Asia"): Promise<string> {
  await asUser(c, userId);
  const res = await c.query("select public.create_trip($1, 'USD') as id", [name]);
  return res.rows[0].id as string;
}

/** The coordinator inserts an invitation through the same policies the app uses. Returns the token. */
export async function inviteAs(c: Client, coordinator: string, tripId: string, days = 14): Promise<string> {
  await asUser(c, coordinator);
  const token = newToken();
  await c.query(
    "insert into public.invitations (trip_id, token_hash, created_by, expires_at) values ($1, $2, $3, now() + make_interval(days => $4))",
    [tripId, sha256Hex(token), coordinator, days],
  );
  return token;
}

export async function joinAs(c: Client, userId: string, token: string): Promise<string> {
  await asUser(c, userId);
  const res = await c.query("select public.join_with_invite($1) as id", [token]);
  return res.rows[0].id as string;
}

export async function scene(c: Client): Promise<Scene> {
  await asAdmin(c);
  const coordinator = await createUser(c, "coord");
  const bob = await createUser(c, "bob");
  const carol = await createUser(c, "carol");
  const outsider = await createUser(c, "outsider");
  const tripId = await createTripAs(c, coordinator);
  await joinAs(c, bob, await inviteAs(c, coordinator, tripId));
  await joinAs(c, carol, await inviteAs(c, coordinator, tripId));
  await asAdmin(c);
  return { tripId, coordinator, bob, carol, outsider };
}
