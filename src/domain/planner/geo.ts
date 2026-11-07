import type { PlannerCity } from "./types";

const EARTH_RADIUS_KM = 6371;

export interface LatLng {
  lat: number;
  lng: number;
}

const rad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Sum of leg distances along `order` (city ids), visiting in sequence. */
export function pathKm(order: readonly string[], cityById: ReadonlyMap<string, PlannerCity>): number {
  let total = 0;
  for (let i = 0; i + 1 < order.length; i++) {
    const a = cityById.get(order[i] as string);
    const b = cityById.get(order[i + 1] as string);
    if (!a || !b) throw new Error(`Unknown city in order: ${order[i]} or ${order[i + 1]}`);
    total += haversineKm(a, b);
  }
  return total;
}

/** All permutations in lexicographic index order (deterministic). */
export function permutations<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  const used = new Array<boolean>(items.length).fill(false);
  const current: T[] = [];
  const walk = () => {
    if (current.length === items.length) {
      result.push([...current]);
      return;
    }
    for (let i = 0; i < items.length; i++) {
      if (used[i]) continue;
      used[i] = true;
      current.push(items[i] as T);
      walk();
      current.pop();
      used[i] = false;
    }
  };
  walk();
  return result;
}
