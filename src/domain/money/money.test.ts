import { describe, expect, it } from "vitest";
import { addMoney, formatMoney, money, sumMoney } from "./money";

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
