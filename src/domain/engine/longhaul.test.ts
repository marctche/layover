import { describe, expect, it } from "vitest";
import { fare, miniTrip, triangleTrip } from "../../../tests/helpers/builders";
import { money } from "../money/money";
import type { LongHaulFare, TripInput } from "../trip/types";
import { compareInternational, type InternationalCandidate } from "./costs";
import { generateRouteOptions } from "./generate";
import { redactForViewer } from "./redact";
import { searchRoutes } from "./route-search";
import { validateInput } from "./validate";

// miniTrip, sole order A>B (A 3 nights, B 2). Shared by every traveler:
//   lodging 3*80 + 2*60 = 360, daily 3*50 + 2*40 = 230, intercity 100 -> 690.00.
// Matches the existing totals: T1 pair 500+520 = 1020, 1020 + 690 = 1710.
// T2 pair 600+640 = 1240, 1240 + 690 = 1930.
const SHARED = 69_000;
const T1_PAIR = 102_000; // 500.00 + 520.00, 600 + 620 = 1220 min
const T2_TOTAL = 193_000;

const withFares = (input: TripInput, ...fares: LongHaulFare[]): TripInput => ({ ...input, longHaulFares: fares });

function best(input: TripInput) {
  const r = generateRouteOptions(input);
  if (!r.ok) throw new Error(`expected ok: ${JSON.stringify(r.errors)}`);
  return r.alternatives[0]!.route;
}

describe("long-haul fare vs one-way pair", () => {
  it("chooses an open-jaw fare that is cheaper than the pair", () => {
    // Fare 900.00 (610 + 630 = 1240 min) vs pair 1020.00. T1 total 900 + 690 = 1590.00.
    const route = best(withFares(miniTrip(), fare("H1", "A", "B", 610, 630, 900)));
    const t1 = route.travelerCosts[0]!;
    expect(t1.internationalTicket).toBe("fare");
    expect(t1.international.amountMinor).toBe(90_000);
    expect(t1.total.amountMinor).toBe(90_000 + SHARED); // 159000
    // T2 has no fare and keeps the pair: 600 + 640 = 1240.00, total 1930.00.
    const t2 = route.travelerCosts[1]!;
    expect(t2.internationalTicket).toBe("one_way_pair");
    expect(t2.total.amountMinor).toBe(T2_TOTAL);
    // Group = 1590 + 1930 = 3520.00.
    expect(route.metrics.groupTotal.amountMinor).toBe(352_000);
    // Minutes: intercity 60 + round(mean(T1 fare 610 + 630 = 1240, T2 pair 700 + 720 = 1420)) = 60 + 1330.
    expect(route.metrics.totalTravelMinutes).toBe(1390);
  });

  it("keeps the pair when the fare costs more", () => {
    // Fare 1100.00 > pair 1020.00. T1 total 1020 + 690 = 1710.00.
    const route = best(withFares(miniTrip(), fare("H1", "A", "B", 100, 100, 1100)));
    const t1 = route.travelerCosts[0]!;
    expect(t1.internationalTicket).toBe("one_way_pair");
    expect(t1.total.amountMinor).toBe(T1_PAIR + SHARED); // 171000
    // Minutes come from the pair, not the (shorter) fare: 60 + round(mean(600+620, 700+720)) = 60 + 1320.
    expect(route.metrics.totalTravelMinutes).toBe(1380);
  });

  it("prefers the fare on an exact price and minutes tie", () => {
    // Fare 1020.00 with 600 + 620 = 1220 min equals the pair on both.
    const route = best(withFares(miniTrip(), fare("H1", "A", "B", 600, 620, 1020)));
    expect(route.travelerCosts[0]!.internationalTicket).toBe("fare");
    expect(route.travelerCosts[0]!.total.amountMinor).toBe(171_000);
  });

  it("prefers fewer minutes over the fare-first rule on a price tie", () => {
    // Same price; the fare is 10 min longer in total, so the pair wins.
    const route = best(withFares(miniTrip(), fare("H1", "A", "B", 610, 620, 1020)));
    expect(route.travelerCosts[0]!.internationalTicket).toBe("one_way_pair");
  });

  it("reports sources from the chosen option only", () => {
    // Cheaper fare is manual; the pair legs are synthetic. Everything else is synthetic,
    // so T1 shows manual (fare) + synthetic (stays, intercity), T2 synthetic only.
    const route = best(withFares(miniTrip(), fare("H1", "A", "B", 600, 600, 900, "manual")));
    expect(route.travelerCosts[0]!.priceSources).toEqual(["manual", "synthetic"]);
    expect(route.travelerCosts[1]!.priceSources).toEqual(["synthetic"]);
  });
});

