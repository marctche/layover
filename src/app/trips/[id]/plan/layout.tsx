import Link from "next/link";
import { Suspense, type ReactNode } from "react";
import { STEPS } from "./steps";
import { loadPlan } from "./data";
import { StepRail } from "./step-rail";

export const metadata = { title: "Plan | Layover" };

export default function PlanLayout({ children, params }: LayoutProps<"/trips/[id]/plan"> & { children: ReactNode }) {
  return (
    <main className="mx-auto w-full max-w-5xl px-4 py-8">
      <Suspense fallback={<p className="text-sm text-zinc-600">Loading...</p>}>
        <Shell params={params}>{children}</Shell>
      </Suspense>
    </main>
  );
}

async function Shell({ params, children }: { params: LayoutProps<"/trips/[id]/plan">["params"]; children: ReactNode }) {
  const { id } = await params;
  const { view, progress } = await loadPlan(id);
  const { trip, constraints, destinations } = view;
  const left = STEPS.filter((s) => s.id !== "ready" && !progress.done[s.id]).length;
  return (
    <>
      <Link href={`/trips/${trip.id}`} className="text-sm text-zinc-600 underline dark:text-zinc-400">
        Back to {trip.name}
      </Link>
      <div className="mt-4 grid gap-6 lg:grid-cols-[14rem_1fr]">
        <aside className="space-y-4">
          <StepRail tripId={trip.id} done={progress.done} />
          <details className="rounded-md border border-zinc-200 p-3 lg:open:block dark:border-zinc-800" open>
            <summary className="min-h-11 cursor-pointer text-sm font-semibold">Trip so far</summary>
            <dl className="mt-2 space-y-2 text-sm">
              <div>
                <dt className="text-zinc-600 dark:text-zinc-400">Dates</dt>
                <dd>
                  {trip.startDate && trip.endDate ? `${trip.startDate} to ${trip.endDate}` : "Not set"}
                  {progress.nights !== null ? ` (${progress.nights} nights)` : ""}
                </dd>
              </div>
              <div>
                <dt className="text-zinc-600 dark:text-zinc-400">From</dt>
                <dd>{constraints?.departureAirport ?? "Not set"}</dd>
              </div>
              <div>
                <dt className="text-zinc-600 dark:text-zinc-400">Cities ({destinations.length} of 8)</dt>
                <dd>{destinations.length === 0 ? "None yet" : destinations.map((d) => d.name).join("; ")}</dd>
              </div>
              <p className="text-zinc-600 dark:text-zinc-400">{left === 0 ? "Everything is filled in." : `${left} step${left === 1 ? "" : "s"} not done yet.`}</p>
            </dl>
          </details>
        </aside>
        <div>{children}</div>
      </div>
    </>
  );
}
