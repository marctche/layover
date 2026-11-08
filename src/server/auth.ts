import { z } from "zod";
import { ServiceError } from "./errors";
import { parseInput } from "./schemas";
import type { AuthGateway, Store } from "./store";

// A fixed stand-in origin used only to parse and compare. It is never sent anywhere.
const PARSE_ORIGIN = "https://layover.invalid";
// Control characters, any whitespace, and backslashes. Browsers strip tabs and newlines
// from URLs and treat "\" like "/", so "/\t/evil.com" would otherwise mean "//evil.com".
const UNSAFE_PATH_CHARS = /[\u0000-\u001f\u007f-\u009f\s\\]/u;
const MAX_NEXT_LENGTH = 2048;

/**
 * Accepts only same-site paths, so a redirect can never leave the site.
 * Returns the normalized path, query and hash, or "/" when the input is not acceptable.
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || next.length > MAX_NEXT_LENGTH) return "/";
  if (!next.startsWith("/") || next.startsWith("//") || UNSAFE_PATH_CHARS.test(next)) return "/";
  try {
    const url = new URL(next, PARSE_ORIGIN);
    if (url.origin !== PARSE_ORIGIN) return "/";
    const normalized = `${url.pathname}${url.search}${url.hash}`;
    // Dot segments can collapse into a protocol-relative path: "/..//evil.com" becomes "//evil.com".
    if (normalized.startsWith("//")) return "/";
    return normalized;
  } catch {
    return "/";
  }
}

// Pages that are part of the sign-in flow itself. Landing on one after signing in would loop.
function isFlowPath(pathname: string): boolean {
  return pathname === "/sign-in" || pathname === "/welcome" || pathname.startsWith("/auth/");
}

/** Where to go once the user is signed in and has a name: the requested page, or the trip list. */
export function postSignInTarget(next: string | null | undefined): string {
  const safe = safeNextPath(next);
  const pathname = safe.split(/[?#]/)[0] ?? safe;
  return safe === "/" || isFlowPath(pathname) ? "/trips" : safe;
}

const signInInput = z.object({ email: z.email().max(254), next: z.string().optional() }).strict();

/** Sends one email with a 6-digit code and a link. Says nothing about whether the address has an account. */
export async function signInWithMagicLink(
  auth: AuthGateway,
  origin: string,
  raw: unknown,
): Promise<void> {
  const { email, next } = parseInput(signInInput, raw);
  const redirectTo = `${origin}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`;
  await auth.sendMagicLink(email, redirectTo);
}

const googleInput = z.object({ next: z.string().optional() }).strict();

/** Returns the Google URL to send the browser to. */
export async function startGoogleSignIn(auth: AuthGateway, origin: string, raw: unknown): Promise<string> {
  const { next } = parseInput(googleInput, raw);
  return auth.googleSignInUrl(`${origin}/auth/callback?next=${encodeURIComponent(safeNextPath(next))}`);
}

const verifyCodeInput = z
  .object({ email: z.email().max(254), code: z.string().trim().regex(/^\d{6}$/, "Enter the 6-digit code") })
  .strict();

/** Throws unauthenticated for a wrong, expired or reused code, without saying which. */
export async function verifyEmailCode(auth: AuthGateway, raw: unknown): Promise<void> {
  const { email, code } = parseInput(verifyCodeInput, raw);
  const ok = await auth.verifyEmailCode(email, code);
  if (!ok) throw new ServiceError("unauthenticated");
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

export async function signOut(auth: AuthGateway): Promise<void> {
  await auth.signOut();
}

// Onboarding

export type SessionState =
  | { state: "signed_out" }
  | { state: "needs_name"; userId: string }
  | { state: "ready"; userId: string; displayName: string };

/** Verified with the auth server on every call. The proxy check is only a shortcut. */
export async function getSessionState(store: Store): Promise<SessionState> {
  const userId = await store.currentUserId();
  if (!userId) return { state: "signed_out" };
  const displayName = (await store.getDisplayName(userId))?.trim() ?? "";
  if (!displayName) return { state: "needs_name", userId };
  return { state: "ready", userId, displayName };
}

/**
 * The redirect a page should issue for the current state, or null to render.
 * Pages call this before showing anything that needs a signed-in user with a name.
 */
export function gateRedirect(session: SessionState, currentPath: string): string | null {
  const next = encodeURIComponent(safeNextPath(currentPath));
  if (session.state === "signed_out") return `/sign-in?next=${next}`;
  if (session.state === "needs_name") return `/welcome?next=${next}`;
  return null;
}

const displayNameInput = z
  .object({ displayName: z.string().trim().min(1, "Enter a name").max(80, "Use 80 characters or fewer") })
  .strict();

export async function setDisplayName(store: Store, raw: unknown): Promise<{ displayName: string }> {
  const { displayName } = parseInput(displayNameInput, raw);
  const userId = await store.currentUserId();
  if (!userId) throw new ServiceError("unauthenticated");
  await store.setDisplayName(userId, displayName);
  return { displayName };
}
