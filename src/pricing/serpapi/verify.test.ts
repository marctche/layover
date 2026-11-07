import { describe, expect, it } from "vitest";
import { generateRouteOptions } from "@/domain/engine/generate";
import { europeDryRun } from "@/domain/planner/catalog";
import { planSearches } from "@/domain/planner/plan";
import { miniTrip } from "../../../tests/helpers/builders";
import { toPricedFare, toPricedLeg } from "./assemble";
import {
  openJawOutbound,
  openJawRequest,
  openJawReturn,
  oneWayRequest,
  oneWayResponse,
  option,
  segment,
} from "./fixtures.constructed";
import { requestFromPlan, verifySearchResponse } from "./verify";

const AT = "2026-11-07T12:00:00Z";
const returnRequest = { ...openJawRequest, legIndex: 1 };
const verify = (raw: unknown, req = oneWayRequest) => verifySearchResponse(raw, req, AT);
function passed<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  expect(r.ok).toBe(true);
  return r as Extract<T, { ok: true }>;
}
function failed<T extends { ok: boolean }>(r: T): Extract<T, { ok: false }> {
  expect(r.ok).toBe(false);
  return r as Extract<T, { ok: false }>;
}
const place = { id: "ow:a>b", from: "a", to: "b", km: 6000 };
const fare = { id: "oj:a>b", home: "ottawa", outboundTo: "barcelona", returnFrom: "paris", km: 12000 };

describe("response-level checks: a failed response becomes missing data", () => {
  it("accepts a response matching the request", () => {
    const r = verify(oneWayResponse());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.options[0]).toMatchObject({
      price: { amountMinor: 63600, currency: "CAD" },
      totalMinutes: 735,
      stops: 1,
      originAirport: "YYZ",
      destinationAirport: "BCN",
    });
    expect(r.provenance).toEqual({ provider: "serpapi", searchId: "constructed-search-1", fetchedAt: AT, adults: 1 });
  });

  it("ignores fields it does not know", () => {
    expect(verify({ ...oneWayResponse(), brand_new_field: { a: 1 } }).ok).toBe(true);
  });

  it.each([
    [{ error: "Google Flights hasn't returned any results for this query." }, "no_results"],
    [{ error: "Invalid API key." }, "provider_error"],
    [{ ...oneWayResponse(), search_metadata: { id: "x", status: "Error" } }, "provider_error"],
    [oneWayResponse([]), "no_results"],
    [{}, "malformed_response"],
    [null, "malformed_response"],
    ["<html>", "malformed_response"],
    [oneWayResponse([option()], { currency: "USD" }), "request_mismatch"],
    [oneWayResponse([option()], { adults: 2 }), "request_mismatch"],
    [oneWayResponse([option()], { type: "1" }), "request_mismatch"],
    [oneWayResponse([option()], { arrival_id: "MAD" }), "request_mismatch"],
    [oneWayResponse([option()], { departure_id: "YOW" }), "request_mismatch"],
    [oneWayResponse([option()], { outbound_date: "2026-12-11" }), "request_mismatch"],
  ])("%j is missing: %s", (raw, reason) => {
    expect(failed(verify(raw)).reason).toBe(reason);
  });

  it("treats airport lists as sets and numeric echoes as numbers", () => {
    const r = verify(oneWayResponse([option()], { departure_id: "YUL,YOW,YYZ", type: 2, adults: "1" }));
    expect(r.ok).toBe(true);
  });

  it("rejects a multi-city echo that differs or cannot be read", () => {
    const raw = openJawOutbound();
    const changed = JSON.stringify([
      { departure_id: "YOW,YYZ,YUL", arrival_id: "BCN", date: "2026-12-10" },
      { departure_id: "FCO", arrival_id: "YOW,YYZ,YUL", date: "2026-12-23" },
    ]);
    for (const multi_city_json of [changed, "not json", "[]"]) {
      const r = verify({ ...raw, search_parameters: { ...raw.search_parameters, multi_city_json } }, openJawRequest);
      expect(r).toMatchObject({ ok: false, reason: "request_mismatch" });
    }
  });

  it("clips provider error text", () => {
    expect(failed(verify({ error: "x".repeat(5000) })).detail.length).toBe(200);
  });
});

