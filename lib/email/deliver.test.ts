import { describe, expect, it, vi } from "vitest";
import { deliverEmail } from "./deliver.ts";

function stubSb(captured: { row?: Record<string, unknown> }) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ in: async () => ({ data: [] }) }) }),
      insert: async (row: Record<string, unknown>) => { captured.row = row; return { error: null }; },
    }),
  } as never;
}

describe("deliverEmail", () => {
  it("records the sent email with recordHtml, never the live html", async () => {
    // vitest does not auto-load .env.local (no dotenv/setupFiles wiring in
    // vitest.config.ts), so RESEND_API_KEY is undefined here unless stubbed —
    // without this, deliverEmail takes its "no key" early return and the
    // fetch stub below is never reached.
    vi.stubEnv("RESEND_API_KEY", "test-key");
    const captured: { row?: Record<string, unknown> } = {};
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "abc" }), { status: 200 }));
    const res = await deliverEmail(stubSb(captured), {
      to: ["a@b.com"], subject: "Hi", html: "<a href='SECRET'>go</a>",
      recordHtml: "<a href='/login'>go</a>", category: "onboarding", clientId: null,
    });
    expect(res.id).toBe("abc");
    expect(captured.row?.html).toBe("<a href='/login'>go</a>");
  });
});
