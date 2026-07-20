import { describe, expect, it } from "vitest";
import {
  PENDING_HOLD_MINUTES,
  fmtRands,
  openSlots,
  slotTaken,
  totalCents,
  vatCents,
  type SlotBlocker,
} from "./booking-helpers";

// Fri 2026-07-24 10:00 SAST = 08:00Z
const NOW = new Date("2026-07-24T08:00:00Z");
const mk = (o: Partial<SlotBlocker> = {}): SlotBlocker => ({
  slot_start: o.slot_start ?? "2026-07-27T06:00:00.000Z", // Mon 08:00 SAST
  status: o.status ?? "paid",
  created_at: o.created_at ?? "2026-07-24T07:00:00Z",
});

describe("slotTaken", () => {
  const slot = "2026-07-27T06:00:00.000Z";
  it("paid booking blocks the slot", () => {
    expect(slotTaken(slot, [mk({ status: "paid" })], NOW)).toBe(true);
  });
  it("completed booking blocks the slot", () => {
    expect(slotTaken(slot, [mk({ status: "completed" })], NOW)).toBe(true);
  });
  it("cancelled booking frees the slot", () => {
    expect(slotTaken(slot, [mk({ status: "cancelled" })], NOW)).toBe(false);
  });
  it("fresh pending hold blocks the slot", () => {
    expect(slotTaken(slot, [mk({ status: "pending_payment", created_at: "2026-07-24T07:50:00Z" })], NOW)).toBe(true);
  });
  it("stale pending hold (>30 min) frees the slot", () => {
    expect(slotTaken(slot, [mk({ status: "pending_payment", created_at: "2026-07-24T07:20:00Z" })], NOW)).toBe(false);
  });
  it("a different slot does not block", () => {
    expect(slotTaken("2026-07-27T07:00:00.000Z", [mk()], NOW)).toBe(false);
  });
});

describe("openSlots", () => {
  it("generates 9 hourly slots per business day, weekends excluded", () => {
    const slots = openSlots({ now: NOW, businessDays: 2, blockers: [] });
    expect(slots).toHaveLength(18);
    // NOW is Friday → next business days are Mon 27 + Tue 28
    expect(slots[0].iso).toBe("2026-07-27T06:00:00.000Z"); // Mon 08:00 SAST
    expect(slots[8].iso).toBe("2026-07-27T14:00:00.000Z"); // Mon 16:00 SAST (last)
    expect(slots[9].iso).toBe("2026-07-28T06:00:00.000Z"); // Tue 08:00 SAST
    expect(slots.every((s) => !s.iso.includes("2026-07-25") && !s.iso.includes("2026-07-26"))).toBe(true);
  });
  it("labels slots in SAST", () => {
    const slots = openSlots({ now: NOW, businessDays: 1, blockers: [] });
    expect(slots[0].label).toBe("Mon 27 Jul, 08:00");
    expect(slots[8].label).toBe("Mon 27 Jul, 16:00");
  });
  it("excludes blocked slots", () => {
    const slots = openSlots({ now: NOW, businessDays: 1, blockers: [mk()] });
    expect(slots).toHaveLength(8);
    expect(slots.some((s) => s.iso === "2026-07-27T06:00:00.000Z")).toBe(false);
  });
});

describe("money", () => {
  it("computes 15% VAT in cents", () => {
    expect(vatCents(100000)).toBe(15000);
    expect(vatCents(125000)).toBe(18750);
  });
  it("computes the total", () => {
    expect(totalCents(100000)).toBe(115000);
  });
  it("formats rands with space thousands and comma decimals", () => {
    expect(fmtRands(100000)).toBe("R 1 000,00");
    expect(fmtRands(115000)).toBe("R 1 150,00");
    expect(fmtRands(18750)).toBe("R 187,50");
  });
});

describe("constants", () => {
  it("pending hold is 30 minutes", () => {
    expect(PENDING_HOLD_MINUTES).toBe(30);
  });
});
