import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { requireReadyUser } from "@/app/_lib/request";
import { PENDING_INVITE_COOKIE, resolveInviteConfirmation } from "@/server";
import { declineInviteAction, joinTripAction } from "./actions";

export const metadata = { title: "Join a trip | Layover" };

export default function ConfirmJoinPage() {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading...</p>}>
        <Confirm />
      </Suspense>
    </main>
  );
}

// Rendering only looks: nothing here joins a trip. The buttons post to server actions.
async function Confirm() {
  const { store } = await requireReadyUser("/join/confirm");
  const pending = (await cookies()).get(PENDING_INVITE_COOKIE)?.value;
  const state = await resolveInviteConfirmation(store, pending);
  // Nothing to confirm (no invite, already a member, or a dead link): /auth/continue handles each.
  if (state.kind !== "confirm") redirect("/auth/continue");
  const { preview } = state;
  return (
    <>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {preview.inviterName ? `${preview.inviterName} invited you to` : "You are invited to"}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{preview.tripName}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {preview.memberCount} {preview.memberCount === 1 ? "person is" : "people are"} planning this trip. Joining
        shares your name with them.
      </p>
      <div className="mt-8 space-y-3">
        <form action={joinTripAction}>
          <button
            type="submit"
            className="w-full rounded-md bg-zinc-900 px-4 py-3 font-medium text-white dark:bg-white dark:text-zinc-900"
          >
            Join trip
          </button>
        </form>
        <form action={declineInviteAction} className="text-center">
          <button type="submit" className="text-sm text-zinc-600 underline dark:text-zinc-400">
            Not now
          </button>
        </form>
      </div>
    </>
  );
}
