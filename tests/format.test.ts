import { describe, expect, it } from "vitest";
import { fmtDateIST, fmtDateTime } from "@/lib/format";
import { nextScheduledRun } from "@/lib/schedule";

describe("fmtDateTime shows Indian time (UTC+05:30)", () => {
  it("shifts UTC by 5 h 30 min and labels it IST", () => {
    expect(fmtDateTime("2026-10-11T05:38:00Z")).toBe("11 Oct 2026, 11:08 IST");
    expect(fmtDateTime(new Date("2026-10-12T04:00:00Z"))).toBe("12 Oct 2026, 09:30 IST");
  });
  it("rolls the date over when the shift crosses midnight, including month and year ends", () => {
    expect(fmtDateTime("2026-10-11T20:00:00Z")).toBe("12 Oct 2026, 01:30 IST");
    expect(fmtDateTime("2026-12-31T19:00:00Z")).toBe("1 Jan 2027, 00:30 IST");
  });
  it("accepts Postgres-style timestamps and rejects garbage", () => {
    expect(fmtDateTime("2026-10-10 22:16:20.5+00")).toBe("11 Oct 2026, 03:46 IST");
    expect(fmtDateTime("nope")).toBe("—");
    expect(fmtDateTime(null)).toBe("—");
  });
  it("is independent of the machine's time zone (no daylight saving to get wrong)", () => {
    for (const m of [1, 6]) expect(fmtDateTime(`2026-0${m}-15T12:00:00Z`)).toMatch(/17:30 IST$/);
  });
  it("fmtDateIST gives the date alone, with no stray comma for single-digit days", () => {
    expect(fmtDateIST("2026-10-04T10:00:00Z")).toBe("4 Oct 2026");
    expect(fmtDateIST("2026-10-12T04:00:00Z")).toBe("12 Oct 2026");
  });
  it("the Mon/Thu 04:00 UTC cron displays as 09:30 IST", () => {
    expect(fmtDateTime(nextScheduledRun(new Date("2026-10-11T12:00:00Z")))).toBe("12 Oct 2026, 09:30 IST");
  });
});
