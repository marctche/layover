import { notFound } from "next/navigation";
import { cache } from "react";
import { redirect } from "next/navigation";
import { ServiceError, createRequestServices, gateRedirect, getPlanView, getSessionState, type PlanView } from "@/server";
import { planProgress, type PlanProgress } from "./derive";

export interface PlanData {
  view: PlanView;
  userId: string;
  isCoordinator: boolean;
  progress: PlanProgress;
}

/** One load per request, shared by the layout and the step page. */
export const loadPlan = cache(async (tripId: string): Promise<PlanData> => {
  const { store } = await createRequestServices();
  const session = await getSessionState(store);
  const target = gateRedirect(session, `/trips/${encodeURIComponent(tripId)}/plan`);
  if (target) redirect(target);
  if (session.state !== "ready") throw new Error("unreachable");
  const userId = session.userId;
  let view: PlanView;
  try {
    view = await getPlanView(store, { tripId });
  } catch (error) {
    // Non-members and unknown ids look the same.
    if (error instanceof ServiceError && (error.code === "not_found" || error.code === "invalid_input")) notFound();
    throw error;
  }
  return { view, userId, isCoordinator: view.viewerRole === "coordinator", progress: planProgress(view, userId) };
});
