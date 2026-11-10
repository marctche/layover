import { computeReadiness, tripNights, type Readiness } from "@/domain";
import type { PlanView } from "@/server";
import type { StepId } from "./steps";

export interface PlanProgress {
  readiness: Readiness;
  done: Record<StepId, boolean>;
  nights: number | null;
}

/** Which steps are finished, from the saved rows. Only the viewer's own part is considered. */
export function planProgress(view: PlanView, viewerId: string): PlanProgress {
  const destinationIds = new Set(view.destinations.map((d) => d.id));
  const ratedCountByMember = view.members.map((m) => ({
    userId: m.userId,
    name: m.displayName || "Unnamed traveler",
    rated: view.preferences.filter((p) => p.userId === m.userId && destinationIds.has(p.destinationId)).length,
  }));
  const readiness = computeReadiness({
    startDate: view.trip.startDate,
    endDate: view.trip.endDate,
    departureAirport: view.constraints?.departureAirport ?? null,
    cityCount: view.destinations.length,
    ratedCountByMember,
    viewerId,
    hasMyAvailability: (view.myAvailability?.ranges.length ?? 0) > 0,
    hasMyBudget: view.myBudget !== null,
  });
  const item = (id: string) => readiness.items.find((i) => i.id === id)?.done ?? false;
  const hasRules =
    view.fixedEvents.length > 0 ||
    view.constraints?.startDestinationId != null ||
    view.constraints?.endDestinationId != null ||
    view.destinationConstraints.some((c) => c.mustInclude || c.minNights !== 1 || c.maxNights !== null);
  return {
    readiness,
    nights: tripNights(view.trip.startDate, view.trip.endDate),
    done: {
      when: item("dates"),
      from: item("airport"),
      where: item("cities"),
      rules: hasRules,
      rate: item("myRatings"),
      free: item("myAvailability"),
      budget: item("myBudget"),
      ready: readiness.blockers.length === 0,
    },
  };
}
