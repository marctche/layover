// HAND-CONSTRUCTED TEST DATA, NOT CAPTURED RESPONSES. These follow the provider's
// documented response shape. Every id, time and price here is illustrative.
import type { SearchRequest } from "./types";

type Stop = [id: string, time: string];

export const segment = (from: Stop, to: Stop, duration: number, airline = "Test Air") => ({
  departure_airport: { name: from[0], id: from[0], time: from[1] },
  arrival_airport: { name: to[0], id: to[0], time: to[1] },
  duration,
  airline,
});

export const option = (over: Record<string, unknown> = {}) => ({
  flights: [
    segment(["YYZ", "2026-12-10 18:00"], ["LIS", "2026-12-11 06:20"], 440, "Tap Air Portugal"),
    segment(["LIS", "2026-12-11 09:20"], ["BCN", "2026-12-11 12:15"], 115, "Tap Air Portugal"),
  ],
  layovers: [{ duration: 180, name: "Lisbon", id: "LIS" }],
  total_duration: 735,
  price: 636,
  type: "One way",
  ...over,
});

const metadata = { id: "constructed-search-1", status: "Success" };

export const oneWayRequest: SearchRequest = {
  kind: "one_way",
  legs: [{ from: ["YOW", "YYZ", "YUL"], to: ["BCN"], date: "2026-12-10" }],
  legIndex: 0,
  currency: "CAD",
  adults: 1,
};

export const oneWayResponse = (options: unknown[] = [option()], over: Record<string, unknown> = {}) => ({
  search_metadata: metadata,
  search_parameters: {
    engine: "google_flights",
    hl: "en",
    gl: "ca",
    type: "2",
    departure_id: "YOW,YYZ,YUL",
    arrival_id: "BCN",
    outbound_date: "2026-12-10",
    travel_class: 1,
    adults: 1,
    currency: "CAD",
    ...over,
  },
  best_flights: options,
});

export const openJawRequest: SearchRequest = {
  kind: "multi_city",
  legs: [
    { from: ["YOW", "YYZ", "YUL"], to: ["BCN"], date: "2026-12-10" },
    { from: ["CDG", "ORY"], to: ["YOW", "YYZ", "YUL"], date: "2026-12-23" },
  ],
  legIndex: 0,
  currency: "CAD",
  adults: 1,
};

const multiCityParams = {
  engine: "google_flights",
  hl: "en",
  gl: "ca",
  type: "3",
  travel_class: 1,
  adults: 1,
  currency: "CAD",
  multi_city_json: JSON.stringify([
    { departure_id: "YOW,YYZ,YUL", arrival_id: "BCN", date: "2026-12-10" },
    { departure_id: "CDG,ORY", arrival_id: "YOW,YYZ,YUL", date: "2026-12-23" },
  ]),
};

export const openJawOutbound = (price = 1003) => ({
  search_metadata: metadata,
  search_parameters: multiCityParams,
  best_flights: [
    {
      flights: [
        segment(["YYZ", "2026-12-10 16:00"], ["YUL", "2026-12-10 17:30"], 90, "Air Canada"),
        segment(["YUL", "2026-12-10 18:30"], ["BCN", "2026-12-11 08:05"], 455, "Air Canada"),
      ],
      layovers: [{ duration: 60, name: "Montreal", id: "YUL" }],
      total_duration: 605,
      price,
      departure_token: "constructed-token",
    },
  ],
});

export const openJawReturn = (price = 1003) => ({
  search_metadata: { ...metadata, id: "constructed-search-2" },
  search_parameters: { ...multiCityParams, departure_token: "constructed-token" },
  best_flights: [
    {
      flights: [segment(["CDG", "2026-12-23 10:00"], ["YYZ", "2026-12-23 12:20"], 500, "Air Canada")],
      total_duration: 500,
      price,
    },
  ],
});
