// Search-only hub ranking. The planner's curated list (src/domain/planner/hubs.ts) is reused as is
// so planner behaviour does not change; this list adds major hubs it lacks. Curated, not
// exhaustive: an airport missing from both lists still appears in search, after the listed ones.
import { HUB_TIER } from "../planner/hubs";

export const SEARCH_HUB_TIER: Record<string, 1 | 2> = {
  // Tier 1: major intercontinental hubs
  ATL: 1, DFW: 1, DEN: 1, MIA: 1, EWR: 1, IAD: 1, IAH: 1, SYD: 1, MEL: 1, DEL: 1,
  BOM: 1, GRU: 1, MEX: 1, JNB: 1, CAI: 1,
  // Tier 2
  LGW: 2, STN: 2, MCO: 2, LAS: 2, PHX: 2, CLT: 2, MSP: 2, DTW: 2, PHL: 2, SAN: 2,
  FLL: 2, HNL: 2, YEG: 2, YHZ: 2, YWG: 2, BNE: 2, AKL: 2, BLR: 2, HYD: 2, CGK: 2,
  SGN: 2, HAN: 2, KMG: 2, XIY: 2, SHA: 2, GMP: 2, CTS: 2, FUK: 2, DUB: 2, MAN: 2,
  EDI: 2, BRU: 2, ARN: 2, OSL: 2, HEL: 2, ATH: 2, WAW: 2, PRG: 2, BUD: 2, GVA: 2,
  DUS: 2, BER: 2, HAM: 2, NCE: 2, AUH: 2, RUH: 2, JED: 2, TLV: 2, ADD: 2, NBO: 2,
  CPT: 2, LOS: 2, CMN: 2, BOG: 2, LIM: 2, SCL: 2, EZE: 2, GIG: 2, PTY: 2, CUN: 2,
};

/** Search rank: the planner tier wins when both lists have the code; unlisted airports are 3. */
export function searchHubRank(iata: string): 1 | 2 | 3 {
  return HUB_TIER[iata] ?? SEARCH_HUB_TIER[iata] ?? 3;
}

/** Metropolitan names a traveler would type for airports whose municipality differs. */
export const SEARCH_CITY_ALIASES: Record<string, string> = {
  NRT: "Tokyo",
  EWR: "New York",
  IAD: "Washington",
  MXP: "Milan",
};
