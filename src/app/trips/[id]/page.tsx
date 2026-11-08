import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireReadyUser } from "@/app/_lib/request";
import { getTrip, ServiceError } from "@/server";

export const metadata = { title: "Trip | Layover" };

export default function TripPage({ params }: PageProps<"/trips/[id]">) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <Link href="/trips" className="text-sm text-zinc-600 underline dark:text-zinc-400">
        All trips
      </Link>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading...</p>}>
        <Trip params={params} />
      </Suspense>
    </main>
  );
}

async function Trip({ params }: { params: PageProps<"/trips/[id]">["params"] }) {
  const { id } = await params;
  const { store } = await requireReadyUser(`/trips/${encodeURIComponent(id)}`);
  let view;
  try {
    view = await getTrip(store, { tripId: id });
  } catch (error) {
    // Non-members and unknown ids look the same.
    if (error instanceof ServiceError && (error.code === "not_found" || error.code === "invalid_input")) notFound();
    throw error;
  }
  return (
    <>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{view.trip.name}</h1>
      <h2 className="mt-8 text-sm font-medium text-zinc-600 dark:text-zinc-400">
        Members ({view.members.length})
      </h2>
      <ul className="mt-2 divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
        {view.members.map((member) => (
          <li key={member.userId} className="flex items-center justify-between px-4 py-3">
            <span>{member.displayName || "Unnamed traveler"}</span>
            {member.role === "coordinator" ? (
              <span className="text-sm text-zinc-600 dark:text-zinc-400">Coordinator</span>
            ) : null}
          </li>
        ))}
      </ul>
    </>
  );
}
