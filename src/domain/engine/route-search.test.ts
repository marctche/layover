import { describe, expect, it } from "vitest";
import { leg } from "../../../tests/helpers/builders";
import type { Leg, PriceSource } from "../trip/types";
import { cheaperLeg } from "./route-search";

const withSource = (l: Leg, source: PriceSource, fetchedAt?: string): Leg => ({
  ...l,
  pricePerPerson: { ...l.pricePerPerson, source, ...(fetchedAt ? { fetchedAt } : {}) },
});

describe("cheaperLeg", () => {
  it("prefers the cheaper leg regardless of source", () => {
    const live = withSource(leg("A", "B", 60, 120), "live");
    const est = withSource(leg("A", "B", 60, 100), "estimate");
    expect(cheaperLeg(live, est)).toBe(est);
  });

  it("breaks an exact tie by source rank, in either input order", () => {
    const live = withSource(leg("A", "B", 60, 100), "live");
    const est = withSource(leg("A", "B", 60, 100), "estimate");
    expect(cheaperLeg(live, est)).toBe(live);
    expect(cheaperLeg(est, live)).toBe(live);
  });

  it("breaks a same-source tie by the newest quote, in either input order", () => {
    const older = withSource(leg("A", "B", 60, 100), "live", "2026-11-01T00:00:00Z");
    const newer = withSource(leg("A", "B", 60, 100), "live", "2026-11-03T00:00:00Z");
    expect(cheaperLeg(older, newer)).toBe(newer);
    expect(cheaperLeg(newer, older)).toBe(newer);
  });
});

describe("cheaperLeg timestamps", () => {
  it("orders fetchedAt by time, not by string, across formats", () => {
    const a = withSource(leg("A", "B", 60, 100), "live", "2026-11-03T10:00:00+05:00"); // 05:00Z
    const b = withSource(leg("A", "B", 60, 100), "live", "2026-11-03T06:00:00.000Z");
    expect(cheaperLeg(a, b)).toBe(b);
    expect(cheaperLeg(b, a)).toBe(b);
  });
});
