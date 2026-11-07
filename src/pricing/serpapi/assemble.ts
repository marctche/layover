// Turns verified searches into the engine's Leg and LongHaulFare, carrying the
// flags and provenance alongside. Only per-person prices may reach the engine.
import type { Money } from "@/domain/money/money";
import type { Quote } from "@/domain/trip/types";
import { responseFlags } from "./flags";
import type { Missing, PriceFlag, PricedFare, PricedLeg, Provenance, VerifiedOption, VerifiedSearch } from "./types";

const liveQuote = (price: Money, provenance: Provenance): Quote => ({
  price,
  source: "live",
  provider: provenance.provider,
  fetchedAt: provenance.fetchedAt,
});

/**
 * Whether `price` is per person or for the whole party is unconfirmed for more
 * than one adult, so anything but a one-adult search is refused.
 */
function notPerPerson(provenance: Provenance): Missing | null {
  if (provenance.adults === 1) return null;
  return { ok: false, reason: "adults_not_one", detail: `searched ${provenance.adults} adults; per-person pricing is unconfirmed` };
}

const asMissing = (s: Extract<VerifiedSearch, { ok: false }>): Missing => ({ ok: false, reason: s.reason, detail: s.detail });

export function toPricedLeg(
  search: VerifiedSearch,
  place: { id: string; from: string; to: string; km: number },
): { ok: true; priced: PricedLeg } | Missing {
  if (!search.ok) return asMissing(search);
  const refused = notPerPerson(search.provenance);
  if (refused) return refused;

  const best = search.options[0] as VerifiedOption;
  return {
    ok: true,
    priced: {
      kind: "one_way",
      id: place.id,
      price: best.price,
      km: place.km,
      provenance: search.provenance,
      flags: [...best.flags, ...responseFlags(search)],
      originAirport: best.originAirport,
      destinationAirport: best.destinationAirport,
      leg: {
        from: place.from,
        to: place.to,
        mode: "flight",
        durationMinutes: best.totalMinutes,
        pricePerPerson: liveQuote(best.price, search.provenance),
      },
    },
  };
}

/**
 * One ticket from the first call plus its departure_token call. `outbound` must
 * be the option whose token produced `back`, which is the cheapest by default.
 *
 * Google Flights shows the whole ticket's price at each step, so the two prices
 * should match. A difference means we cannot say what the number covers: held.
 */
export function toPricedFare(
  first: VerifiedSearch,
  back: VerifiedSearch,
  place: { id: string; home: string; outboundTo: string; returnFrom: string; km: number; oneWayPairPrice?: Money },
  outbound?: VerifiedOption,
): { ok: true; priced: PricedFare } | Missing {
  if (!first.ok) return asMissing(first);
  if (!back.ok) return asMissing(back);
  const refused = notPerPerson(first.provenance) ?? notPerPerson(back.provenance);
  if (refused) return refused;

  const out = outbound ?? (first.options[0] as VerifiedOption);
  const ret = back.options[0] as VerifiedOption;
  const flags: PriceFlag[] = [...out.flags, ...ret.flags, ...responseFlags(first)];
  if (out.price.amountMinor !== ret.price.amountMinor) {
    flags.push({
      code: "fare_changed_between_calls",
      severity: "hold",
      detail: `first call ${out.price.amountMinor}, return call ${ret.price.amountMinor} (minor units)`,
    });
  }

  const priced: PricedFare = {
    kind: "open_jaw",
    id: place.id,
    price: ret.price,
    km: place.km,
    provenance: back.provenance,
    flags,
    outboundOriginAirport: out.originAirport,
    returnDestinationAirport: ret.destinationAirport,
    fare: {
      home: place.home,
      outboundTo: place.outboundTo,
      returnFrom: place.returnFrom,
      outboundMinutes: out.totalMinutes,
      returnMinutes: ret.totalMinutes,
      pricePerPerson: liveQuote(ret.price, back.provenance),
    },
  };
  if (place.oneWayPairPrice) priced.oneWayPairPrice = place.oneWayPairPrice;
  return { ok: true, priced };
}
