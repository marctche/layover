import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { loadPlan } from "./data";
import { STEPS } from "./steps";

export default function PlanIndex({ params }: PageProps<"/trips/[id]/plan">) {
  return (
    <Suspense fallback={<p className="text-sm text-zinc-600">Loading...</p>}>
      <Resume params={params} />
    </Suspense>
  );
}

/** Opens the first step that is not done yet. */
async function Resume({ params }: { params: PageProps<"/trips/[id]/plan">["params"] }): Promise<ReactNode> {
  const { id } = await params;
  const { progress } = await loadPlan(id);
  const first = STEPS.find((s) => !progress.done[s.id]) ?? STEPS[STEPS.length - 1]!;
  redirect(`/trips/${id}/plan/${first.id}`);
}
