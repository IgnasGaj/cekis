import { describe, expect, it } from "vitest";
import { addMonthsClamped, dayPhrase, parseWarranty, remainingDays, validDateOnly, warrantyStatus } from "../../src/lib/warranty";
import { todayInVilnius } from "../../src/lib/purchase-validation";

describe("confirmed warranty calendar rules", () => {
  it.each([
    ["2026-01-31", 1, "2026-02-28"], ["2024-01-31", 1, "2024-02-29"],
    ["2026-01-31", 2, "2026-03-31"], ["2024-02-29", 12, "2025-02-28"],
    ["2024-02-29", 48, "2028-02-29"],
  ])("clamps %s plus %i months to %s", (base, months, end) => expect(addMonthsClamped(base, months)).toBe(end));
  it("rejects malformed and nonfinite dates and durations", () => {
    for (const date of ["2026-02-29", "infinity", "2026-2-01", "0000-01-01", "10000-01-01", "NaN-01-01"]) expect(validDateOnly(date)).toBe(false);
    for (const months of [0, -1, 1.5, 601, Infinity, NaN]) expect(addMonthsClamped("2026-01-31", months)).toBeNull();
  });
  it("requires explicit confirmation and consistent metadata", () => {
    const base = { warrantyState: "known", warrantyEndDate: "2026-02-28", warrantyDurationMonths: "1", warrantySource: "duration", warrantyConfirmed: true };
    expect(parseWarranty({ ...base, warrantyConfirmed: false }, "2026-01-31").value).toBeNull();
    expect(parseWarranty(base, "2026-01-31").value?.warrantyEndDate).toBe("2026-02-28");
    expect(parseWarranty({ ...base, warrantyEndDate: "2026-03-31" }, "2026-01-31").value).toBeNull();
    expect(parseWarranty({ ...base, warrantyDurationMonths: "1.5" }, "2026-01-31").value).toBeNull();
    expect(parseWarranty({ ...base, warrantyDurationMonths: "Infinity" }, "2026-01-31").value).toBeNull();
    expect(parseWarranty({ ...base, warrantyState: "none" }, "2026-01-31").value).toBeNull();
    expect(parseWarranty({ ...base, warrantySource: "date" }, "2026-01-31").value).toBeNull();
    expect(parseWarranty({ ...base, warrantyEndDate: "2025-12-31" }, "2026-01-31").value).toBeNull();
  });
  it("keeps unknown and none separate without a countdown", () => {
    expect(warrantyStatus({ warrantyState: "unknown", warrantyEndDate: null }, "2026-10-06")).toEqual({ label: "Garantija nenurodyta", days: null });
    expect(warrantyStatus({ warrantyState: "none", warrantyEndDate: null }, "2026-10-06")).toEqual({ label: "Pažymėta: garantijos nėra", days: null });
  });
  it("uses inclusive civil days across DST, year change and leap day", () => {
    expect(remainingDays("2026-03-29", "2026-03-28")).toBe(1);
    expect(remainingDays("2026-10-25", "2026-10-24")).toBe(1);
    expect(remainingDays("2027-01-01", "2026-12-31")).toBe(1);
    expect(remainingDays("2024-03-01", "2024-02-29")).toBe(1);
    for (const [days, label] of [[-1, "Pasibaigė"], [0, "Greitai baigsis"], [1, "Greitai baigsis"], [30, "Greitai baigsis"], [31, "Galioja"]] as const) {
      const date = new Date(Date.UTC(2026, 9, 6 + days)).toISOString().slice(0, 10);
      expect(warrantyStatus({ warrantyState: "known", warrantyEndDate: date }, "2026-10-06")).toEqual({ label, days });
    }
  });
  it("uses the Vilnius calendar at midnight across winter, summer and DST", () => {
    expect(todayInVilnius(new Date("2026-01-01T21:59:59Z"))).toBe("2026-01-01");
    expect(todayInVilnius(new Date("2026-01-01T22:00:00Z"))).toBe("2026-01-02");
    expect(todayInVilnius(new Date("2026-06-01T20:59:59Z"))).toBe("2026-06-01");
    expect(todayInVilnius(new Date("2026-06-01T21:00:00Z"))).toBe("2026-06-02");
    expect(todayInVilnius(new Date("2026-03-28T21:59:59Z"))).toBe("2026-03-28");
    expect(todayInVilnius(new Date("2026-03-28T22:00:00Z"))).toBe("2026-03-29");
  });
  it("formats Lithuanian day forms", () => {
    expect(dayPhrase(0)).toBe("Baigiasi šiandien");
    for (const [n, word] of [[1,"diena"],[2,"dienos"],[10,"dienų"],[11,"dienų"],[21,"diena"],[22,"dienos"]] as const) expect(dayPhrase(n)).toBe(`Liko ${n} ${word}`);
  });
});
