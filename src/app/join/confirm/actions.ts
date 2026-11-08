"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import {
  PENDING_INVITE_COOKIE,
  createRequestServices,
  inviteOutcomePath,
  redeemPendingInvite,
  ServiceError,
} from "@/server";

async function clearPendingInvite(): Promise<void> {
  const jar = await cookies();
  jar.set(PENDING_INVITE_COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
}

/** The only place a pending invite is redeemed: a POST the user submits on the confirmation page. */
export async function joinTripAction(): Promise<void> {
  const jar = await cookies();
  const pending = jar.get(PENDING_INVITE_COOKIE)?.value;
  let destination: string;
  try {
    const { store } = await createRequestServices();
    destination = inviteOutcomePath(await redeemPendingInvite(store, pending));
  } catch (error) {
    if (error instanceof ServiceError && error.code === "unauthenticated") redirect("/sign-in");
    throw error;
  }
  // The token is tried once, whatever the outcome.
  await clearPendingInvite();
  redirect(destination);
}

/** "Not now": forgets the invite without joining. */
export async function declineInviteAction(): Promise<void> {
  await clearPendingInvite();
  redirect(inviteOutcomePath({ kind: "declined" }));
}