describe("fare-only travelers", () => {
  // No one-way home legs at all. Fares: H into A out of C, and H into B out of A.
  const fareOnly = (...fares: LongHaulFare[]): TripInput => withFares(triangleTrip(), ...fares);
  const ids = (input: TripInput) => searchRoutes(input).routes.map((r) => r.id).sort();

  it("limits first and last city to the fare's outboundTo and returnFrom", () => {
    const input = fareOnly(fare("H", "A", "C", 600, 600, 700), fare("H", "B", "A", 600, 600, 700));
    expect(validateInput(input)).toEqual([]);
    expect(ids(input)).toEqual(
      [
        ["A", "B", "C"],
        ["A", "C"],
        ["B", "A"],
        ["B", "C", "A"],
      ]
        .map((s) => JSON.stringify(s))
        .sort(),
    );
  });

  it("rejects a first/last combination with neither a fare nor one-way legs as missing_home_leg", () => {
    // Fares A>C and B>C. C is not reachable as a first city: 1 prefix rejection.
    // Sequences with first A or B whose last is not C reach evaluate and fail:
    //   A, A>B, A>C>B, B, B>A, B>C>A = 6. Total 1 + 6 = 7.
    const { routes, rejections } = searchRoutes(fareOnly(fare("H", "A", "C", 600, 600, 700), fare("H", "B", "C", 600, 600, 700)));
    expect(routes.map((r) => r.id).sort()).toEqual(
      [
        ["A", "B", "C"],
        ["A", "C"],
        ["B", "A", "C"],
        ["B", "C"],
      ]
        .map((s) => JSON.stringify(s))
        .sort(),
    );
    expect(rejections.missing_home_leg).toBe(7);
  });

  it("prices a fare-only route with the fare and the fare's minutes", () => {
    // A>C: 6 nights across A (2..4) and C (2..4). Lodging 80 + daily 50 = 130/night * 6 = 780,
    // intercity 100, fare 700 -> 1580.00.
    const { routes } = searchRoutes(fareOnly(fare("H", "A", "C", 500, 550, 700)));
    const ac = routes.find((r) => r.id === JSON.stringify(["A", "C"]))!;
    expect(ac.travelerCosts[0]!.total.amountMinor).toBe(158_000);
    expect(ac.metrics.totalTravelMinutes).toBe(60 + 500 + 550);
  });
});

describe("duplicate fares for one (home, outboundTo, returnFrom)", () => {
  const t1 = (...fares: LongHaulFare[]) => best(withFares(miniTrip(), ...fares)).travelerCosts[0]!;

  it("the cheaper wins in either input order", () => {
    const cheap = fare("H1", "A", "B", 600, 600, 900);
    const dear = fare("H1", "A", "B", 600, 600, 950);
    expect(t1(cheap, dear).international.amountMinor).toBe(90_000);
    expect(t1(dear, cheap).international.amountMinor).toBe(90_000);
  });

  it("on equal price and minutes the better source wins in either order", () => {
    const live = fare("H1", "A", "B", 600, 600, 900, "live");
    const est = fare("H1", "A", "B", 600, 600, 900, "estimate");
    expect(t1(live, est).priceSources).toEqual(["live", "synthetic"]);
    expect(t1(est, live).priceSources).toEqual(["live", "synthetic"]);
  });
});

describe("compareInternational", () => {
  const c = (o: Partial<InternationalCandidate>): InternationalCandidate => ({
    priceMinor: 100_000,
    outboundMinutes: 600,
    returnMinutes: 600,
    sources: ["live"],
    ticket: "fare",
    fetchedMs: Number.NEGATIVE_INFINITY,
    ...o,
  });

  it("orders by price, then minutes, then ticket, then worst source, then freshness", () => {
    expect(compareInternational(c({ priceMinor: 1 }), c({ priceMinor: 2 }))).toBeLessThan(0);
    expect(compareInternational(c({ returnMinutes: 500 }), c({}))).toBeLessThan(0);
    expect(compareInternational(c({ ticket: "fare" }), c({ ticket: "one_way_pair" }))).toBeLessThan(0);
    expect(compareInternational(c({ ticket: "one_way_pair" }), c({ ticket: "fare" }))).toBeGreaterThan(0);
    // A pair is as weak as its worst source.
    const mixed = c({ ticket: "fare", sources: ["live", "synthetic"] });
    expect(compareInternational(c({ sources: ["manual"] }), mixed)).toBeLessThan(0);
    expect(compareInternational(mixed, c({ sources: ["manual"] }))).toBeGreaterThan(0);
  });

  it("parses timestamps and treats missing as oldest; only a full tie is 0", () => {
    const at = (s: string) => c({ fetchedMs: Date.parse(s) });
    // Same instant in different notations: equal.
    expect(compareInternational(at("2027-01-01T10:00:00Z"), at("2027-01-01T10:00:00.000Z"))).toBe(0);
    expect(compareInternational(at("2027-01-01T10:00:00Z"), at("2027-01-01T12:00:00+03:00"))).toBeLessThan(0); // 12:00+03:00 is 09:00Z, older
    expect(compareInternational(at("2027-01-01T10:00:00Z"), c({}))).toBeLessThan(0);
    expect(compareInternational(c({}), c({}))).toBe(0);
  });
});

