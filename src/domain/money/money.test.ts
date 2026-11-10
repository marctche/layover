import { describe, expect, it } from "vitest";
import { addMoney, formatMoney, minorToMajorString, money, parseMajorToMinor, sumMoney } from "./money";

describe("money()", () => {
  it("constructs a valid amount", () => {
    expect(money(1500, "CAD")).toEqual({ amountMinor: 1500, currency: "CAD" });
  });

  it("allows negative amounts", () => {
    expect(money(-250, "CAD").amountMinor).toBe(-250);
  });

  it.each([1.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "rejects non-safe-integer amount %s",
    (amount) => {
      expect(() => money(amount, "CAD")).toThrow(RangeError);
    },
  );

  it.each(["cad", "CA", "CADX", "C4D", ""])("rejects currency %j", (currency) => {
    expect(() => money(100, currency)).toThrow(RangeError);
  });
});

describe("addMoney()", () => {
  it("adds amounts in the same currency", () => {
    expect(addMoney(money(100, "CAD"), money(250, "CAD"))).toEqual(money(350, "CAD"));
  });

  it("throws on currency mismatch, naming both codes", () => {
    expect(() => addMoney(money(100, "CAD"), money(100, "JPY"))).toThrowError(/CAD.*JPY/);
  });
});

describe("sumMoney()", () => {
  it("returns zero for an empty list", () => {
    expect(sumMoney([], "EUR")).toEqual(money(0, "EUR"));
  });

  it("sums several amounts", () => {
    const items = [money(100, "CAD"), money(-30, "CAD"), money(905, "CAD")];
    expect(sumMoney(items, "CAD")).toEqual(money(975, "CAD"));
  });

  it("throws on any currency mismatch", () => {
    const items = [money(100, "CAD"), money(100, "USD")];
    expect(() => sumMoney(items, "CAD")).toThrow(Error);
  });
});

describe("formatMoney()", () => {
  it("formats CAD using two minor-unit digits", () => {
    expect(formatMoney(money(1500, "CAD"))).toContain("15.00");
  });

  it("formats JPY with zero minor-unit digits", () => {
    const formatted = formatMoney(money(1500, "JPY"));
    expect(formatted).toContain("1,500");
    expect(formatted).not.toContain(".");
  });

  it("formats negative amounts", () => {
    expect(formatMoney(money(-1500, "CAD"))).toContain("15.00");
  });
});

describe("parseMajorToMinor()", () => {
  it.each([
    ["1200", 120000],
    ["1,200.50", 120050],
    [" 0.1 ", 10],
    ["19.99", 1999],
  ])("parses %j", (input, expected) => {
    expect(parseMajorToMinor(input, "CAD")).toBe(expected);
  });

  it.each(["", "abc", "-5", "1.234", "1e3", "12.", ".5"])("rejects %j", (input) => {
    expect(parseMajorToMinor(input, "CAD")).toBeNull();
  });

  it("uses zero decimals for JPY", () => {
    expect(parseMajorToMinor("5000", "JPY")).toBe(5000);
    expect(parseMajorToMinor("5000.5", "JPY")).toBeNull();
  });

  it("rejects amounts beyond the safe integer range", () => {
    expect(parseMajorToMinor("99999999999999999999", "CAD")).toBeNull();
  });
});

describe("minorToMajorString()", () => {
  it("formats minor units for a form field", () => {
    expect(minorToMajorString(120050, "CAD")).toBe("1200.50");
    expect(minorToMajorString(5000, "JPY")).toBe("5000");
  });
});
