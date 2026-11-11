import { isValidIsoDate, nightIndexOf, nightsBetween } from "../dates/dates";
import type { Money } from "../money/money";
import type { TripInput } from "../trip/types";
import type { EngineError } from "./types";

export const MAX_CANDIDATE_CITIES = 8;
/** Night allocation grows with the square of trip length; group trips rarely exceed two months. */
export const MAX_TRIP_NIGHTS = 60;

/** Collects every problem rather than stopping at the first. */
export function validateInput(input: TripInput): EngineError[] {
  const errors: EngineError[] = [];
  const add = (e: EngineError) => errors.push(e);

  if (input.cities.length > MAX_CANDIDATE_CITIES) {
    add({
      code: "too_many_cities",
      message: `${input.cities.length} candidate cities supplied; the limit is ${MAX_CANDIDATE_CITIES}. Narrow the list before generating routes.`,
      path: "cities",
    });
  }

  const startOk = isValidIsoDate(input.startDate);
  const endOk = isValidIsoDate(input.endDate);
  if (!startOk) add({ code: "invalid_date", message: `startDate "${input.startDate}" is not a valid ISO date`, path: "startDate" });
  if (!endOk) add({ code: "invalid_date", message: `endDate "${input.endDate}" is not a valid ISO date`, path: "endDate" });
  const totalNights = startOk && endOk ? nightsBetween(input.startDate, input.endDate) : null;
  if (totalNights !== null && totalNights <= 0) {
    add({ code: "dates_reversed", message: "endDate must be after startDate", path: "endDate" });
  }
  if (totalNights !== null && totalNights > MAX_TRIP_NIGHTS) {
    add({
      code: "trip_too_long",
      message: `The trip is ${totalNights} nights; the limit is ${MAX_TRIP_NIGHTS}. Shorten the date window or split the trip.`,
      path: "endDate",
    });
  }

  const checkMoney = (m: Money | undefined, path: string, negativeCode?: EngineError["code"]) => {
    if (m && m.currency !== input.currency) {
      add({
        code: "currency_mismatch",
        message: `${path} is in ${m.currency} but the trip currency is ${input.currency}`,
        path,
      });
    }
    if (m && negativeCode && m.amountMinor < 0) {
      add({ code: negativeCode, message: `${path} is negative (${m.amountMinor} minor units)`, path });
    }
  };

  const cityIds = new Set<string>();
  input.cities.forEach((c, i) => {
    if (cityIds.has(c.id)) add({ code: "duplicate_id", message: `Duplicate city id "${c.id}"`, path: `cities[${i}]` });
    cityIds.add(c.id);
    if (!Number.isInteger(c.minNights) || c.minNights < 1) {
      add({ code: "invalid_city", message: `City "${c.id}" minNights must be an integer >= 1`, path: `cities[${i}].minNights` });
    }
    if (c.maxNights !== undefined && (!Number.isInteger(c.maxNights) || c.maxNights < c.minNights)) {
      add({ code: "invalid_city", message: `City "${c.id}" maxNights must be an integer >= minNights`, path: `cities[${i}].maxNights` });
    }
  });

  if (input.travelers.length === 0) add({ code: "no_travelers", message: "At least one traveler is required", path: "travelers" });
  const travelerIds = new Set<string>();
  const places = new Set<string>(cityIds);
  input.travelers.forEach((t, i) => {
    if (travelerIds.has(t.id)) add({ code: "duplicate_id", message: `Duplicate traveler id "${t.id}"`, path: `travelers[${i}]` });
    travelerIds.add(t.id);
    if (cityIds.has(t.home)) {
      add({
        code: "home_is_city",
        message: `Traveler "${t.id}" has home "${t.home}", which is also a candidate city id; home and city ids must differ`,
        path: `travelers[${i}].home`,
      });
    }
    places.add(t.home);
    checkMoney(t.budgetCeiling, `travelers[${i}].budgetCeiling`, "invalid_budget");
  });

  input.legs.forEach((l, i) => {
    for (const end of ["from", "to"] as const) {
      if (!places.has(l[end])) {
        add({ code: "unknown_city", message: `Leg ${i} ${end} "${l[end]}" is neither a city nor a traveler home`, path: `legs[${i}].${end}` });
      }
    }
    checkMoney(l.pricePerPerson.price, `legs[${i}].pricePerPerson`, "invalid_leg");
    if (!Number.isFinite(l.durationMinutes) || l.durationMinutes <= 0) {
      add({ code: "invalid_leg", message: `Leg ${i} durationMinutes must be a positive number, got ${l.durationMinutes}`, path: `legs[${i}].durationMinutes` });
    }
  });

  const homes = new Set(input.travelers.map((t) => t.home));
  (input.longHaulFares ?? []).forEach((f, i) => {
    if (!homes.has(f.home)) {
      add({ code: "unknown_city", message: `Fare ${i} home "${f.home}" is not any traveler's home`, path: `longHaulFares[${i}].home` });
    }
    for (const end of ["outboundTo", "returnFrom"] as const) {
      if (!cityIds.has(f[end])) {
        add({ code: "unknown_city", message: `Fare ${i} ${end} "${f[end]}" is not a city id`, path: `longHaulFares[${i}].${end}` });
      }
    }
    checkMoney(f.pricePerPerson.price, `longHaulFares[${i}].pricePerPerson`, "invalid_leg");
    for (const dir of ["outboundMinutes", "returnMinutes"] as const) {
      if (!Number.isFinite(f[dir]) || f[dir] <= 0) {
        add({ code: "invalid_leg", message: `Fare ${i} ${dir} must be a positive number, got ${f[dir]}`, path: `longHaulFares[${i}].${dir}` });
      }
    }
  });

  const costed = new Set<string>();
  input.cityCosts.forEach((cc, i) => {
    if (!cityIds.has(cc.cityId)) add({ code: "unknown_city", message: `cityCosts references unknown city "${cc.cityId}"`, path: `cityCosts[${i}].cityId` });
    if (costed.has(cc.cityId)) add({ code: "duplicate_id", message: `Duplicate cityCosts for "${cc.cityId}"`, path: `cityCosts[${i}]` });
    costed.add(cc.cityId);
    checkMoney(cc.lodgingPerPersonPerNight.price, `cityCosts[${i}].lodgingPerPersonPerNight`, "invalid_cost");
    checkMoney(cc.dailySpendPerPerson.price, `cityCosts[${i}].dailySpendPerPerson`, "invalid_cost");
  });
  for (const id of cityIds) {
    if (!costed.has(id)) add({ code: "missing_city_costs", message: `No cityCosts for "${id}"`, path: "cityCosts" });
  }

  const scored = new Set<string>();
  input.preferences.forEach((p, i) => {
    const score: number = p.score;
    if (!Number.isInteger(score) || score < -2 || score > 2) {
      add({ code: "invalid_preference", message: `Preference score must be an integer from -2 to 2, got ${score}`, path: `preferences[${i}].score` });
    }
    const pair = JSON.stringify([p.travelerId, p.cityId]);
    if (scored.has(pair)) {
      add({ code: "duplicate_id", message: `Duplicate preference for traveler "${p.travelerId}" and city "${p.cityId}"`, path: `preferences[${i}]` });
    }
    scored.add(pair);
    if (!cityIds.has(p.cityId)) add({ code: "unknown_city", message: `Preference references unknown city "${p.cityId}"`, path: `preferences[${i}].cityId` });
    if (!travelerIds.has(p.travelerId)) add({ code: "unknown_traveler", message: `Preference references unknown traveler "${p.travelerId}"`, path: `preferences[${i}].travelerId` });
  });

  (input.mustInclude ?? []).forEach((id, i) => {
    if (!cityIds.has(id)) add({ code: "unknown_city", message: `mustInclude references unknown city "${id}"`, path: `mustInclude[${i}]` });
  });

  (input.accepted ?? []).forEach((id, i) => {
    if (!cityIds.has(id)) add({ code: "unknown_city", message: `accepted references unknown city "${id}"`, path: `accepted[${i}]` });
  });

  const locked = input.lockedOrder ?? [];
  const lockSeen = new Set<string>();
  locked.forEach((id, i) => {
    if (!cityIds.has(id)) add({ code: "unknown_city", message: `lockedOrder references unknown city "${id}"`, path: `lockedOrder[${i}]` });
    if (lockSeen.has(id)) add({ code: "duplicate_id", message: `lockedOrder lists "${id}" more than once`, path: `lockedOrder[${i}]` });
    lockSeen.add(id);
  });
  const { startCity, endCity } = input;
  if (startCity !== undefined && !cityIds.has(startCity)) {
    add({ code: "unknown_city", message: `startCity references unknown city "${startCity}"`, path: "startCity" });
  }
  if (endCity !== undefined && !cityIds.has(endCity)) {
    add({ code: "unknown_city", message: `endCity references unknown city "${endCity}"`, path: "endCity" });
  }
  if (startCity !== undefined && startCity === endCity && input.cities.length > 1) {
    add({
      code: "invalid_option",
      message: `startCity and endCity are both "${startCity}", but a route over ${input.cities.length} candidate cities cannot begin and end in the same city`,
      path: "endCity",
    });
  }
  if (startCity !== undefined && locked.includes(startCity) && locked[0] !== startCity) {
    add({ code: "invalid_option", message: `startCity "${startCity}" is in lockedOrder but is not its first entry ("${locked[0]}")`, path: "startCity" });
  }
  if (endCity !== undefined && locked.includes(endCity) && locked[locked.length - 1] !== endCity) {
    add({ code: "invalid_option", message: `endCity "${endCity}" is in lockedOrder but is not its last entry ("${locked[locked.length - 1]}")`, path: "endCity" });
  }

  input.fixedEvents.forEach((e, i) => {
    if (!cityIds.has(e.cityId)) add({ code: "unknown_city", message: `Event "${e.id}" references unknown city "${e.cityId}"`, path: `fixedEvents[${i}].cityId` });
    if (!isValidIsoDate(e.startDate) || !isValidIsoDate(e.endDate)) {
      add({ code: "invalid_date", message: `Event "${e.id}" has an invalid date`, path: `fixedEvents[${i}]` });
      return;
    }
    if (e.endDate < e.startDate) {
      add({ code: "dates_reversed", message: `Event "${e.id}" ends before it starts`, path: `fixedEvents[${i}]` });
      return;
    }
    if (startOk && totalNights !== null && totalNights > 0) {
      const first = nightIndexOf(input.startDate, e.startDate);
      const last = nightIndexOf(input.startDate, e.endDate);
      if (first < 0 || last > totalNights - 1) {
        add({
          code: "event_out_of_range",
          message: `Event "${e.id}" needs nights outside the trip (nights 0..${totalNights - 1}); the last night is ${totalNights - 1} because the trip ends on the morning of ${input.endDate}`,
          path: `fixedEvents[${i}]`,
        });
      }
    }
  });

  // Two cities cannot both host the group on the same night.
  const spans = input.fixedEvents.filter(
    (e) => isValidIsoDate(e.startDate) && isValidIsoDate(e.endDate) && e.endDate >= e.startDate,
  );
  for (let a = 0; a < spans.length; a++) {
    for (let b = a + 1; b < spans.length; b++) {
      const x = spans[a]!;
      const y = spans[b]!;
      if (x.cityId !== y.cityId && x.startDate <= y.endDate && y.startDate <= x.endDate) {
        add({
          code: "events_conflict",
          message: `Events "${x.id}" (${x.cityId}) and "${y.id}" (${y.cityId}) need the group in two cities on the same night`,
          path: "fixedEvents",
        });
      }
    }
  }

  const max = input.maxAlternatives;
  if (max !== undefined && (!Number.isInteger(max) || max < 1)) {
    add({ code: "invalid_option", message: "maxAlternatives must be an integer >= 1", path: "maxAlternatives" });
  }

  return errors;
}