describe("budgets use the chosen international total", () => {
  const withCeiling = (input: TripInput, id: string, cents: number): TripInput => ({
    ...input,
    travelers: input.travelers.map((t) => (t.id === id ? { ...t, budgetCeiling: money(cents, input.currency) } : t)),
  });
  // T1 ceiling 1650.00: fare route total 900 + 690 = 1590.00 fits (headroom 60.00); pair route 1710.00 does not.
  const f = fare("H1", "A", "B", 610, 630, 900);

  it("is feasible only because of the fare", () => {
    const ok = best(withFares(withCeiling(miniTrip(), "T1", 165_000), f));
    expect(ok.travelerCosts[0]!.headroom?.amountMinor).toBe(6_000);

    const without = generateRouteOptions(withCeiling(miniTrip(), "T1", 165_000));
    expect(without.ok).toBe(false);
    if (!without.ok) expect(without.errors[0]?.rejections?.over_budget).toBe(1);
  });

  it("redaction still strips other travelers' headroom when fares are present", () => {
    let input = withFares(withCeiling(miniTrip(), "T1", 200_000), f);
    input = withCeiling(input, "T2", 250_000);
    const route = best(input);
    // T1: 2000.00 - 1590.00 = 410.00. T2: 2500.00 - 1930.00 = 570.00.
    const view = redactForViewer(route, "T2");
    expect(view.travelerCosts[0]).not.toHaveProperty("headroom");
    expect(view.travelerCosts[1]?.headroom?.amountMinor).toBe(57_000);
    expect(view.travelerCosts[0]?.internationalTicket).toBe("fare");
    expect(JSON.stringify(view.travelerCosts[0])).not.toContain("41000");
  });
});

describe("fare validation", () => {
  const codes = (input: TripInput) => validateInput(input).map((e) => [e.code, e.path]);
  const good = fare("H1", "A", "B", 600, 600, 900);

  it("accepts a well-formed fare", () => {
    expect(validateInput(withFares(miniTrip(), good))).toEqual([]);
  });

  it("rejects a home that is no traveler's home", () => {
    expect(codes(withFares(miniTrip(), { ...good, home: "ZZZ" }))).toEqual([["unknown_city", "longHaulFares[0].home"]]);
  });

  it("rejects unknown outboundTo and returnFrom", () => {
    expect(codes(withFares(miniTrip(), { ...good, outboundTo: "X", returnFrom: "Y" }))).toEqual([
      ["unknown_city", "longHaulFares[0].outboundTo"],
      ["unknown_city", "longHaulFares[0].returnFrom"],
    ]);
    // A traveler home id is not a city id.
    expect(codes(withFares(miniTrip(), { ...good, outboundTo: "H2" }))).toEqual([["unknown_city", "longHaulFares[0].outboundTo"]]);
  });

  it("rejects non-finite or non-positive minutes", () => {
    for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codes(withFares(miniTrip(), { ...good, outboundMinutes: bad }))).toEqual([["invalid_leg", "longHaulFares[0].outboundMinutes"]]);
      expect(codes(withFares(miniTrip(), { ...good, returnMinutes: bad }))).toEqual([["invalid_leg", "longHaulFares[0].returnMinutes"]]);
    }
  });

  it("rejects a negative price and a wrong currency", () => {
    const neg = { ...good, pricePerPerson: { ...good.pricePerPerson, price: money(-1, "CAD") } };
    expect(codes(withFares(miniTrip(), neg))).toEqual([["invalid_leg", "longHaulFares[0].pricePerPerson"]]);
    const usd = { ...good, pricePerPerson: { ...good.pricePerPerson, price: money(100, "USD") } };
    expect(codes(withFares(miniTrip(), usd))).toEqual([["currency_mismatch", "longHaulFares[0].pricePerPerson"]]);
  });
});
