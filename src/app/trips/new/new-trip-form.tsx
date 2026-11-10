"use client";

import { useActionState } from "react";
import { initialFormState, type FormState } from "@/app/_lib/form-state";
import { createTripAction } from "@/app/trips/actions";

const inputClass =
  "w-full rounded-md border border-zinc-300 bg-transparent px-3 py-2 text-base dark:border-zinc-700";

export function NewTripForm() {
  const [state, action, pending] = useActionState<FormState, FormData>(createTripAction, initialFormState);
  return (
    <form action={action} className="mt-6 space-y-4">
      <div>
        <label htmlFor="name" className="block text-sm font-medium">
          Trip name
        </label>
        <input id="name" name="name" required maxLength={120} className={inputClass} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="startDate" className="block text-sm font-medium">
            Start date (optional)
          </label>
          <input id="startDate" name="startDate" type="date" className={inputClass} />
        </div>
        <div>
          <label htmlFor="endDate" className="block text-sm font-medium">
            End date (optional)
          </label>
          <input id="endDate" name="endDate" type="date" className={inputClass} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label htmlFor="baseCurrency" className="block text-sm font-medium">
            Currency
          </label>
          <input
            id="baseCurrency"
            name="baseCurrency"
            defaultValue="CAD"
            required
            maxLength={3}
            pattern="[A-Za-z]{3}"
            className={`${inputClass} uppercase`}
          />
        </div>
        <div>
          <label htmlFor="groupTarget" className="block text-sm font-medium">
            Group target per person (optional)
          </label>
          <input id="groupTarget" name="groupTarget" inputMode="decimal" className={inputClass} />
        </div>
      </div>
      {state.error ? (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      ) : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-md bg-zinc-900 px-4 py-2.5 font-medium text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
      >
        {pending ? "Creating..." : "Create trip"}
      </button>
    </form>
  );
}