describe("option-level checks: a bad option is dropped, the rest survive", () => {
  const nonstop = (from: string, to: string, date = "2026-12-10") => ({
    flights: [segment([from, `${date} 18:00`], [to, `${date} 23:00`], 300)],
    total_duration: 300,
    price: 900,
  });

  it.each([
    ["no price", option({ price: undefined }), "bad_price"],
    ["zero price", option({ price: 0 }), "bad_price"],
    ["negative price", option({ price: -10 }), "bad_price"],
    ["fractional price", option({ price: 636.5 }), "bad_price"],
    ["string price", option({ price: "636" }), "malformed_option"],
    ["no segments", option({ flights: [] }), "malformed_option"],
    ["wrong origin", nonstop("JFK", "BCN"), "wrong_origin"],
    ["wrong destination", nonstop("YYZ", "MAD"), "wrong_destination"],
    ["wrong date", nonstop("YYZ", "BCN", "2026-12-11"), "wrong_date"],
    ["durations disagree", option({ total_duration: 900 }), "duration_mismatch"],
  ])("%s", (_, bad, reason) => {
    const r = verify(oneWayResponse([bad, option()]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.options).toHaveLength(1);
    expect(r.options[0]?.price.amountMinor).toBe(63600);
    expect(r.rejected[0]?.reason).toBe(reason);
  });

  it("is missing when every option fails, and says why", () => {
    const r = failed(verify(oneWayResponse([option({ price: 0 }), option({ price: -1 })])));
    expect(r.reason).toBe("no_valid_options");
    expect(r.rejected).toHaveLength(2);
  });

  it("a duration within tolerance passes", () => {
    expect(verify(oneWayResponse([option({ total_duration: 737 })])).ok).toBe(true);
  });

  it("flags an airport change at a connection instead of rejecting the fare", () => {
    const flights = [
      segment(["YYZ", "2026-12-10 18:00"], ["JFK", "2026-12-10 19:30"], 90),
      segment(["LGA", "2026-12-10 22:00"], ["BCN", "2026-12-11 10:00"], 480),
    ];
    const r = passed(verify(oneWayResponse([{ flights, layovers: [{ duration: 150 }], total_duration: 720, price: 700 }])));
    expect(r.options[0]?.flags).toMatchObject([{ code: "airport_change_connection", severity: "warn" }]);
  });

  it("sorts cheapest first and breaks ties on time", () => {
    const r = passed(verify(oneWayResponse([nonstop("YYZ", "BCN"), option({ price: 900 }), option({ price: 700 })])));
    expect(r.options.map((o) => [o.price.amountMinor, o.totalMinutes])).toEqual([[70000, 735], [90000, 300], [90000, 735]]);
  });

  it("uses the currency's real minor unit", () => {
    const raw = oneWayResponse([option({ price: 50000 })], { currency: "JPY" });
    const r = passed(verify(raw, { ...oneWayRequest, currency: "JPY" }));
    expect(r.options[0]?.price).toEqual({ amountMinor: 50000, currency: "JPY" });
  });
});

describe("planner searches", () => {
  it("checks a response against the exact search the planner made", () => {
    const plan = planSearches(europeDryRun);
    if (!plan.ok) throw new Error("plan failed");
    const openJaw = plan.searches.find((s) => s.kind === "open_jaw");
    const oneWay = plan.searches.find((s) => s.kind === "one_way");
    expect(requestFromPlan(openJaw!, 1, "CAD", 1)).toMatchObject({ kind: "multi_city", legIndex: 1 });
    expect(requestFromPlan(oneWay!, 0, "CAD", 1)).toMatchObject({ kind: "one_way", legs: oneWay!.legs });
  });
});

describe("assembling engine input", () => {
  it("builds a live Leg with source metadata", () => {
    const r = passed(toPricedLeg(verify(oneWayResponse()), place));
    expect(r.priced.leg).toEqual({
      from: "a",
      to: "b",
      mode: "flight",
      durationMinutes: 735,
      pricePerPerson: { price: { amountMinor: 63600, currency: "CAD" }, source: "live", provider: "serpapi", fetchedAt: AT },
    });
    expect(r.priced.originAirport).toBe("YYZ");
  });

  it("passes a miss through with no price anywhere on it", () => {
    const r = toPricedLeg(verify({ error: "Invalid API key." }), place);
    expect(r).toEqual({ ok: false, reason: "provider_error", detail: "Invalid API key." });
  });

  it("refuses a search for more than one adult", () => {
    const raw = oneWayResponse([option()], { adults: 2 });
    const r = toPricedLeg(verifySearchResponse(raw, { ...oneWayRequest, adults: 2 }, AT), place);
    expect(r).toMatchObject({ ok: false, reason: "adults_not_one" });
  });

  it("builds one ticket from an outbound call and its token call", () => {
    const out = verifySearchResponse(openJawOutbound(), openJawRequest, AT);
    const back = verifySearchResponse(openJawReturn(), returnRequest, AT);
    const r = passed(toPricedFare(out, back, fare));
    expect(r.priced.price.amountMinor).toBe(100300);
    expect(r.priced.flags).toEqual([]);
    expect(r.priced.fare).toMatchObject({ outboundMinutes: 605, returnMinutes: 500, home: "ottawa" });
    expect(r.priced.outboundOriginAirport).toBe("YYZ");
    expect(r.priced.returnDestinationAirport).toBe("YYZ");
  });

  it("holds a ticket whose price differs between the two calls", () => {
    const out = verifySearchResponse(openJawOutbound(1003), openJawRequest, AT);
    const back = verifySearchResponse(openJawReturn(1250), returnRequest, AT);
    const r = passed(toPricedFare(out, back, fare));
    expect(r.priced.flags).toMatchObject([{ code: "fare_changed_between_calls", severity: "hold" }]);
  });

  it("is missing when either call failed", () => {
    const out = verifySearchResponse(openJawOutbound(), openJawRequest, AT);
    const back = verifySearchResponse({ error: "boom" }, returnRequest, AT);
    expect(toPricedFare(out, back, fare)).toMatchObject({ ok: false, reason: "provider_error" });
  });

  it("a missing price leaves the leg out, and the engine reports the route as infeasible", () => {
    const input = { ...miniTrip(), mustInclude: ["A", "B"] };
    expect(generateRouteOptions(input).ok).toBe(true);
    const unpriced = { ...input, legs: input.legs.filter((l) => !(l.from === "A" && l.to === "B")) };
    expect(generateRouteOptions(unpriced)).toMatchObject({ ok: false });
  });
});
