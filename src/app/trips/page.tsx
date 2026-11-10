import Link from "next/link";
import { Suspense } from "react";
import { signOutAction } from "@/app/actions";
import { requireReadyUser } from "@/app/_lib/request";
import { listMyTrips } from "@/server";

export const metadata = { title: "Your trips | Layover" };

export default function TripsPage() {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <Suspense fallback={<p className="text-sm text-zinc-500">Loading...</p>}>
        <Trips />
      </Suspense>
    </main>
  );
}

async function Trips() {
  const { store, displayName } = await requireReadyUser("/trips");
  const trips = await listMyTrips(store);
  return (
    <>
      <header className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">Your trips</h1>
        <form action={signOutAction}>
          <button type="submit" className="text-sm text-zinc-600 underline dark:text-zinc-400">
            Sign out
          </button>
        </form>
      </header>
      <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Signed in as {displayName}</p>
      <Link
        href="/trips/new"
        className="mt-4 inline-block rounded-md bg-zinc-900 px-4 py-2 font-medium text-white dark:bg-white dark:text-zinc-900"
      >
        New trip
      </Link>
      {trips.length === 0 ? (
        <div className="mt-8 text-zinc-600 dark:text-zinc-400">
          <p>You are not on any trips yet.</p>
          <p className="mt-2">
            <Link href="/trips/new" className="underline">
              Create a trip
            </Link>
            , or open an invite link from a friend to join one.
          </p>
        </div>
      ) : (
        <ul className="mt-6 divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
          {trips.map((trip) => (
            <li key={trip.id}>
              <Link href={`/trips/${trip.id}`} className="block px-4 py-3 hover:bg-zinc-50 dark:hover:bg-zinc-900">
                <span className="font-medium">{trip.name}</span>
                <span className="block text-sm text-zinc-600 dark:text-zinc-400">
                  {trip.role === "coordinator" ? "You are the coordinator" : "Member"}
                  {trip.startDate && trip.endDate ? ` - ${trip.startDate} to ${trip.endDate}` : ""}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
