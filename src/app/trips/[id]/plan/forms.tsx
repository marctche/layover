"use client";

import { useState } from "react";
import { tripNights } from "@/domain";
import {
  addFixedEventAction,
  removeFixedEventAction,
  saveAirportAction,
  saveAvailabilityAction,
  saveBudgetAction,
  saveCityRulesAction,
  saveDatesAction,
  saveEndpointsAction,
  saveRatingAction,
} from "./actions";
import { ActionForm, AutoForm, inputClass, labelClass, mutedClass } from "./autoform";

const button =
  "min-h-11 rounded-md bg-zinc-900 px-4 py-2 font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:opacity-50 dark:bg-white dark:text-zinc-900";
const linkButton = "min-h-11 px-2 text-sm underline focus-visible:outline-2 focus-visible:outline-blue-600 disabled:opacity-50";

const bothOrNeither = (a: string, b: string) => (data: FormData) => {
  const x = String(data.get(a) ?? "");
  const y = String(data.get(b) ?? "");
  return (x === "") === (y === "");
};

export function DatesForm({ tripId, startDate, endDate }: { tripId: string; startDate: string; endDate: string }) {
  const [start, setStart] = useState(startDate);
  const [end, setEnd] = useState(endDate);
  const nights = tripNights(start || null, end || null);
  return (
    <AutoForm action={saveDatesAction} hidden={{ tripId }} canSubmit={bothOrNeither("startDate", "endDate")}>
      {(status) => (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="startDate" className={labelClass}>Start date</label>
              <input id="startDate" name="startDate" type="date" value={start} onChange={(e) => setStart(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label htmlFor="endDate" className={labelClass}>End date</label>
              <input id="endDate" name="endDate" type="date" min={start || undefined} value={end} onChange={(e) => setEnd(e.target.value)} className={inputClass} />
            </div>
          </div>
          <p className="mt-3 text-base font-medium" aria-live="polite">
            {nights !== null ? `${nights} night${nights === 1 ? "" : "s"}` : start || end ? "Pick both dates, with the end after the start." : "No dates yet."}
          </p>
          <p className={mutedClass}>Routes need exact dates. A flexible window is not supported yet.</p>
          {status}
        </>
      )}
    </AutoForm>
  );
}

export function AirportForm({ tripId, airport }: { tripId: string; airport: string }) {
  return (
    <AutoForm action={saveAirportAction} hidden={{ tripId }}>
      {(status) => (
        <>
          <label htmlFor="airport" className={labelClass}>Departure airport (3-letter code)</label>
          <input id="airport" name="airport" defaultValue={airport} maxLength={3} autoCapitalize="characters" autoComplete="off" pattern="[A-Za-z]{3}" placeholder="YYZ" className={`${inputClass} max-w-40 uppercase`} />
          <p className={mutedClass}>One shared home airport for the whole group, for example YYZ, LHR or JFK.</p>
          {status}
        </>
      )}
    </AutoForm>
  );
}

export function EndpointsForm({
  tripId,
  cities,
  start,
  end,
}: {
  tripId: string;
  cities: { id: string; name: string }[];
  start: string;
  end: string;
}) {
  return (
    <AutoForm action={saveEndpointsAction} hidden={{ tripId }} className="grid gap-4 sm:grid-cols-2">
      {(status) => (
        <>
          <div>
            <label htmlFor="startDestinationId" className={labelClass}>Start city</label>
            <select id="startDestinationId" name="startDestinationId" defaultValue={start} className={inputClass}>
              <option value="">No preference</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="endDestinationId" className={labelClass}>End city</label>
            <select id="endDestinationId" name="endDestinationId" defaultValue={end} className={inputClass}>
              <option value="">No preference</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div className="sm:col-span-2">{status}</div>
        </>
      )}
    </AutoForm>
  );
}

export function CityRulesForm({
  tripId,
  destinationId,
  name,
  mustInclude,
  minNights,
  maxNights,
}: {
  tripId: string;
  destinationId: string;
  name: string;
  mustInclude: boolean;
  minNights: number;
  maxNights: number | null;
}) {
  return (
    <AutoForm action={saveCityRulesAction} hidden={{ tripId, destinationId }}>
      {(status) => (
        <fieldset>
          <legend className="font-medium">{name}</legend>
          <label className="mt-2 flex min-h-11 items-center gap-3">
            <input type="checkbox" name="mustInclude" defaultChecked={mustInclude} className="size-5" />
            <span>Must visit (a hard rule, not just a wish)</span>
          </label>
          <div className="mt-2 grid grid-cols-2 gap-4">
            <div>
              <label htmlFor={`min-${destinationId}`} className={labelClass}>Minimum nights</label>
              <input id={`min-${destinationId}`} name="minNights" type="number" inputMode="numeric" min={1} max={365} defaultValue={minNights} className={inputClass} />
            </div>
            <div>
              <label htmlFor={`max-${destinationId}`} className={labelClass}>Maximum nights</label>
              <input id={`max-${destinationId}`} name="maxNights" type="number" inputMode="numeric" min={1} max={365} defaultValue={maxNights ?? ""} placeholder="No limit" className={inputClass} />
            </div>
          </div>
          {status}
        </fieldset>
      )}
    </AutoForm>
  );
}

export function AddFixedEventForm({ tripId, cities }: { tripId: string; cities: { id: string; name: string }[] }) {
  return (
    <ActionForm action={addFixedEventAction} hidden={{ tripId }} className="mt-3 grid gap-4 rounded-md border border-zinc-200 p-4 dark:border-zinc-800">
      {(status, pending) => (
        <>
          <p className="font-medium">Something you cannot move?</p>
          <div>
            <label htmlFor="fe-city" className={labelClass}>City</label>
            <select id="fe-city" name="destinationId" required className={inputClass} defaultValue="">
              <option value="" disabled>Choose a city</option>
              {cities.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="fe-label" className={labelClass}>What is it?</label>
            <input id="fe-label" name="label" required maxLength={120} placeholder="Concert" className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="fe-start" className={labelClass}>From</label>
              <input id="fe-start" name="startDate" type="date" required className={inputClass} />
            </div>
            <div>
              <label htmlFor="fe-end" className={labelClass}>To</label>
              <input id="fe-end" name="endDate" type="date" required className={inputClass} />
            </div>
          </div>
          <div>
            <button type="submit" disabled={pending || cities.length === 0} className={button}>Add event</button>
            {cities.length === 0 ? <p className={mutedClass}>Add a city first.</p> : null}
            {status}
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function RemoveFixedEventButton({ tripId, eventId, label }: { tripId: string; eventId: string; label: string }) {
  return (
    <ActionForm action={removeFixedEventAction} hidden={{ tripId, eventId }}>
      {(status, pending) => (
        <>
          <button type="submit" disabled={pending} aria-label={`Remove ${label}`} className={linkButton}>Remove</button>
          {status}
        </>
      )}
    </ActionForm>
  );
}

export const RATING_CHOICES = [
  { score: -2, label: "Skip it" },
  { score: -1, label: "Not keen" },
  { score: 0, label: "Either way" },
  { score: 1, label: "Keen" },
  { score: 2, label: "Really want" },
] as const;

/** Five labelled radio choices. The selected one is marked with a check, not only a color. */
export function RatingControl({
  tripId,
  destinationId,
  name,
  current,
}: {
  tripId: string;
  destinationId: string;
  name: string;
  current: number | null;
}) {
  const [selected, setSelected] = useState<number | null>(current);
  return (
    <AutoForm action={saveRatingAction} hidden={{ tripId, destinationId }}>
      {(status) => (
        <fieldset>
          <legend className="font-medium">{name}</legend>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
            {RATING_CHOICES.map((c) => (
              <label
                key={c.score}
                className="flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-md border border-zinc-300 px-2 py-2 text-center text-sm has-[:checked]:border-zinc-900 has-[:checked]:bg-zinc-900 has-[:checked]:text-white has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-blue-600 dark:border-zinc-700 dark:has-[:checked]:border-white dark:has-[:checked]:bg-white dark:has-[:checked]:text-zinc-900"
              >
                <input type="radio" name="score" value={c.score} checked={selected === c.score} onChange={() => setSelected(c.score)} className="sr-only" />
                {selected === c.score ? <span aria-hidden="true">✓</span> : null}
                <span>{c.label}</span>
              </label>
            ))}
          </div>
          {status}
        </fieldset>
      )}
    </AutoForm>
  );
}

export function AvailabilityForm({
  tripId,
  ranges,
  flexibilityDays,
}: {
  tripId: string;
  ranges: { startDate: string; endDate: string }[];
  flexibilityDays: number;
}) {
  const [rows, setRows] = useState(() => (ranges.length > 0 ? ranges : [{ startDate: "", endDate: "" }]).map((r, i) => ({ ...r, key: i })));
  const [nextKey, setNextKey] = useState(rows.length);
  return (
    <AutoForm
      action={saveAvailabilityAction}
      hidden={{ tripId }}
      canSubmit={(data) => {
        const s = data.getAll("rangeStart").map(String);
        const e = data.getAll("rangeEnd").map(String);
        return s.every((v, i) => (v === "") === ((e[i] ?? "") === ""));
      }}
    >
      {(status) => (
        <>
          <fieldset>
            <legend className="font-medium">Dates you can travel</legend>
            {rows.map((row, i) => (
              <div key={row.key} className="mt-2 grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                <div>
                  <label htmlFor={`rs-${row.key}`} className={labelClass}>From</label>
                  <input id={`rs-${row.key}`} name="rangeStart" type="date" defaultValue={row.startDate} className={inputClass} />
                </div>
                <div>
                  <label htmlFor={`re-${row.key}`} className={labelClass}>To</label>
                  <input id={`re-${row.key}`} name="rangeEnd" type="date" defaultValue={row.endDate} className={inputClass} />
                </div>
                <button type="button" className={linkButton} aria-label={`Remove range ${i + 1}`} onClick={() => setRows((r) => (r.length > 1 ? r.filter((x) => x.key !== row.key) : [{ startDate: "", endDate: "", key: row.key }]))}>
                  Remove
                </button>
              </div>
            ))}
            <button
              type="button"
              className={`${linkButton} mt-2`}
              disabled={rows.length >= 20}
              onClick={() => {
                setRows((r) => [...r, { startDate: "", endDate: "", key: nextKey }]);
                setNextKey((k) => k + 1);
              }}
            >
              Add another range
            </button>
          </fieldset>
          <div className="mt-4">
            <label htmlFor="flexibilityDays" className={labelClass}>Flexible by how many days?</label>
            <input id="flexibilityDays" name="flexibilityDays" type="number" inputMode="numeric" min={0} max={60} defaultValue={flexibilityDays} className={`${inputClass} max-w-32`} />
            <p className={mutedClass}>How far outside these dates you could still move.</p>
          </div>
          {status}
        </>
      )}
    </AutoForm>
  );
}

export function BudgetField({ tripId, currency, defaultValue }: { tripId: string; currency: string; defaultValue: string }) {
  return (
    <AutoForm action={saveBudgetAction} hidden={{ tripId, currency }}>
      {(status) => (
        <>
          <label htmlFor="ceiling" className={labelClass}>Your maximum budget ({currency})</label>
          <input id="ceiling" name="ceiling" inputMode="decimal" defaultValue={defaultValue} className={`${inputClass} max-w-48`} />
          {status}
        </>
      )}
    </AutoForm>
  );
}
