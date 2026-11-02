import { must } from "./util";

export interface AllocationCity {
  id: string;
  minNights: number;
  maxNights?: number;
  /** Group preference weight; higher gets spare nights first. */
  weight: number;
}

export interface AllocationEvent {
  cityId: string;
  firstNight: number;
  lastNight: number;
}

export type AllocationResult = { ok: true; nights: number[] } | { ok: false };

interface Reach {
  /** forward[p][s]: first p cities can end exactly at night s. */
  forward: boolean[][];
  /** backward[p][s]: cities p.. can fill nights s..total. */
  backward: boolean[][];
}

/**
 * Exact night allocation for a fixed city order.
 *
 * Feasibility is a DP over (position, nights used) in which a stay starting at
 * night s with n nights must cover every event of that city. Spare nights are
 * then handed out greedily: cities in descending group weight (ties by city id, so
 * the result does not depend on route position) each take the largest stay that still leaves the rest feasible, and
 * are then pinned. Because the oracle is exact, a valid allocation is always
 * found when one exists.
 */
export function allocateNights(
  order: readonly AllocationCity[],
  totalNights: number,
  events: readonly AllocationEvent[],
): AllocationResult {
  const k = order.length;
  if (k === 0 || totalNights <= 0) return { ok: false };

  const lo = order.map((c) => c.minNights);
  const hi = order.map((c) => Math.min(c.maxNights ?? totalNights, totalNights));
  const eventsAt = order.map((c) => events.filter((e) => e.cityId === c.id));

  const covers = (pos: number, start: number, n: number) =>
    eventsAt[pos]!.every((e) => start <= e.firstNight && start + n - 1 >= e.lastNight);

  const reach = (): Reach => {
    const forward = Array.from({ length: k + 1 }, () => new Array<boolean>(totalNights + 1).fill(false));
    const backward = Array.from({ length: k + 1 }, () => new Array<boolean>(totalNights + 1).fill(false));
    must(forward[0], "forward row")[0] = true;
    for (let p = 0; p < k; p++) {
      const row = must(forward[p], "forward row");
      const next = must(forward[p + 1], "forward row");
      for (let s = 0; s <= totalNights; s++) {
        if (!row[s]) continue;
        for (let n = must(lo[p], "lo"); n <= Math.min(must(hi[p], "hi"), totalNights - s); n++) {
          if (covers(p, s, n)) next[s + n] = true;
        }
      }
    }
    must(backward[k], "backward row")[totalNights] = true;
    for (let p = k - 1; p >= 0; p--) {
      const row = must(backward[p], "backward row");
      const next = must(backward[p + 1], "backward row");
      for (let s = 0; s <= totalNights; s++) {
        for (let n = must(lo[p], "lo"); n <= Math.min(must(hi[p], "hi"), totalNights - s); n++) {
          if (covers(p, s, n) && next[s + n]) {
            row[s] = true;
            break;
          }
        }
      }
    }
    return { forward, backward };
  };

  let r = reach();
  if (!must(must(r.backward[0], "backward row")[0], "cell")) return { ok: false };

  const priority = order
    .map((c, i) => ({ i, id: c.id, w: c.weight }))
    .sort((a, b) => b.w - a.w || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((x) => x.i);

  for (const p of priority) {
    const fwd = must(r.forward[p], "forward row");
    const bwd = must(r.backward[p + 1], "backward row");
    let best = -1;
    for (let s = 0; s <= totalNights; s++) {
      if (!fwd[s]) continue;
      for (let n = Math.min(must(hi[p], "hi"), totalNights - s); n >= must(lo[p], "lo"); n--) {
        if (covers(p, s, n) && bwd[s + n]) {
          best = Math.max(best, n);
          break;
        }
      }
    }
    lo[p] = best;
    hi[p] = best;
    r = reach();
  }

  return { ok: true, nights: lo };
}
