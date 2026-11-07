import { describe, expect, it } from "vitest";
import { money } from "@/domain/money/money";
import { responseFlags, reviewPrices } from "./flags";
import { oneWayRequest, oneWayResponse, option } from "./fixtures.constructed";
import type { Priced, PricedFare, PricedLeg, PriceFlag } from "./types";
import { verifySearchResponse } from "./verify";

const provenance = { provider: "serpapi", searchId: "s", fetchedAt: "2026-11-07T12:00:00Z", adults: 1 } as const;
const cad = (dollars: number) => money(dollars * 100, "CAD");

function leg(id: string, dollars: number, km: number, flags: PriceFlag[] = []): PricedLeg {
  return {
    kind: "one_way",
    id,
    price: cad(dollars),
    km,
    provenance,
    flags,
    originAirport: "BCN",
    destinationAirport: "FCO",
    leg: {
      from: "a",
      to: "b",
      mode: "flight",
      durationMinutes: 100,
      pricePerPerson: { price: cad(dollars), source: "live" },
    },
  };
}

function ticket(id: string, dollars: number, km: number, pair?: number): PricedFare {
  const base: PricedFare = {
    kind: "open_jaw",
    id,
    price: cad(dollars),
    km,
    provenance,
    flags: [],
    outboundOriginAirport: "YYZ",
    returnDestinationAirport: "YYZ",
    fare: {
      home: "ottawa",
      outboundTo: "a",
      returnFrom: "b",
      outboundMinutes: 500,
      returnMinutes: 500,
      pricePerPerson: { price: cad(dollars), source: "live" },
    },
  };
  return pair === undefined ? base : { ...base, oneWayPairPrice: cad(pair) };
}

const codes = (p: Priced | undefined) => p?.flags.map((f) => f.code);
const normal = [leg("a", 100, 1000), leg("b", 110, 1000), leg("c", 120, 1100), leg("d", 90, 900)];

describe("responseFlags", () => {
  const search = (prices: number[]) =>
    verifySearchResponse(oneWayResponse(prices.map((price) => option({ price }))), oneWayRequest, provenance.fetchedAt);

  it("holds a cheapest option far below the rest of its response", () => {
    expect(responseFlags(search([200, 900, 1000, 1100]))).toMatchObject([
      { code: "far_below_response_options", severity: "hold" },
    ]);
  });

  it("does not flag an ordinary spread", () => {
    expect(responseFlags(search([636, 800, 1000, 1100]))).toEqual([]);
  });

  it("needs enough options to compare", () => {
    expect(responseFlags(search([100, 1000, 1000]))).toEqual([]);
  });

  it("returns nothing for a missing search", () => {
    expect(responseFlags({ ok: false, reason: "no_results", detail: "", rejected: [] })).toEqual([]);
  });
});

describe("reviewPrices", () => {
  it("leaves a normal batch alone", () => {
    const { usable, held } = reviewPrices(normal);
    expect(held).toEqual([]);
    expect(usable.flatMap((p) => p.flags)).toEqual([]);
  });

  it("holds a price far below similar routes and leaves the others usable", () => {
    const { usable, held } = reviewPrices([...normal, leg("bad", 20, 1000)]);
    expect(held.map((p) => p.id)).toEqual(["bad"]);
    expect(codes(held[0])).toEqual(["far_below_similar_routes"]);
    expect(usable).toHaveLength(4);
  });

  it("warns on a high price but keeps it usable", () => {
    const { usable, held } = reviewPrices([...normal, leg("high", 500, 1000)]);
    expect(held).toEqual([]);
    expect(codes(usable.find((p) => p.id === "high"))).toEqual(["far_above_similar_routes"]);
  });

  it("compares per km, so a long cheap-looking route is not penalised", () => {
    const { held, usable } = reviewPrices([...normal, leg("long", 330, 3000)]);
    expect(held).toEqual([]);
    expect(codes(usable.find((p) => p.id === "long"))).toEqual([]);
  });

  it("keeps one outlier from hiding another", () => {
    const { held } = reviewPrices([...normal, leg("bad", 20, 1000), leg("worse", 1, 1000)]);
    expect(held.map((p) => p.id).sort()).toEqual(["bad", "worse"]);
  });

  it("does not compare open-jaws with one-ways", () => {
    const { held, usable } = reviewPrices([...normal, ticket("oj", 1000, 12000)]);
    expect(held).toEqual([]);
    expect(codes(usable.find((p) => p.id === "oj"))).toEqual([]);
  });

  it("skips very short hops", () => {
    const { held, usable } = reviewPrices([...normal, leg("hop", 400, 30), leg("hop2", 1, 30)]);
    expect(held).toEqual([]);
    expect(usable.flatMap((p) => p.flags)).toEqual([]);
  });

  it("skips the comparison when there are too few peers", () => {
    expect(reviewPrices([leg("a", 100, 1000), leg("b", 1, 1000)]).held).toEqual([]);
  });

  it("warns when an open-jaw costs more than the matching one-way pair", () => {
    const { usable } = reviewPrices([ticket("oj", 1200, 12000, 1000)]);
    expect(codes(usable[0])).toEqual(["fare_above_one_way_pair"]);
  });

  it("skips the pair check when the one-ways were not searched", () => {
    expect(codes(reviewPrices([ticket("oj", 1200, 12000)]).usable[0])).toEqual([]);
  });

  it("keeps a hold flag raised earlier", () => {
    const flag: PriceFlag = { code: "far_below_response_options", severity: "hold", detail: "" };
    expect(reviewPrices([leg("a", 100, 1000, [flag])]).held.map((p) => p.id)).toEqual(["a"]);
  });

  it("never changes a price", () => {
    const input = [...normal, leg("bad", 20, 1000)];
    const { usable, held } = reviewPrices(input);
    const out = new Map([...usable, ...held].map((p) => [p.id, p.price.amountMinor]));
    for (const p of input) expect(out.get(p.id)).toBe(p.price.amountMinor);
  });
});
