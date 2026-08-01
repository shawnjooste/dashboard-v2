import { describe, expect, it } from "vitest";
import { clientIdForEmail, minutesByTicket } from "./ticket-client-map";

const domains = [
  { client_id: "gsr", domain: "gsrlaw.co.za" },
  { client_id: "concargo", domain: "concargo.com" },
];

describe("clientIdForEmail", () => {
  it("matches on the email domain", () => {
    expect(clientIdForEmail("monique@gsrlaw.co.za", domains)).toBe("gsr");
  });
  it("is case and whitespace insensitive", () => {
    expect(clientIdForEmail("Monique@GSRLaw.co.za ", domains)).toBe("gsr");
  });
  it("returns null for an unregistered domain", () => {
    expect(clientIdForEmail("someone@gmail.com", domains)).toBeNull();
  });
  it("returns null for a missing or malformed address", () => {
    expect(clientIdForEmail(null, domains)).toBeNull();
    expect(clientIdForEmail("not-an-email", domains)).toBeNull();
  });
  it("does not match a subdomain onto the parent", () => {
    expect(clientIdForEmail("a@mail.gsrlaw.co.za", domains)).toBeNull();
  });
});

describe("minutesByTicket", () => {
  it("sums minutes per ticket", () => {
    const m = minutesByTicket([
      { freescout_number: 10, minutes: 30 },
      { freescout_number: 10, minutes: 45 },
      { freescout_number: 11, minutes: 15 },
    ]);
    expect(m.get(10)).toBe(75);
    expect(m.get(11)).toBe(15);
  });
  it("ignores entries with no ticket", () => {
    const m = minutesByTicket([{ freescout_number: null, minutes: 60 }]);
    expect(m.size).toBe(0);
  });
});
