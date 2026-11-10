"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import { initialFormState, type FormState } from "@/app/_lib/form-state";
import { checkNewCity, formatCity } from "@/domain/cities/search";
import { addCityAction } from "./actions";
import { inputClass, mutedClass, SaveStatus } from "./autoform";

interface Option {
  id: string;
  name: string;
  country: string;
}

type Status = "idle" | "loading" | "ready" | "unavailable";

/** Fetches matches. Any failure, redirect or non-JSON answer is "unavailable"; it never throws. */
async function fetchCities(query: string, signal: AbortSignal): Promise<Option[] | null> {
  try {
    const res = await fetch(`/api/cities?q=${encodeURIComponent(query)}`, { signal, credentials: "same-origin", redirect: "manual" });
    if (!res.ok || res.redirected || !(res.headers.get("content-type") ?? "").includes("application/json")) return null;
    const body: unknown = await res.json();
    if (typeof body !== "object" || body === null || !("results" in body) || !Array.isArray(body.results)) return null;
    return body.results.filter(
      (r): r is Option => typeof r === "object" && r !== null && typeof r.id === "string" && typeof r.name === "string" && typeof r.country === "string",
    );
  } catch {
    return null;
  }
}

/** WAI-ARIA combobox with a listbox popup. Picking a city saves it for the trip. */
export function CityCombobox({ tripId, existingNames, max }: { tripId: string; existingNames: string[]; max: number }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(addCityAction, initialFormState);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Option[]>([]);
  const [status, setStatus] = useState<Status>("idle");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [problem, setProblem] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const listId = useId();
  const full = existingNames.length >= max;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const q = query.trim();
    if (timer.current) clearTimeout(timer.current);
    if (q === "") return;
    const controller = new AbortController();
    timer.current = setTimeout(async () => {
      setStatus("loading");
      const found = await fetchCities(q, controller.signal);
      if (controller.signal.aborted) return;
      if (found === null) {
        setOptions([]);
        setStatus("unavailable");
      } else {
        setOptions(found);
        setStatus("ready");
        setActive(found.length > 0 ? 0 : -1);
      }
    }, 150);
    return () => {
      controller.abort();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, retry]);

  const hasQuery = query.trim() !== "";
  const showList = open && hasQuery && status === "ready" && options.length > 0;

  function pick(option: Option) {
    const name = formatCity(option);
    const why = checkNewCity(existingNames, name, max);
    if (why) {
      setProblem(why);
      return;
    }
    setProblem(null);
    setQuery("");
    setOpen(false);
    setOptions([]);
    setStatus("idle");
    const data = new FormData();
    data.set("tripId", tripId);
    data.set("name", name);
    startTransition(() => formAction(data));
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      if (options.length > 0) setActive((a) => (a + 1) % options.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length > 0) setActive((a) => (a <= 0 ? options.length - 1 : a - 1));
    } else if (event.key === "Enter") {
      const option = options[active];
      if (showList && option) {
        event.preventDefault();
        pick(option);
      }
    } else if (event.key === "Escape") {
      if (open) event.stopPropagation();
      setOpen(false);
    }
  }

  const liveMessage =
    status === "loading"
      ? "Searching..."
      : status === "unavailable"
        ? ""
        : status === "ready" && hasQuery
          ? options.length === 0
            ? "No matching city."
            : `${options.length} cities found. Use the arrow keys to choose.`
          : "";

  return (
    <div className="mt-4">
      <label htmlFor={`${listId}-input`} className="block text-sm font-medium">
        Search for a city
      </label>
      <p id={`${listId}-count`} className={mutedClass}>
        {existingNames.length} of {max} cities. Routes compare at most {max} so they stay quick to calculate.
      </p>
      <div className="relative mt-1">
        <input
          id={`${listId}-input`}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={showList}
          aria-controls={`${listId}-list`}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-opt-${active}` : undefined}
          aria-describedby={`${listId}-count`}
          disabled={full}
          maxLength={60}
          value={query}
          placeholder={full ? "The list is full" : "Start typing, for example Paris"}
          className={inputClass}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setProblem(null);
            if (e.target.value.trim() === "") setStatus("idle");
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
        />
        <ul
          id={`${listId}-list`}
          role="listbox"
          aria-label="Matching cities"
          hidden={!showList}
          className="absolute z-10 mt-1 max-h-72 w-full overflow-auto rounded-md border border-zinc-300 bg-white shadow dark:border-zinc-700 dark:bg-zinc-900"
        >
          {options.map((option, i) => {
            const duplicate = existingNames.some((n) => n === formatCity(option));
            return (
              <li
                key={option.id}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === active}
                className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3 py-2 ${i === active ? "bg-zinc-200 dark:bg-zinc-700" : ""}`}
                // mousedown, not click: the input's blur would close the list first.
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(option);
                }}
                onMouseMove={() => setActive(i)}
              >
                <span>
                  {option.name}, {option.country}
                </span>
                {duplicate ? <span className={mutedClass}>Already added</span> : null}
              </li>
            );
          })}
        </ul>
      </div>
      <p role="status" className="sr-only">
        {liveMessage}
      </p>
      {status === "loading" ? <p className={`mt-1 ${mutedClass}`}>Searching...</p> : null}
      {status === "ready" && hasQuery && options.length === 0 ? <p className={`mt-1 ${mutedClass}`}>No matching city. Cities under 100,000 people are not listed.</p> : null}
      {status === "unavailable" ? (
        <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
          Search is unavailable right now. Try again.{" "}
          <button type="button" className="min-h-11 underline" onClick={() => setRetry((n) => n + 1)}>
            Retry
          </button>
        </p>
      ) : null}
      {problem ? (
        <p role="alert" className="mt-1 text-sm text-red-700 dark:text-red-400">
          {problem}
        </p>
      ) : null}
      {full ? <p className={`mt-1 ${mutedClass}`}>The list is full. There is no way to remove a city yet, so choose carefully.</p> : null}
      <SaveStatus state={state} pending={pending} />
    </div>
  );
}
