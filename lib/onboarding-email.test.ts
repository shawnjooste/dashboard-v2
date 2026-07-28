import { describe, expect, it } from "vitest";
import { onboardingEmailHtml } from "./onboarding-email";

const TOKEN = "SECRET_TOKEN_abc123";
const INVITE_URL = `https://portal.rocking.one/auth/confirm?token_hash=${TOKEN}&type=invite&next=/`;
const base = { firstName: "Jane", companyName: "Acme", portalUrl: INVITE_URL };

describe("onboardingEmailHtml", () => {
  it("puts the sign-in link in the email the invitee receives", () => {
    const sent = onboardingEmailHtml(base);
    expect(sent).toContain(TOKEN);
  });

  /**
   * Guards the fix for the stored-credential hole: /communications shows every
   * manager at a client all client-audience mail, so a stored invite body would
   * hand them a one-click sign-in as the invitee. lib/notify.ts renders a second
   * copy with a harmless URL for storage — if that ever regresses, this fails.
   */
  it("renders a credential-free copy when given a plain URL, keeping the content", () => {
    const stored = onboardingEmailHtml({ ...base, portalUrl: "https://portal.rocking.one/login" });
    expect(stored).not.toContain(TOKEN);
    expect(stored).not.toContain("token_hash");
    expect(stored).not.toContain("auth/confirm");
    // Still a real, useful email — not a stub.
    expect(stored).toContain("Acme");
    expect(stored).toContain("https://portal.rocking.one/login");
  });
});
