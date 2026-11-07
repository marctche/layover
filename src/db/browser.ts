import { createBrowserClient } from "@supabase/ssr";
import { supabaseEnv } from "./env";

export function createBrowserDb() {
  const { url, publishableKey } = supabaseEnv();
  return createBrowserClient(url, publishableKey);
}
