import { describe, expect, it } from "vitest";
import { dateOfNight, isValidIsoDate, nightIndexOf, nightsBetween } from "./dates";

describe("nightsBetween", () => {
  it("counts nights inside a month", () => {
    expect(nightsBetween("2027-06-01", "2027-06-15")).toBe(14);
  });
  it("crosses month and year boundaries", () => {
    expect(nightsBetween("2027-06-28", "2027-07-03")).toBe(5);
    expect(nightsBetween("2027-12-30", "2028-01-02")).toBe(3);
  });
  it("handles leap years", () => {
    expect(nightsBetween("2028-02-28", "2028-03-01")).toBe(2);
    expect(nightsBetween("2027-02-28", "2027-03-01")).toBe(1);
  });
  it("is negative when reversed and zero when equal", () => {
    expect(nightsBetween("2027-06-15", "2027-06-01")).toBe(-14);
    expect(nightsBetween("2027-06-01", "2027-06-01")).toBe(0);
  });
  it("throws on malformed or impossible dates", () => {
    expect(() => nightsBetween("2027-02-30", "2027-03-01")).toThrow(RangeError);
    expect(() => nightsBetween("2027-6-1", "2027-06-02")).toThrow(RangeError);
  });
});

describe("nightIndexOf", () => {
  it("is 0 on the start date", () => {
    expect(nightIndexOf("2027-06-01", "2027-06-01")).toBe(0);
  });
  it("maps the concert date to night 11", () => {
    expect(nightIndexOf("2027-06-01", "2027-06-12")).toBe(11);
  });
  it("works across a month boundary", () => {
    expect(nightIndexOf("2027-05-30", "2027-06-02")).toBe(3);
  });
});

describe("dateOfNight", () => {
  it("inverts nightIndexOf", () => {
    for (const date of ["2027-06-01", "2027-06-12", "2027-06-14"]) {
      expect(dateOfNight("2027-06-01", nightIndexOf("2027-06-01", date))).toBe(date);
    }
  });
  it("rolls over months, years and leap days", () => {
    expect(dateOfNight("2027-06-28", 3)).toBe("2027-07-01");
    expect(dateOfNight("2027-12-31", 1)).toBe("2028-01-01");
    expect(dateOfNight("2028-02-28", 1)).toBe("2028-02-29");
  });
  it("rejects fractional indices", () => {
    expect(() => dateOfNight("2027-06-01", 1.5)).toThrow(RangeError);
  });
});

describe("isValidIsoDate", () => {
  it("accepts real dates and rejects the rest", () => {
    expect(isValidIsoDate("2028-02-29")).toBe(true);
    expect(isValidIsoDate("2027-02-29")).toBe(false);
    expect(isValidIsoDate("June 1")).toBe(false);
  });
});
