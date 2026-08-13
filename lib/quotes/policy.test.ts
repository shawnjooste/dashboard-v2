import { describe, expect, it } from "vitest";
import { decideCreateStatus, decideAmendStatus, canSendFrom, canRetryDelivery, CLAIM_LEASE_MS, type Actor } from "./policy.ts";

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

  describe("delivery-claim leases", () => {
    const now = new Date("2026-08-13T12:00:00.000Z");

    it("refuses a fresh claim — some other send() call is genuinely in flight", () => {
      const claimedAt = now.getTime() - 1000; // 1 second old
      expect(canRetryDelivery("sent", `claiming:${claimedAt}:token`, now)).toBe(false);
    });

    it("refuses a claim exactly at the lease boundary (not yet stale)", () => {
      const claimedAt = now.getTime() - (CLAIM_LEASE_MS - 1);
      expect(canRetryDelivery("sent", `claiming:${claimedAt}:token`, now)).toBe(false);
    });

    it("allows reclaiming a claim past the lease — its holder abandoned it (crash, timeout, dropped session)", () => {
      const claimedAt = now.getTime() - CLAIM_LEASE_MS;
      expect(canRetryDelivery("sent", `claiming:${claimedAt}:token`, now)).toBe(true);
    });

    it("allows reclaiming a claim well past the lease", () => {
      const claimedAt = now.getTime() - CLAIM_LEASE_MS * 10;
      expect(canRetryDelivery("sent", `claiming:${claimedAt}:token`, now)).toBe(true);
    });

    it("never treats a real confirmed Resend id as a claim, no matter its age", () => {
      // A real id contains no "claiming:" prefix, so the age check never
      // even applies — this stays refused regardless of `now`.
      const farFuture = new Date(now.getTime() + CLAIM_LEASE_MS * 100);
      expect(canRetryDelivery("sent", "<abc@send.rocking.one>", farFuture)).toBe(false);
    });

    it("defaults `now` to the real clock when not supplied", () => {
      // A claim from a second ago, checked with the real (unsupplied) clock,
      // is still fresh — proves the default parameter wires up correctly.
      const claimedAt = Date.now() - 1000;
      expect(canRetryDelivery("sent", `claiming:${claimedAt}:token`)).toBe(false);
    });
  });
});
