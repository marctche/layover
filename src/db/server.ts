import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { supabaseEnv } from "./env";

// A client acting as the signed-in user: publishable key plus the session cookie.
// Row-level security applies to everything it does. The secret key is deliberately
// not used anywhere, because it would bypass row-level security.
export async function createServerDb() {
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
