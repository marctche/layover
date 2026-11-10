import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { connection } from "next/server";
import { supabaseEnv } from "./env";

// A client acting as the signed-in user: publishable key plus the session cookie.
// Row-level security applies to everything it does. The secret key is deliberately
// not used anywhere, because it would bypass row-level security.
//
// Every caller reads per-user data, so this opts out of prerendering first: supabase-js reads
// Date.now() to check token expiry, and Cache Components rejects a time read before a dynamic access.
export async function createServerDb() {
  await connection();
  const cookieStore = await cookies();
  const { url, publishableKey } = supabaseEnv();
  return createServerClient(url, publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (items) => {
        try {
          for (const { name, value, options } of items) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
        }
      },
    },
  });
}

export type Db = Awaited<ReturnType<typeof createServerDb>>;
