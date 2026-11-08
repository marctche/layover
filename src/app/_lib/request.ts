import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { createRequestServices, gateRedirect, getSessionState, type Store } from "@/server";

/** The public origin of this request, used to build auth redirect URLs. */
export async function requestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const forwarded = h.get("x-forwarded-proto");
  const local = host.startsWith("localhost") || host.startsWith("127.");
  const proto = forwarded ? (forwarded.split(",")[0] ?? "https").trim() : local ? "http" : "https";
  return `${proto}://${host}`;
}

/**
 * Verifies the user with the auth server and redirects to sign-in or onboarding when needed.
 * Every protected page calls this; the proxy is only an optimistic first check.
 */
export async function requireReadyUser(currentPath: string): Promise<{ store: Store; userId: string; displayName: string }> {
  const { store } = await createRequestServices();
  const session = await getSessionState(store);
  const target = gateRedirect(session, currentPath);
  if (target) redirect(target);
  if (session.state !== "ready") throw new Error("unreachable");
  return { store, userId: session.userId, displayName: session.displayName };
}

/** Reads a single string search parameter. */
export function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
