import { describe, expect, it } from "vitest";
import { ESTIMATE, estimateLeg } from "./estimate";

const at = (id: string, lat: number, lng: number) => ({ id, lat, lng });
const tokyo = at("tokyo", 35.68, 139.69);
const seoul = at("seoul", 37.57, 126.98);
const osaka = at("osaka", 34.69, 135.5);
const delhi = at("delhi", 28.61, 77.21);

describe("estimateLeg", () => {
  it("is deterministic and labeled as an estimate", () => {
    const a = estimateLeg(tokyo, seoul, "USD");
    expect(estimateLeg(tokyo, seoul, "USD")).toEqual(a);
    expect(a.pricePerPerson.source).toBe("estimate");
    expect(a.pricePerPerson.provider).toBe(ESTIMATE.provider);
    expect([a.from, a.to]).toEqual(["tokyo", "seoul"]);
  });

  it("uses ground transport when near and flights when far", () => {
    expect(estimateLeg(tokyo, osaka, "USD").mode).toBe("train");
    expect(estimateLeg(tokyo, seoul, "USD").mode).toBe("flight");
  });

  it("grows in price and duration with distance, within a mode", () => {
    const near = estimateLeg(tokyo, seoul, "USD"); // ~1160 km
    const far = estimateLeg(tokyo, delhi, "USD"); // ~5800 km
    expect(far.durationMinutes).toBeGreaterThan(near.durationMinutes);
    expect(far.pricePerPerson.price.amountMinor).toBeGreaterThan(near.pricePerPerson.price.amountMinor);
    const short = estimateLeg(tokyo, at("x", 35.68, 140.2), "USD");
    const longer = estimateLeg(tokyo, osaka, "USD");
    expect(short.mode).toBe("train");
    expect(longer.durationMinutes).toBeGreaterThan(short.durationMinutes);
    expect(longer.pricePerPerson.price.amountMinor).toBeGreaterThan(short.pricePerPerson.price.amountMinor);
  });

  it("is symmetric in distance and positive", () => {
    const ab = estimateLeg(tokyo, seoul, "USD");
    const ba = estimateLeg(seoul, tokyo, "USD");
    expect(ab.durationMinutes).toBe(ba.durationMinutes);
    expect(ab.pricePerPerson.price.amountMinor).toBe(ba.pricePerPerson.price.amountMinor);
    expect(ab.durationMinutes).toBeGreaterThan(0);
  });
});
