// Shapes of the SerpApi Google Flights fields we rely on. Loose on purpose: new
// provider fields must not break parsing, and only the fields we use are checked.
import { z } from "zod";

const airportStop = z.looseObject({
  id: z.string().min(1),
  /** "YYYY-MM-DD HH:MM", local to the airport. */
  time: z.string().min(10),
});

const segment = z.looseObject({
  departure_airport: airportStop,
  arrival_airport: airportStop,
  duration: z.number().int().positive(),
  airline: z.string().optional(),
});

/** Parsed one option at a time, so a bad option does not sink the response. */
export const optionSchema = z.looseObject({
  flights: z.array(segment).min(1),
  layovers: z.array(z.looseObject({ duration: z.number().int().nonnegative() })).optional(),
  total_duration: z.number().int().positive(),
  price: z.number().optional(),
  departure_token: z.string().min(1).optional(),
  booking_token: z.string().min(1).optional(),
});

export type RawOption = z.infer<typeof optionSchema>;

export const envelopeSchema = z.looseObject({
  search_metadata: z.looseObject({ id: z.string().min(1), status: z.string() }),
  search_parameters: z.looseObject({
    type: z.union([z.string(), z.number()]),
    currency: z.string(),
    adults: z.union([z.string(), z.number()]),
    departure_id: z.string().optional(),
    arrival_id: z.string().optional(),
    outbound_date: z.string().optional(),
    multi_city_json: z.string().optional(),
  }),
  best_flights: z.array(z.unknown()).optional(),
  other_flights: z.array(z.unknown()).optional(),
});

export type Envelope = z.infer<typeof envelopeSchema>;

/** The legs inside the echoed `multi_city_json` string. */
export const echoedLegsSchema = z.array(
  z.looseObject({ departure_id: z.string(), arrival_id: z.string(), date: z.string() }),
);
