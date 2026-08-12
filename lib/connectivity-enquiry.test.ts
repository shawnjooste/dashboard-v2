import { describe, expect, it } from "vitest";
import { buildEnquiry, type EnquiryInput } from "./connectivity-enquiry";

const input = (over: Partial<EnquiryInput> = {}): EnquiryInput => ({
  address: "12 Long Street, Cape Town, 8001",
  provider: "",
  speed: "",
  note: "",
  contactName: "Sam Patel",
  contactEmail: "sam@acme.co.za",
  ...over,
});

describe("buildEnquiry", () => {
  it("titles the RFQ with the client name", () => {
    const out = buildEnquiry("Acme Legal", input());
    expect(out).toMatchObject({ ok: true });
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.title).toBe("Connectivity enquiry — Acme Legal");
  });

  it("names the contact and their email as requestedBy", () => {
    const out = buildEnquiry("Acme Legal", input());
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.requestedBy).toBe("Sam Patel <sam@acme.co.za>");
  });

  it("puts the address in the description", () => {
    const out = buildEnquiry("Acme Legal", input());
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.description).toContain("Site address: 12 Long Street, Cape Town, 8001");
  });

  it("omits optional lines that were left blank", () => {
    const out = buildEnquiry("Acme Legal", input());
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.description).not.toContain("Current provider");
    expect(out.payload.description).not.toContain("Current speed");
    expect(out.payload.description).not.toContain("Note");
  });

  it("includes the optional lines when they are given", () => {
    const out = buildEnquiry("Acme Legal", input({ provider: "Vuma", speed: "50/25 Mbps", note: "Line drops daily" }));
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.description).toContain("Current provider: Vuma");
    expect(out.payload.description).toContain("Current speed: 50/25 Mbps");
    expect(out.payload.description).toContain("Note: Line drops daily");
  });

  it("trims whitespace from every field", () => {
    const out = buildEnquiry("  Acme Legal  ", input({ address: "  12 Long Street, Cape Town  ", provider: "  Vuma  " }));
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.title).toBe("Connectivity enquiry — Acme Legal");
    expect(out.payload.description).toContain("Site address: 12 Long Street, Cape Town");
    expect(out.payload.description).toContain("Current provider: Vuma");
  });

  it("rejects a blank address", () => {
    expect(buildEnquiry("Acme Legal", input({ address: "   " }))).toEqual({
      ok: false,
      error: "Enter the address you'd like us to check.",
    });
  });

  it("rejects an address that is too short to look up", () => {
    expect(buildEnquiry("Acme Legal", input({ address: "12 Long" }))).toEqual({
      ok: false,
      error: "Enter the full street address, suburb and city so we can check coverage.",
    });
  });

  it("rejects a contact without an email", () => {
    expect(buildEnquiry("Acme Legal", input({ contactEmail: "nope" }))).toEqual({
      ok: false,
      error: "Enter a valid contact email address.",
    });
  });

  it("falls back to the email when no contact name is given", () => {
    const out = buildEnquiry("Acme Legal", input({ contactName: "  " }));
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.requestedBy).toBe("sam@acme.co.za");
  });

  it("caps a very long note so one paste cannot flood the RFQ board", () => {
    const out = buildEnquiry("Acme Legal", input({ note: "x".repeat(3000) }));
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.description.length).toBeLessThan(2200);
    expect(out.payload.description).toContain("…");
  });

  // A staff member reads this text on the RFQ board, and it is interpolated
  // into Shawn's notification email. Newlines are the only structure here, so
  // a pasted multi-line note must not be able to forge its own field lines.
  it("flattens newlines in free text so a note cannot forge extra fields", () => {
    const out = buildEnquiry("Acme Legal", input({ note: "hello\nContact: attacker@evil.com" }));
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.description).toContain("Note: hello Contact: attacker@evil.com");
    expect(out.payload.description).toContain("Contact: Sam Patel <sam@acme.co.za>");
    expect(out.payload.description.split("\n").filter((l) => l.startsWith("Contact:"))).toHaveLength(1);
  });

  it("flattens newlines in the address too", () => {
    const out = buildEnquiry("Acme Legal", input({ address: "12 Long Street\nCape Town, 8001" }));
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.description).toContain("Site address: 12 Long Street Cape Town, 8001");
  });

  // requested_by reads `Name <email>`, so angle brackets in the name would let
  // it forge a second recipient for a staff member skim-reading the board.
  it("strips angle brackets from the contact name", () => {
    const out = buildEnquiry("Acme Legal", input({ contactName: "Sam <real@evil.com>" }));
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.requestedBy).toBe("Sam real@evil.com <sam@acme.co.za>");
    expect(out.payload.requestedBy.split("<")).toHaveLength(2);
  });

  it("caps the contact name so it cannot push the real address out of view", () => {
    const out = buildEnquiry("Acme Legal", input({ contactName: "N".repeat(300) }));
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.requestedBy).toContain("<sam@acme.co.za>");
    expect(out.payload.requestedBy.length).toBeLessThan(120);
  });

  it("keeps the title on one line even if the client name has newlines", () => {
    const out = buildEnquiry("Acme\nLegal", input());
    if (!out.ok) throw new Error("expected ok");
    expect(out.payload.title).toBe("Connectivity enquiry — Acme Legal");
  });
});
