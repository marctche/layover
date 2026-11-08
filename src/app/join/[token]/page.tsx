import { redirect } from "next/navigation";
import { Suspense } from "react";
import { InviteProblem } from "@/app/_components/invite-problem";
import { SignInOptions } from "@/app/_components/sign-in-options";
import { createRequestServices, getSessionState, previewInvite } from "@/server";

export const metadata = { title: "Join a trip | Layover" };

export default function JoinPage({ params }: PageProps<"/join/[token]">) {
  return (
    <Suspense fallback={<main className="mx-auto w-full max-w-sm px-4 py-16 text-sm text-zinc-500">Loading...</main>}>
      <Join params={params} />
    </Suspense>
  );
}

async function Join({ params }: { params: PageProps<"/join/[token]">["params"] }) {
  const { token } = await params;
  const { store } = await createRequestServices();

  // The proxy has already stored the token in the pending-invite cookie. Someone who is
  // signed in goes straight to the step that joins the trip.
  if ((await getSessionState(store)).state !== "signed_out") redirect("/auth/continue");

  const preview = await previewInvite(store, { token });
  if (!preview) return <InviteProblem />;

  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {preview.inviterName ? `${preview.inviterName} invited you to` : "You are invited to"}
      </p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{preview.tripName}</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        {preview.memberCount} {preview.memberCount === 1 ? "person is" : "people are"} planning this trip.
      </p>
      <div className="mt-8">
        <p className="mb-3 text-sm font-medium">Sign in to join</p>
        <SignInOptions next="/trips" />
      </div>
    </main>
  );
}
