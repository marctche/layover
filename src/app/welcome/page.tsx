import { redirect } from "next/navigation";
import { Suspense } from "react";
import { firstParam } from "@/app/_lib/request";
import { createRequestServices, getSessionState, postSignInTarget } from "@/server";
import { NameForm } from "./name-form";

export const metadata = { title: "Welcome | Layover" };

export default function WelcomePage({ searchParams }: PageProps<"/welcome">) {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Welcome to Layover</h1>
      <div className="mt-8">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading...</p>}>
          <WelcomeContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function WelcomeContent({ searchParams }: { searchParams: PageProps<"/welcome">["searchParams"] }) {
  const params = await searchParams;
  const next = postSignInTarget(firstParam(params.next));
  const { store } = await createRequestServices();
  // Checked on the server: signed-out visitors sign in first, and people who already
  // have a name have nothing to do here.
  const session = await getSessionState(store);
  if (session.state === "signed_out") redirect(`/sign-in?next=${encodeURIComponent(next)}`);
  if (session.state === "ready") redirect(`/auth/continue?next=${encodeURIComponent(next)}`);
  return <NameForm next={next} />;
}
