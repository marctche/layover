import { z } from "zod";
import { ServiceError } from "./errors";
import { parseInput } from "./schemas";
import type { AuthGateway } from "./store";

/** Accepts only same-site relative paths, so the callback cannot redirect off-site. */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return "/";
  return next;
}

const signInInput = z.object({ email: z.email().max(254), next: z.string().optional() }).strict();

export async function signInWithMagicLink(
  auth: AuthGateway,
  origin: string,
  raw: unknown,
): Promise<void> {
  const { email, next } = parseInput(signInInput, raw);
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`;
  await auth.sendMagicLink(email, redirectTo);
}

/** Exchanges the one-time code for a session. Returns the path to continue to. */
export async function completeSignIn(
  auth: AuthGateway,
  code: string | null,
  next: string | null,
): Promise<string> {
  if (!code) throw new ServiceError("invalid_input", "Missing code");
  const ok = await auth.exchangeCode(code);
  if (!ok) throw new ServiceError("unauthenticated");
  return safeNextPath(next);
}
