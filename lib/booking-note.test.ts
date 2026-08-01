import { describe, expect, it } from "vitest";
import { bookingCancelledNoteText, bookingNoteText } from "./booking-note";

describe("bookingNoteText", () => {
  const base = {
    serviceName: "Remote support session",
    slotLabel: "Mon 3 Aug, 12:30",
    totalCents: 57500,
    reference: "bk_abc",
    note: "Outlook keeps crashing",
  };
  it("states service, slot and amount", () => {
    const t = bookingNoteText(base);
    expect(t).toContain("Remote support session");
    expect(t).toContain("Mon 3 Aug, 12:30");
    expect(t).toContain("R 575,00");
    expect(t).toContain("bk_abc");
  });
  it("includes the client's note when given", () => {
    expect(bookingNoteText(base)).toContain("Outlook keeps crashing");
  });
  it("omits the note line when absent", () => {
    expect(bookingNoteText({ ...base, note: null })).not.toContain("Client's note");
  });
});

describe("bookingCancelledNoteText", () => {
  it("names the service and slot", () => {
    const t = bookingCancelledNoteText({ serviceName: "Onsite callout", slotLabel: "Tue 4 Aug, 09:00" });
    expect(t).toContain("cancelled");
    expect(t).toContain("Onsite callout");
    expect(t).toContain("Tue 4 Aug, 09:00");
  });
});
