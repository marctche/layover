import { z } from "zod";
import { ServiceError } from "./errors";
import { joinWithInvite } from "./invites";
import { requireUser } from "./access";
import type { InvitePreview, Store } from "./store";

// An invite token waits in this cookie while a visitor signs in. It is never placed in a URL
// parameter or an email redirect, so it cannot leak through logs, referrers or the email.
export const PENDING_INVITE_COOKIE = "layover_pending_invite";
const ONE_HOUR_SECONDS = 60 * 60;

/** The shape of tokens the app issues: base64url, 32 to 256 characters. */
const tokenShape = z.string().regex(/^[A-Za-z0-9_-]{32,256}$/);

export function isInviteTokenShape(token: unknown): token is string {
  return tokenShape.safeParse(token).success;
}

export interface CookieSpec {
  name: string;
  value: string;
  options: {
    httpOnly: true;
    secure: boolean;
    sameSite: "lax";
    path: "/";
    maxAge: number;
  };
}

/** The cookie to set for a token, or null when the token is malformed. */
export function pendingInviteCookie(token: string, production: boolean): CookieSpec | null {
  if (!isInviteTokenShape(token)) return null;
  return {
    name: PENDING_INVITE_COOKIE,
    value: token,
    options: { httpOnly: true, secure: production, sameSite: "lax", path: "/", maxAge: ONE_HOUR_SECONDS },
  };
}

export type RedeemResult =
  | { kind: "none" }
  | { kind: "joined"; tripId: string }
  /** tripId is null only if the database did not report it. */
  | { kind: "already_member"; tripId: string | null }
  | { kind: "invalid" };

/**
 * Joins the trip named by the pending cookie, once. The caller clears the cookie whenever
 * the result is anything but "none", so a token is never tried twice.
 */
export async function redeemPendingInvite(store: Store, cookieValue: string | undefined): Promise<RedeemResult> {
  if (cookieValue === undefined) return { kind: "none" };
  if (!isInviteTokenShape(cookieValue)) return { kind: "invalid" };
  try {
    const { tripId } = await joinWithInvite(store, { token: cookieValue });
    return { kind: "joined", tripId };
  } catch (error) {
    if (!(error instanceof ServiceError)) throw error;
    if (error.code === "already_member") return { kind: "already_member", tripId: error.tripId ?? null };
    if (error.code === "invite_invalid" || error.code === "invalid_input") return { kind: "invalid" };
    throw error;
  }
}

export type ConfirmationState =
  | { kind: "none" }
  /** Show the preview and ask before joining. */
  | { kind: "confirm"; preview: InvitePreview }
  | { kind: "already_member"; tripId: string }
  | { kind: "invalid" };

/**
 * Read-only: works out what the confirmation page should show for the pending cookie.
 * It never joins a trip. Joining happens only in the confirmation action.
 */
export async function resolveInviteConfirmation(store: Store, cookieValue: string | undefined): Promise<ConfirmationState> {
  if (cookieValue === undefined) return { kind: "none" };
  await requireUser(store);
  if (!isInviteTokenShape(cookieValue)) return { kind: "invalid" };
  const memberOf = await store.getTripIfMember(cookieValue);
  if (memberOf) return { kind: "already_member", tripId: memberOf };
  const preview = await store.getInvitePreview(cookieValue);
  return preview ? { kind: "confirm", preview } : { kind: "invalid" };
}

/** Where to send the user once a join attempt (or a decline) has been handled. */
export function inviteOutcomePath(result: RedeemResult | { kind: "declined" }): string {
  switch (result.kind) {
    case "joined":
      return `/trips/${result.tripId}`;
    case "already_member":
      return result.tripId ? `/trips/${result.tripId}` : "/trips";
    case "invalid":
      return "/invite-invalid";
    default:
      return "/trips";
  }
}
