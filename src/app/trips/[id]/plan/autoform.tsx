"use client";

import { startTransition, useActionState, useRef, type ReactNode } from "react";
import { initialFormState, type FormState } from "@/app/_lib/form-state";

export const inputClass =
  "min-h-11 w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-base focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-60 dark:border-zinc-700";
export const labelClass = "block text-sm font-medium";
export const mutedClass = "text-sm text-zinc-600 dark:text-zinc-400";

export function SaveStatus({ state, pending }: { state: FormState; pending: boolean }) {
  return (
    <p aria-live="polite" className={`min-h-5 text-sm ${state.error ? "text-red-700 dark:text-red-400" : "text-zinc-600 dark:text-zinc-400"}`}>
      {pending ? "Saving..." : state.error ? <span role="alert">{state.error}</span> : state.ok ? "Saved" : ""}
    </p>
  );
}

/**
 * A form that saves by itself. Pickers, selects, checkboxes and radios save on change; text
 * and number fields save when they lose focus. The form is not reset after a save, so an input
 * that failed validation keeps what the person typed next to the error.
 */
export function AutoForm({
  action,
  hidden,
  canSubmit,
  children,
  className,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  /** Return false to hold the save, for example while only one of two dates is filled in. */
  canSubmit?: (data: FormData) => boolean;
  children: (status: ReactNode) => ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, initialFormState);
  const ref = useRef<HTMLFormElement>(null);
  const dirty = useRef(false);

  function save() {
    const form = ref.current;
    if (!form || !dirty.current) return;
    if (canSubmit && !canSubmit(new FormData(form))) return;
    dirty.current = false;
    form.requestSubmit();
  }

  return (
    <form
      ref={ref}
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(data));
      }}
      onChange={(event) => {
        dirty.current = true;
        const target = event.target;
        const typed = target instanceof HTMLInputElement && ["text", "number", "tel", "search"].includes(target.type);
        if (!typed) save();
      }}
      onBlur={save}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children(<SaveStatus state={state} pending={pending} />)}
    </form>
  );
}

/** A form with an explicit submit button, for adding things. */
export function ActionForm({
  action,
  hidden,
  children,
  className,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  hidden: Record<string, string>;
  children: (status: ReactNode, pending: boolean) => ReactNode;
  className?: string;
}) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(action, initialFormState);
  return (
    <form
      className={className}
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget, (event.nativeEvent as SubmitEvent).submitter);
        startTransition(() => formAction(data));
      }}
    >
      {Object.entries(hidden).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {children(<SaveStatus state={state} pending={pending} />, pending)}
    </form>
  );
}
