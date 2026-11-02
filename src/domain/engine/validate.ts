import { isValidIsoDate, nightIndexOf, nightsBetween } from "../dates/dates";
import type { Money } from "../money/money";
import type { TripInput } from "../trip/types";
import type { EngineError } from "./types";

export const MAX_CANDIDATE_CITIES = 8;

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

  const checkMoney = (m: Money | undefined, path: string) => {
    if (m && m.currency !== input.currency) {
      add({
        code: "currency_mismatch",
        message: `${path} is in ${m.currency} but the trip currency is ${input.currency}`,
        path,
      });
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
    places.add(t.home);
    checkMoney(t.budgetCeiling, `travelers[${i}].budgetCeiling`);
  });

  input.legs.forEach((l, i) => {
    for (const end of ["from", "to"] as const) {
      if (!places.has(l[end])) {
        add({ code: "unknown_city", message: `Leg ${i} ${end} "${l[end]}" is neither a city nor a traveler home`, path: `legs[${i}].${end}` });
      }
    }
    checkMoney(l.pricePerPerson.price, `legs[${i}].pricePerPerson`);
  });

  const costed = new Set<string>();
  input.cityCosts.forEach((cc, i) => {
    if (!cityIds.has(cc.cityId)) add({ code: "unknown_city", message: `cityCosts references unknown city "${cc.cityId}"`, path: `cityCosts[${i}].cityId` });
    if (costed.has(cc.cityId)) add({ code: "duplicate_id", message: `Duplicate cityCosts for "${cc.cityId}"`, path: `cityCosts[${i}]` });
    costed.add(cc.cityId);
    checkMoney(cc.lodgingPerPersonPerNight.price, `cityCosts[${i}].lodgingPerPersonPerNight`);
    checkMoney(cc.dailySpendPerPerson.price, `cityCosts[${i}].dailySpendPerPerson`);
  });
  for (const id of cityIds) {
    if (!costed.has(id)) add({ code: "missing_city_costs", message: `No cityCosts for "${id}"`, path: "cityCosts" });
  }

  input.preferences.forEach((p, i) => {
    if (!cityIds.has(p.cityId)) add({ code: "unknown_city", message: `Preference references unknown city "${p.cityId}"`, path: `preferences[${i}].cityId` });
    if (!travelerIds.has(p.travelerId)) add({ code: "unknown_traveler", message: `Preference references unknown traveler "${p.travelerId}"`, path: `preferences[${i}].travelerId` });
  });

  (input.mustInclude ?? []).forEach((id, i) => {
    if (!cityIds.has(id)) add({ code: "unknown_city", message: `mustInclude references unknown city "${id}"`, path: `mustInclude[${i}]` });
  });

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

  const max = input.maxAlternatives;
  if (max !== undefined && (!Number.isInteger(max) || max < 1)) {
    add({ code: "invalid_option", message: "maxAlternatives must be an integer >= 1", path: "maxAlternatives" });
  }

  return errors;
}
