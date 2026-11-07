// Prices a demo trip's flights. Dry run by default; paid mode needs --live and --max-searches N.
//   pnpm price-trip --trip europe
//   pnpm price-trip --trip europe --live --max-searches 6
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { generateRouteOptions } from "@/domain/engine/generate";
import { asiaDryRun, europeDryRun } from "@/domain/planner/catalog";
import { planSearches } from "@/domain/planner/plan";
import type { PlannerInput } from "@/domain/planner/types";
import { buildFlightsOnlyTrip } from "@/pricing/flights-only-trip";
import { renderDryRun, renderReport } from "@/pricing/report";
import { runPlan } from "@/pricing/run";
import { diskCache } from "@/pricing/serpapi/cache";
import { buildSearchParams, scrubKey, searchOnce } from "@/pricing/serpapi/client";

const TRIPS: Record<string, PlannerInput> = { europe: europeDryRun, asia: asiaDryRun };

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

/** Reads only SERPAPI_API_KEY, from the environment or .env.local. Never printed. */
function readApiKey(): string {
  if (process.env.SERPAPI_API_KEY) return process.env.SERPAPI_API_KEY;
  try {
    const line = readFileSync(".env.local", "utf8").split("\n").find((l) => l.startsWith("SERPAPI_API_KEY="));
    return (line?.slice("SERPAPI_API_KEY=".length) ?? "").trim().replace(/^["']|["']$/g, "");
  } catch {
    return "";
  }
}

async function main() {
  const { values } = parseArgs({
    options: { trip: { type: "string" }, live: { type: "boolean", default: false }, "max-searches": { type: "string" } },
  });
  const name = values.trip ?? "";
  const input = TRIPS[name];
  if (!input) fail(`Choose a trip with --trip: ${Object.keys(TRIPS).join(", ")}`);

  const plan = planSearches(input);
  if (!plan.ok) fail(`The planner rejected the trip:\n${plan.errors.map((e) => `- ${e.code}: ${e.message}`).join("\n")}`);

  const cache = diskCache();
  const firstParams = (s: (typeof plan.searches)[number]) => buildSearchParams({ kind: s.kind === "open_jaw" ? "multi_city" : "one_way", legs: s.legs });
  const isCached = (s: (typeof plan.searches)[number]) => cache.get(firstParams(s)) !== null;

  if (!values.live) {
    if (values["max-searches"] !== undefined) fail("--max-searches only applies with --live");
    console.log(renderDryRun(name, input, plan, isCached));
    return;
  }

  const rawLimit = values["max-searches"];
  if (rawLimit === undefined || !/^\d+$/.test(rawLimit)) fail("Paid mode needs both --live and --max-searches N (a whole number).");
  const maxSearches = Number(rawLimit);
  const apiKey = readApiKey();
  if (!apiKey) fail("SERPAPI_API_KEY is not set in the environment or .env.local.");

  const run = await runPlan(plan.searches, {
    input,
    maxSearches,
    cache,
    search: async (params) => {
      const text = await searchOnce(params, { apiKey, fetch: (url) => fetch(url) });
      return { text, fetchedAt: new Date().toISOString() };
    },
  });

  const options = generateRouteOptions(buildFlightsOnlyTrip(input, run.usable));
  const generatedAt = new Date().toISOString();
  const report = scrubKey(renderReport({ name, generatedAt, input, plan, run, options }), apiKey);
  const file = path.join("notes", "runs", `${name}-${generatedAt.replace(/[:.]/g, "-")}.md`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, report);
  console.log(report);
  console.log(`Report written to ${file}`);
}

main().catch(() => fail("The run failed unexpectedly."));
