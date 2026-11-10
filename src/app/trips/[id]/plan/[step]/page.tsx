import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { minorToMajorString } from "@/domain/money/money";
import { MAX_CANDIDATE_CITIES } from "@/domain";
import { CityCombobox } from "../city-combobox";
import { loadPlan, type PlanData } from "../data";
import {
  AddFixedEventForm,
  AirportForm,
  AvailabilityForm,
  BudgetField,
  CityRulesForm,
  DatesForm,
  EndpointsForm,
  RatingControl,
  RemoveFixedEventButton,
} from "../forms";
import { STEPS, isStepId, neighbours, type StepId } from "../steps";

const muted = "text-sm text-zinc-600 dark:text-zinc-400";

export default function StepPage({ params }: PageProps<"/trips/[id]/plan/[step]">) {
  return (
    <Suspense fallback={<p className={muted}>Loading...</p>}>
      <Step params={params} />
    </Suspense>
  );
}

async function Step({ params }: { params: PageProps<"/trips/[id]/plan/[step]">["params"] }) {
  const { id, step } = await params;
  if (!isStepId(step)) notFound();
  const plan = await loadPlan(id);
  const meta = STEPS.find((s) => s.id === step)!;
  const { back, next } = neighbours(step);
  const base = `/trips/${id}/plan`;
  const readOnly = meta.part === "shared" && !plan.isCoordinator && step !== "where";
  return (
    <section aria-labelledby="step-title">
      <h1 id="step-title" className="text-2xl font-semibold tracking-tight">{TITLES[step]}</h1>
      <p className={`mt-1 ${muted}`}>{meta.part === "shared" ? "Shared setup" : meta.part === "mine" ? "Your part" : "Check"}</p>
      {readOnly ? <p className="mt-3 rounded-md border border-zinc-300 p-3 text-sm dark:border-zinc-700">Set by the coordinator. You can see it here but only they can change it.</p> : null}
      <div className="mt-6">{renderStep(step, plan, readOnly)}</div>
      <div className="mt-8 flex items-center justify-between gap-4">
        {back ? <Link href={`${base}/${back}`} className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 px-4 font-medium focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-zinc-700">Back</Link> : <Link href={`/trips/${id}`} className="inline-flex min-h-11 items-center rounded-md border border-zinc-300 px-4 font-medium dark:border-zinc-700">Back</Link>}
        {next ? <Link href={`${base}/${next}`} className="inline-flex min-h-11 items-center rounded-md bg-zinc-900 px-4 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:bg-white dark:text-zinc-900">Next</Link> : null}
      </div>
    </section>
  );
}

const TITLES: Record<StepId, string> = {
  when: "When are you going?",
  from: "Where do you leave from?",
  where: "Which cities?",
  rules: "Rules for the route",
  rate: "How do you feel about each city?",
  free: "When are you free?",
  budget: "Your budget",
  ready: "Ready to compare routes?",
};

function Readout({ rows }: { rows: [string, ReactNode][] }) {
  return (
    <dl className="space-y-2">
      {rows.map(([k, v]) => (
        <div key={k}>
          <dt className={muted}>{k}</dt>
          <dd className="text-base">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function renderStep(step: StepId, plan: PlanData, readOnly: boolean): ReactNode {
  const { view, progress } = plan;
  const { trip, constraints, destinations, destinationConstraints, fixedEvents } = view;
  const tripId = trip.id;
  const cityOptions = destinations.map((d) => ({ id: d.id, name: d.name }));
  const nameOfCity = (cid: string) => destinations.find((d) => d.id === cid)?.name ?? "Unknown city";
  const nameOfMember = (uid: string) => view.members.find((m) => m.userId === uid)?.displayName || "Unnamed traveler";

  switch (step) {
    case "when":
      return readOnly ? (
        <Readout rows={[["Dates", trip.startDate && trip.endDate ? `${trip.startDate} to ${trip.endDate}${progress.nights !== null ? ` (${progress.nights} nights)` : ""}` : "Not set yet"]]} />
      ) : (
        <DatesForm tripId={tripId} startDate={trip.startDate ?? ""} endDate={trip.endDate ?? ""} />
      );
    case "from":
      return readOnly ? (
        <Readout rows={[["Departure airport", constraints?.departureAirport ?? "Not set yet"]]} />
      ) : (
        <AirportForm tripId={tripId} airport={constraints?.departureAirport ?? ""} />
      );
    case "where":
      return (
        <>
          {destinations.length === 0 ? (
            <p className={muted}>No cities yet. Any traveler can add some.</p>
          ) : (
            <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {destinations.map((d) => (
                <li key={d.id} className="px-4 py-3">
                  <span className="font-medium">{d.name}</span>
                  <span className={`block ${muted}`}>Added by {nameOfMember(d.suggestedBy)}</span>
                </li>
              ))}
            </ul>
          )}
          <CityCombobox tripId={tripId} existingNames={destinations.map((d) => d.name)} max={MAX_CANDIDATE_CITIES} />
          <p className={`mt-3 ${muted}`}>Cities cannot be removed yet.</p>
        </>
      );
    case "rules":
      return (
        <div className="space-y-8">
          {destinations.length === 0 ? <p className={muted}>Add cities in the Where step first.</p> : null}
          {readOnly ? (
            <Readout
              rows={[
                ["Start city", constraints?.startDestinationId ? nameOfCity(constraints.startDestinationId) : "No preference"],
                ["End city", constraints?.endDestinationId ? nameOfCity(constraints.endDestinationId) : "No preference"],
                ...destinations.map((d): [string, ReactNode] => {
                  const c = destinationConstraints.find((x) => x.destinationId === d.id);
                  return [d.name, `${c?.mustInclude ? "Must visit. " : ""}${c?.minNights ?? 1} to ${c?.maxNights ?? "any number of"} nights`];
                }),
              ]}
            />
          ) : (
            <>
              {destinations.length > 0 ? <EndpointsForm tripId={tripId} cities={cityOptions} start={constraints?.startDestinationId ?? ""} end={constraints?.endDestinationId ?? ""} /> : null}
              {destinations.map((d) => {
                const c = destinationConstraints.find((x) => x.destinationId === d.id);
                return <CityRulesForm key={d.id} tripId={tripId} destinationId={d.id} name={d.name} mustInclude={c?.mustInclude ?? false} minNights={c?.minNights ?? 1} maxNights={c?.maxNights ?? null} />;
              })}
            </>
          )}
          <div>
            <h2 className="text-lg font-semibold">Fixed events</h2>
            {fixedEvents.length === 0 ? <p className={muted}>None yet.</p> : (
              <ul className="mt-2 divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {fixedEvents.map((e) => (
                  <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-3">
                    <span>
                      <span className="font-medium">{e.label}</span>
                      <span className={`block ${muted}`}>{nameOfCity(e.destinationId)}, {e.startDate} to {e.endDate}</span>
                    </span>
                    {readOnly ? null : <RemoveFixedEventButton tripId={tripId} eventId={e.id} label={e.label} />}
                  </li>
                ))}
              </ul>
            )}
            {readOnly ? null : <AddFixedEventForm tripId={tripId} cities={cityOptions} />}
          </div>
        </div>
      );
    case "rate": {
      if (destinations.length === 0) return <p className={muted}>No cities to rate yet. Add some in the Where step.</p>;
      return (
        <div className="space-y-6">
          {destinations.map((d) => (
            <RatingControl key={d.id} tripId={tripId} destinationId={d.id} name={d.name} current={view.preferences.find((p) => p.destinationId === d.id && p.userId === plan.userId)?.score ?? null} />
          ))}
          <p className={muted}>This is a wish, not a rule. Rules such as must-visit are set by the coordinator.</p>
        </div>
      );
    }
    case "free":
      return <AvailabilityForm tripId={tripId} ranges={view.myAvailability?.ranges ?? []} flexibilityDays={view.myAvailability?.flexibilityDays ?? 0} />;
    case "budget":
      return (
        <>
          <p className="flex items-center gap-2 font-medium">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="2"><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" /></svg>
            Only you can see this
          </p>
          <p className={`mt-1 mb-4 ${muted}`}>Other travelers and the coordinator cannot read your number.</p>
          <BudgetField tripId={tripId} currency={trip.baseCurrency} defaultValue={view.myBudget ? minorToMajorString(view.myBudget.ceilingMinor, view.myBudget.currency) : ""} />
        </>
      );
    case "ready": {
      const { readiness } = progress;
      return (
        <div className="space-y-6">
          <ul className="divide-y divide-zinc-200 rounded-md border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {readiness.items.map((i) => (
              <li key={i.id} className="flex items-start gap-3 px-4 py-3">
                <span aria-hidden="true" className="mt-0.5">{i.done ? "✓" : "○"}</span>
                <span className="flex-1">
                  <span className="font-medium">{i.label}</span>
                  <span className="sr-only">{i.done ? " (done)" : " (not done)"}</span>
                  <span className={`block ${muted}`}>{i.detail}</span>
                </span>
                {i.done ? null : <Link href={`/trips/${tripId}/plan/${i.step}`} className="inline-flex min-h-11 items-center text-sm underline">Fix</Link>}
              </li>
            ))}
          </ul>
          <div>
            <h2 className="text-lg font-semibold">Ratings so far</h2>
            <ul className="mt-2 space-y-1">
              {readiness.members.map((m) => (
                <li key={m.userId}>{m.name}: {m.complete ? "rated every city" : `${m.rated} of ${m.total} cities rated`}</li>
              ))}
            </ul>
          </div>
          <div>
            <button type="button" disabled aria-describedby="compare-reasons" className="min-h-11 rounded-md bg-zinc-900 px-4 py-2 font-medium text-white opacity-50 dark:bg-white dark:text-zinc-900">
              Compare routes
            </button>
            <div id="compare-reasons" className={`mt-2 ${muted}`}>
              {readiness.blockers.length > 0 ? (
                <>
                  <p>Not yet, because:</p>
                  <ul className="list-disc pl-5">{readiness.blockers.map((b) => <li key={b}>{b}</li>)}</ul>
                </>
              ) : (
                <p>Everything needed is in. Running routes from this page is not built yet.</p>
              )}
            </div>
          </div>
        </div>
      );
    }
  }
}
