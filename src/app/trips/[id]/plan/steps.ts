export const STEPS = [
  { id: "when", label: "When", part: "shared" },
  { id: "from", label: "From where", part: "shared" },
  { id: "where", label: "Where", part: "shared" },
  { id: "rules", label: "Rules", part: "shared" },
  { id: "rate", label: "Rate cities", part: "mine" },
  { id: "free", label: "When I'm free", part: "mine" },
  { id: "budget", label: "My budget", part: "mine" },
  { id: "ready", label: "Ready check", part: "check" },
] as const;

export type StepId = (typeof STEPS)[number]["id"];

export function isStepId(value: string): value is StepId {
  return STEPS.some((s) => s.id === value);
}

export function neighbours(step: StepId): { back: StepId | null; next: StepId | null } {
  const i = STEPS.findIndex((s) => s.id === step);
  return { back: STEPS[i - 1]?.id ?? null, next: STEPS[i + 1]?.id ?? null };
}
