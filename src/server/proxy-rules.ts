import { safeNextPath } from "./auth";

// Paths a signed-out visitor may open. Everything else redirects to /sign-in.
// /auth/continue is public so it can decide between sign-in, onboarding and the invite itself.
const PUBLIC_EXACT = new Set(["/", "/sign-in", "/auth/callback", "/auth/continue", "/invite-invalid"]);

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_EXACT.has(pathname) || pathname.startsWith("/join/");
}

/** The sign-in URL (path and query) for a signed-out visitor who asked for this page. */
export function signInRedirect(pathname: string, search: string): string {
  const next = safeNextPath(`${pathname}${search}`);
  return `/sign-in?next=${encodeURIComponent(next)}`;
}

/** The token in /join/<token>, or null for any other path. */
export function joinTokenFromPath(pathname: string): string | null {
  const match = /^\/join\/([^/]+)\/?$/.exec(pathname);
  return match?.[1] ?? null;
}
