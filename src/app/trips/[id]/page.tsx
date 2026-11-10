import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { requireReadyUser } from "@/app/_lib/request";
import { minorToMajorString } from "@/domain/money/money";
import { getTrip, listInvites, ServiceError, type TripView } from "@/server";
import {
  AddCityForm,
  BudgetForm,
  CreateInviteForm,
  RemoveMemberButton,
  RevokeInviteButton,
  SCORE_LABELS,
  ScoreControl,
} from "./forms";

export const metadata = { title: "Trip | Layover" };

const sectionHeading = "text-lg font-semibold tracking-tight";
const list =
  "mt-2 divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800";
const muted = "text-sm text-zinc-600 dark:text-zinc-400";

export default function TripPage({ params }: PageProps<"/trips/[id]">) {
  return (
    <main className="mx-auto w-full max-w-md px-4 py-10">
      <Link href="/trips" className={`${muted} underline`}>
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
  const { store, userId } = await requireReadyUser(`/trips/${encodeURIComponent(id)}`);
  let view: TripView;
  try {
    view = await getTrip(store, { tripId: id });
  } catch (error) {
    // Non-members and unknown ids look the same.
    if (error instanceof ServiceError && (error.code === "not_found" || error.code === "invalid_input")) notFound();
    throw error;
  }
  const { trip, viewerRole, members, destinations, preferences, myBudget } = view;
  const isCoordinator = viewerRole === "coordinator";
  const nameOf = (uid: string) => members.find((m) => m.userId === uid)?.displayName || "Unnamed traveler";

  // Only the coordinator can read invitations. Hashes and tokens are never loaded.
  const invites = isCoordinator ? await listInvites(store, { tripId: trip.id }) : [];
  const now = new Date();
  const activeInvites = invites.filter((i) => i.revokedAt === null && new Date(i.expiresAt) > now);

  return (
    <>
      <header className="mt-4">
        <h1 className="text-2xl font-semibold tracking-tight">{trip.name}</h1>
        <p className={`mt-1 ${muted}`}>
          {trip.startDate && trip.endDate ? `${trip.startDate} to ${trip.endDate}` : "Dates not set"}
          {" - "}
          {isCoordinator ? "You are the coordinator" : "You are a member"}
        </p>
      </header>

      <section aria-labelledby="destinations-heading" className="mt-8">
        <h2 id="destinations-heading" className={sectionHeading}>
          Destinations
        </h2>
        {destinations.length === 0 ? (
          <p className={`mt-2 ${muted}`}>No cities yet. Add the first one below.</p>
        ) : (
          <ul className={list}>
            {destinations.map((d) => {
              const scores = preferences.filter((p) => p.destinationId === d.id);
              const mine = scores.find((p) => p.userId === userId)?.score ?? null;
              const others = scores.filter((p) => p.userId !== userId);
              return (
                <li key={d.id} className="space-y-2 px-4 py-3">
                  <div>
                    <span className="font-medium">{d.name}</span>
                    <span className={`block ${muted}`}>Suggested by {nameOf(d.suggestedBy)}</span>
                  </div>
                  <ScoreControl tripId={trip.id} destinationId={d.id} destinationName={d.name} current={mine} />
                  {others.length > 0 ? (
                    <ul className={muted}>
                      {others.map((p) => (
                        <li key={p.userId}>
                          {nameOf(p.userId)}: {SCORE_LABELS[p.score] ?? p.score}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
        <AddCityForm tripId={trip.id} />
      </section>

      <section aria-labelledby="budget-heading" className="mt-8">
        <h2 id="budget-heading" className={sectionHeading}>
          Your budget
        </h2>
        <p className={`mt-1 ${muted}`}>Only you can see this.</p>
        <BudgetForm
          tripId={trip.id}
          currency={trip.baseCurrency}
          defaultValue={myBudget ? minorToMajorString(myBudget.ceilingMinor, trip.baseCurrency) : ""}
        />
      </section>

      <section aria-labelledby="group-heading" className="mt-8">
        <h2 id="group-heading" className={sectionHeading}>
          Group ({members.length})
        </h2>
        <ul className={list}>
          {members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-3 px-4 py-3">
              <span>{m.displayName || "Unnamed traveler"}</span>
              {m.role === "coordinator" ? (
                <span className={muted}>Coordinator</span>
              ) : isCoordinator ? (
                <RemoveMemberButton
                  tripId={trip.id}
                  userId={m.userId}
                  name={m.displayName || "Unnamed traveler"}
                />
              ) : null}
            </li>
          ))}
        </ul>

        {isCoordinator ? (
          <div className="mt-6">
            <h3 className="font-medium">Invite links</h3>
            <div className="mt-2">
              <CreateInviteForm tripId={trip.id} />
            </div>
            {activeInvites.length > 0 ? (
              <ul className={list}>
                {activeInvites.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span className={muted}>Active until {i.expiresAt.slice(0, 10)}</span>
                    <RevokeInviteButton tripId={trip.id} inviteId={i.id} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className={`mt-2 ${muted}`}>No active invite links.</p>
            )}
          </div>
        ) : null}
      </section>

      <p className={`mt-10 ${muted}`}>Compare routes comes next.</p>
    </>
  );
}
