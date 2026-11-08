import Link from "next/link";

/** The same message for every unusable link, so it reveals nothing about why. */
export function InviteProblem() {
  return (
    <main className="mx-auto w-full max-w-sm px-4 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">This invite does not work</h1>
      <p className="mt-3 text-zinc-600 dark:text-zinc-400">
        This invite link has expired or was turned off. Ask the person who sent it for a new one.
      </p>
      <Link href="/" className="mt-6 inline-block text-sm text-zinc-600 underline dark:text-zinc-400">
        Back to Layover
      </Link>
    </main>
  );
}
