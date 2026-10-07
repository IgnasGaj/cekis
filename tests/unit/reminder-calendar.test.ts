import { describe,expect,it } from "vitest";
import { desiredReminder, insideSendWindow, reminderIdentity, subtractCivilDays } from "../../src/lib/reminder-calendar";

const purchase = { id:"purchase",owner_id:"owner",warranty_state:"known",warranty_end_date:"2028-03-31",
  reminder_mode:"inherit" as const,reminder_offset:null,deleted_at:null };
const preference = { enabled:true,default_offset:30 as const,revision:1,email:"owner@example.test",email_verified:true,reminder_recipient_version:1 };

describe("civil reminder schedule", () => {
  it("subtracts all offsets across leap day and year boundary", () => {
    expect(subtractCivilDays("2028-03-31",30)).toBe("2028-03-01");
    expect(subtractCivilDays("2028-03-31",90)).toBe("2028-01-01");
    expect(subtractCivilDays("2028-03-07",7)).toBe("2028-02-29");
    expect(subtractCivilDays("2027-01-01",7)).toBe("2026-12-25");
  });
  it("queues catch-up through the inclusive end day and skips expired or unconfirmed dates", () => {
    expect(desiredReminder(purchase,preference,"2028-03-31")?.dueDate).toBe("2028-03-01");
    expect(desiredReminder(purchase,preference,"2028-04-01")).toBeNull();
    expect(desiredReminder({ ...purchase,warranty_state:"unknown" },preference,"2028-03-01")).toBeNull();
    expect(desiredReminder({ ...purchase,warranty_state:"none",warranty_end_date:null },preference,"2028-03-01")).toBeNull();
  });
  it("applies global opt-out, inheritance, custom and purchase opt-out", () => {
    expect(desiredReminder(purchase,{ ...preference,enabled:false },"2028-01-01")).toBeNull();
    expect(desiredReminder(purchase,{ ...preference,email_verified:false },"2028-01-01")).toBeNull();
    expect(desiredReminder({ ...purchase,reminder_mode:"off" },preference,"2028-01-01")).toBeNull();
    expect(desiredReminder({ ...purchase,reminder_mode:"custom",reminder_offset:7 },preference,"2028-01-01")?.dueDate).toBe("2028-03-24");
  });
  it("keeps the same identity for unrelated edits and off/on, but changes it for schedule or recipient changes", () => {
    const base = desiredReminder(purchase,preference,"2028-01-01")!.identity;
    expect(base).toBe(reminderIdentity("owner","purchase","2028-03-31",30,1,"OWNER@example.test"));
    expect(desiredReminder({ ...purchase,reminder_mode:"inherit" },preference,"2028-01-01")?.identity).toBe(base);
    expect(desiredReminder({ ...purchase,warranty_end_date:"2028-04-01" },preference,"2028-01-01")?.identity).not.toBe(base);
    expect(desiredReminder(purchase,{ ...preference,default_offset:90 },"2028-01-01")?.identity).not.toBe(base);
    expect(desiredReminder(purchase,{ ...preference,reminder_recipient_version:2 },"2028-01-01")?.identity).not.toBe(base);
  });
  it("uses the Vilnius send window across standard time and DST", () => {
    expect(insideSendWindow(new Date("2026-01-10T06:59:59Z"))).toBe(false);
    expect(insideSendWindow(new Date("2026-01-10T07:00:00Z"))).toBe(true);
    expect(insideSendWindow(new Date("2026-01-10T19:00:00Z"))).toBe(false);
    expect(insideSendWindow(new Date("2026-07-10T05:59:59Z"))).toBe(false);
    expect(insideSendWindow(new Date("2026-07-10T06:00:00Z"))).toBe(true);
    expect(insideSendWindow(new Date("2026-07-10T18:00:00Z"))).toBe(false);
  });
});
