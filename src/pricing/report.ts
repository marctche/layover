// Plain-text (markdown) renderings of a dry run and of a finished run.
import { formatMoney, money } from "@/domain/money/money";
import type { RouteOptionsResult, RoutePlan } from "@/domain/engine/types";
import type { PlannedSearch, PlannerInput, SearchPlan } from "@/domain/planner/types";
import { CURRENCY } from "./serpapi/client";
import type { PricedFare, PricedLeg } from "./serpapi";
import type { RunResult } from "./run";

type OkPlan = Extract<SearchPlan, { ok: true }>;

const dateOf = (s: PlannedSearch) => s.legs.map((l) => l.date).join(" and ");
const airportsOf = (s: PlannedSearch) => s.legs.map((l) => `${l.from.join(",")} to ${l.to.join(",")}`).join(" / ");

export function renderDryRun(name: string, input: PlannerInput, plan: OkPlan, isCached: (s: PlannedSearch) => boolean): string {
  const c = plan.classification;
  const out: string[] = [];
  out.push(`Dry run: ${name} (no network calls)`, "");
  out.push(`Classification: ${c.shape}, modifiers [${c.modifiers.join(", ")}], long haul ${c.longHaul}`);
  for (const r of c.reasons) out.push(`  - ${r}`);
  out.push("", `Kept orders (${plan.keptOrders.length}):`);
  for (const k of plan.keptOrders) out.push(`  ${k.order.join(" > ")}  (${Math.round(k.km)} km) ${k.why}`);
  out.push("", "Skipped orders:");
  for (const s of plan.skippedOrders) out.push(`  ${s.count}: ${s.why}`);
  out.push("", `Searches in run order (${plan.searches.length}):`);
  for (const s of plan.searches) {
    out.push(`  ${s.priority}. ${s.id} [${s.kind}, ${s.purpose}] ${airportsOf(s)} on ${dateOf(s)}`);
    out.push(`     billable ${s.billableCost}${isCached(s) ? " (first call already cached)" : ""}; ${s.reason}`);
  }
  if (plan.droppedForBudget.length > 0) {
    out.push("", `Not planned, over the planner budget (${plan.droppedForBudget.length}):`);
    for (const s of plan.droppedForBudget) out.push(`  ${s.id} [${s.kind}] billable ${s.billableCost}; ${s.reason}`);
  }
  const cached = plan.searches.filter(isCached).length;
  out.push("", `Total billable if nothing is cached: ${plan.totalBillable}`);
  out.push(`Searches whose first call is already cached: ${cached} of ${plan.searches.length}`);
  out.push(`Home: ${input.home.id}, primary airport ${input.home.airports[0]}`);
  return out.join("\n");
}

const money$ = (m: { amountMinor: number; currency: string }) => formatMoney(m);

function groundNote(airport: string, input: PlannerInput): string {
  const primary = input.home.airports[0];
  return airport === primary ? "" : `; ground trip to ${input.home.id} not included (${airport} is not the primary airport ${primary})`;
}

function legLines(route: RoutePlan, run: RunResult, input: PlannerInput, dates: Map<string, string>): string[] {
  const lines: string[] = [];
  const first = route.stops[0]?.cityId;
  const last = route.stops[route.stops.length - 1]?.cityId;
  const fare = run.usable.find((p): p is PricedFare => p.kind === "open_jaw" && p.fare.outboundTo === first && p.fare.returnFrom === last);
  if (fare) {
    const f = fare.fare;
    lines.push(
      `  - Ticket ${input.home.id} to ${f.outboundTo}, ${f.returnFrom} back: ${money$(f.pricePerPerson.price)} [${f.pricePerPerson.source}, fetched ${f.pricePerPerson.fetchedAt}]`,
      `    flies out of ${fare.outboundOriginAirport}${groundNote(fare.outboundOriginAirport, input)}`,
      `    returns to ${fare.returnDestinationAirport}${groundNote(fare.returnDestinationAirport, input)}`,
    );
  }
  for (const leg of route.intercityLegs) {
    const p = run.usable.find((x): x is PricedLeg => x.kind === "one_way" && x.leg.from === leg.from && x.leg.to === leg.to);
    const airports = p ? `${p.originAirport} to ${p.destinationAirport}` : "airports unknown";
    const date = p ? dates.get(p.id) : undefined;
    lines.push(
      `  - ${leg.from} to ${leg.to}: ${money$(leg.pricePerPerson.price)} [${leg.pricePerPerson.source}, fetched ${leg.pricePerPerson.fetchedAt}], ${airports}${date ? `, priced for ${date} (approximate)` : ""}`,
    );
  }
  return lines;
}

export interface ReportInput {
  name: string;
  generatedAt: string;
  input: PlannerInput;
  plan: OkPlan;
  run: RunResult;
  options: RouteOptionsResult;
}

export function renderReport(r: ReportInput): string {
  const { input, run } = r;
  const dates = new Map(r.plan.searches.map((s) => [s.id, dateOf(s)]));
  const out: string[] = [];
  out.push(`# Pricing run: ${r.name}`, "", `Generated ${r.generatedAt}`, "");
  out.push(
    "Flights only. Lodging, daily costs, bags and ground transfers are excluded from every total.",
    "City-to-city dates are approximate: each intercity flight was priced for one estimated date, not the exact date a final route would use.",
    `Prices are in ${CURRENCY}, for one adult.`,
    "",
  );

  out.push("## Alternatives", "");
  if (!r.options.ok) {
    out.push("No route could be generated from the usable prices.");
    for (const e of r.options.errors) out.push(`- ${e.code}: ${e.message}`);
  } else {
    r.options.alternatives.forEach((alt, i) => {
      const cost = alt.route.travelerCosts[0];
      const total = cost ? money(cost.international.amountMinor + cost.intercity.amountMinor, CURRENCY) : null;
      out.push(`### ${i + 1}. ${alt.route.stops.map((s) => `${s.cityId} (${s.nights}n)`).join(" > ")}  [${alt.labels.join(", ")}]`, "");
      out.push(`Flight total: ${total ? money$(total) : "unknown"}`);
      out.push(...legLines(alt.route, run, input, dates), "");
    });
  }

  out.push("## Held prices (not used)", "");
  if (run.held.length === 0) out.push("None.");
  for (const p of run.held) out.push(`- ${p.id}: ${money$(p.price)}; ${p.flags.filter((f) => f.severity === "hold").map((f) => `${f.code} (${f.detail})`).join("; ")}`);

  out.push("", "## Warnings", "");
  if (run.warnings.length === 0) out.push("None.");
  for (const w of run.warnings) out.push(`- ${w.id}: ${w.detail}`);

  out.push("", "## Missing prices", "");
  if (run.missing.length === 0) out.push("None.");
  for (const m of run.missing) out.push(`- ${m.id}: ${m.reason}; ${m.detail}`);

  out.push("", "## Searches not run", "");
  if (run.notRun.length === 0) out.push("None.");
  for (const n of run.notRun) out.push(`- ${n.id}: ${n.reason}`);
  for (const s of r.plan.droppedForBudget) out.push(`- ${s.id}: not planned, over the planner budget`);

  out.push("", "## Calls", "", `Paid calls: ${run.paidCalls}`, `Cached calls: ${run.cachedCalls}`, "");
  return out.join("\n");
}
