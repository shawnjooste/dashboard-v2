import { describe, expect, it } from "vitest";
import { decideCreateStatus, decideAmendStatus, canSendFrom, canRetryDelivery, type Actor } from "./policy.ts";

const sender: Actor = { id: "p1", label: "shawn@rocking.one", canSend: true };
const gated: Actor = { id: null, label: "Hermes", canSend: false };

describe("create/amend never produce 'sent'", () => {
  it("a gated caller always lands in review", () => {
    expect(decideCreateStatus(gated)).toBe("pending_review");
    expect(decideAmendStatus(gated)).toBe("pending_review");
  });
  it("a sender lands in draft — only send() may set 'sent'", () => {
    expect(decideCreateStatus(sender)).toBe("draft");
    expect(decideAmendStatus(sender)).toBe("draft");
  });
});

describe("canSendFrom", () => {
  it("allows the reviewable states", () => {
    expect(canSendFrom("pending_review")).toBe(true);
    expect(canSendFrom("draft")).toBe(true);
  });
  it("refuses states the client has already acted on", () => {
    for (const s of ["accepted", "rejected", "changes_requested", "expired"] as const) {
      expect(canSendFrom(s)).toBe(false);
    }
  });
  it("refuses a quote already sent — that is the retry path, not this one", () => {
    expect(canSendFrom("sent")).toBe(false);
  });
});

describe("canRetryDelivery", () => {
  it("allows retry when the send event never got a Resend id", () => {
    expect(canRetryDelivery("sent", null)).toBe(true);
  });
  it("refuses retry once delivery was confirmed", () => {
    expect(canRetryDelivery("sent", "<abc@send.rocking.one>")).toBe(false);
  });
  it("is irrelevant for a quote that was never sent", () => {
    expect(canRetryDelivery("draft", null)).toBe(false);
  });
});
