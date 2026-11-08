import { redirect } from "next/navigation";
import { Suspense } from "react";
import { SignInOptions } from "@/app/_components/sign-in-options";
import { firstParam } from "@/app/_lib/request";
import { createRequestServices, getSessionState, safeNextPath } from "@/server";

export const metadata = { title: "Sign in | Layover" };

const ERRORS: Record<string, string> = {
  link: "That sign-in link did not work. Request a new one.",
  google: "Google sign-in is not available right now. Try email instead.",
};

export default function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Sign in to Layover</h1>
      <p className="mt-2 text-zinc-600 dark:text-zinc-400">Plan trips with your group.</p>
      <div className="mt-8">
        <Suspense fallback={<p className="text-sm text-zinc-500">Loading...</p>}>
          <SignInContent searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function SignInContent({ searchParams }: { searchParams: PageProps<"/sign-in">["searchParams"] }) {
  const params = await searchParams;
  const next = safeNextPath(firstParam(params.next));
  const { store } = await createRequestServices();
  if ((await getSessionState(store)).state !== "signed_out") {
    redirect(`/auth/continue?next=${encodeURIComponent(next)}`);
  }
  const error = ERRORS[firstParam(params.error) ?? ""];
  return <SignInOptions next={next} error={error} />;
}
