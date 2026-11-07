// Curated, not exhaustive; unknown airports are tier 3.
export const HUB_TIER: Record<string, 1 | 2> = {
  // Tier 1: major intercontinental hubs
  YYZ: 1, YUL: 1, YVR: 1, JFK: 1, LHR: 1, CDG: 1, FRA: 1, AMS: 1, MAD: 1, FCO: 1,
  IST: 1, DXB: 1, DOH: 1, HND: 1, NRT: 1, ICN: 1, HKG: 1, PEK: 1, PVG: 1, CAN: 1,
  SIN: 1, BKK: 1, LAX: 1, SFO: 1, ORD: 1,
  // Tier 2
  YOW: 2, BCN: 2, ORY: 2, MUC: 2, ZRH: 2, LIS: 2, MXP: 2, VIE: 2, CPH: 2, KIX: 2,
  TPE: 2, SZX: 2, CKG: 2, CTU: 2, PKX: 2, MNL: 2, KUL: 2, BOS: 2, SEA: 2, YYC: 2,
};

export function hubTier(airport: string): 1 | 2 | 3 {
  return HUB_TIER[airport] ?? 3;
}

/** Best (lowest) tier among the airports; 3 when the list is empty. */
export function bestTier(airports: readonly string[]): 1 | 2 | 3 {
  let best: 1 | 2 | 3 = 3;
  for (const a of airports) {
    const t = hubTier(a);
    if (t < best) best = t;
  }
  return best;
}
