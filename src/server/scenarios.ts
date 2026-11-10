// Runs the route engine on a saved trip and keeps the result.
import { generateRouteOptions } from "@/domain";
import type { RouteOptionsResult } from "@/domain";
import { requireMember, requireUser } from "./access";
import { ServiceError } from "./errors";
import {
  ENGINE_VERSION,
  buildEngineInput,
  hashEngineInput,
  type EngineInputIssue,
  type EngineSnapshot,
  type ExcludedQuote,
} from "./engine-input";
import { parseInput, tripScopedInput } from "./schemas";
import type { PlanningStore, ScenarioRow, Store } from "./store";

type Services = Store & PlanningStore;

/**
 * Reads everything the engine input is built from, and nothing else. It never calls
 * `getBudget`: saved scenarios are visible to the whole group, so a budget-aware run would
 * leak headroom.
 *
 * PARKED (budget access for the engine, decision pending):
 *   A. a SQL function that returns only fit and headroom per traveler, never the ceiling;
 *   B. a secret-key read inside the server plus redaction of the result.
 * Either would plug in here, as an extra field on the snapshot and `budgetCeiling` on the
 * travelers. Neither is implemented.
 */
export async function loadEngineSnapshot(store: Services, tripId: string): Promise<EngineSnapshot> {
  const trip = await store.getTrip(tripId);
  if (!trip) throw new ServiceError("not_found");
  const [constraints, members, destinations, destinationConstraints, fixedEvents, preferences, quotes] =
    await Promise.all([
      store.getTripConstraints(tripId),
      store.listMembers(tripId),
      store.listDestinations(tripId),
      store.listDestinationConstraints(tripId),
      store.listFixedEvents(tripId),
      store.listPreferences(tripId),
      store.listQuotes(tripId),
    ]);
  return { trip, constraints, members, destinations, destinationConstraints, fixedEvents, preferences, quotes };
}

export type RunScenarioResult =
  | { ok: true; reused: boolean; scenario: ScenarioRow; excludedQuotes: ExcludedQuote[] }
  | { ok: false; issues: EngineInputIssue[] };

/** Any member can run the engine. The same saved trip and engine version reuse the saved run. */
export async function runScenario(store: Services, raw: unknown, now: Date = new Date()): Promise<RunScenarioResult> {
  const { tripId } = parseInput(tripScopedInput, raw);
  const userId = await requireUser(store);
  await requireMember(store, tripId, userId);

  const built = buildEngineInput(await loadEngineSnapshot(store, tripId), now);
  if (!built.ok) return built;

  const inputHash = hashEngineInput(built.input);
  const existing = await store.findScenario(tripId, ENGINE_VERSION, inputHash);
  if (existing) return { ok: true, reused: true, scenario: existing, excludedQuotes: built.excludedQuotes };

  // Engine failures (no feasible route, invalid input) are results too, and are kept.
  const result: RouteOptionsResult = generateRouteOptions(built.input);
  try {
    const scenario = await store.insertScenario({
      tripId,
      engineVersion: ENGINE_VERSION,
      inputHash,
      input: built.input,
      result,
      ok: result.ok,
      createdBy: userId,
    });
    return { ok: true, reused: false, scenario, excludedQuotes: built.excludedQuotes };
  } catch (error) {
    // A simultaneous identical run won the unique index; return that one.
    if (error instanceof ServiceError && error.code === "conflict") {
      const winner = await store.findScenario(tripId, ENGINE_VERSION, inputHash);
      if (winner) return { ok: true, reused: true, scenario: winner, excludedQuotes: built.excludedQuotes };
    }
    throw error;
  }
}

export interface ScenarioList {
  scenarios: ScenarioRow[];
  /**
   * Hash of the engine input the trip would produce right now, or null when it cannot be
   * built. A scenario whose hash differs (or whose engine version differs) is stale.
   */
  currentInputHash: string | null;
  currentEngineVersion: string;
}

export async function listScenarios(store: Services, raw: unknown, now: Date = new Date()): Promise<ScenarioList> {
  const { tripId } = parseInput(tripScopedInput, raw);
  const userId = await requireUser(store);
  await requireMember(store, tripId, userId);
  const [scenarios, snapshot] = await Promise.all([store.listScenarios(tripId), loadEngineSnapshot(store, tripId)]);
  const built = buildEngineInput(snapshot, now);
  return {
    scenarios,
    currentInputHash: built.ok ? hashEngineInput(built.input) : null,
    currentEngineVersion: ENGINE_VERSION,
  };
}
