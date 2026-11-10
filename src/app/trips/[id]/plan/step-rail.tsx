"use client";

import Link from "next/link";
import { useSelectedLayoutSegment } from "next/navigation";
import { STEPS, type StepId } from "./steps";

const PART_LABEL = { shared: "Shared setup", mine: "My part", check: "Check" } as const;

export function StepRail({ tripId, done }: { tripId: string; done: Record<StepId, boolean> }) {
  const current = useSelectedLayoutSegment();
  return (
    <nav aria-label="Planning steps">
      <ol className="flex flex-wrap gap-2 lg:flex-col">
        {STEPS.map((step, i) => {
          const isCurrent = current === step.id;
          const isDone = done[step.id];
          const showPart = i === 0 || STEPS[i - 1]?.part !== step.part;
          return (
            <li key={step.id} className="contents lg:block">
              {showPart ? <p className="hidden pt-2 text-xs font-semibold uppercase tracking-wide text-zinc-600 lg:block dark:text-zinc-400">{PART_LABEL[step.part]}</p> : null}
              <Link
                href={`/trips/${tripId}/plan/${step.id}`}
                aria-current={isCurrent ? "step" : undefined}
                className={`flex min-h-11 items-center gap-2 rounded-md border px-3 py-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                  isCurrent ? "border-zinc-900 bg-zinc-900 font-semibold text-white dark:border-white dark:bg-white dark:text-zinc-900" : "border-zinc-300 dark:border-zinc-700"
                }`}
              >
                <span aria-hidden="true">{isDone ? "✓" : "○"}</span>
                <span>{step.label}</span>
                <span className="sr-only">{isDone ? "(done)" : "(not done yet)"}</span>
              </Link>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
