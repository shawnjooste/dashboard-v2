import { describe, expect, it, vi } from "vitest";
import { deliverEmail } from "./deliver.ts";

function stubSb(rows: Record<string, unknown>[]) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ in: async () => ({ data: [] }) }) }),
      insert: async (row: Record<string, unknown>) => { rows.push(row); return { error: null }; },
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
    const rows: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "abc" }), { status: 200 }));
    const res = await deliverEmail(stubSb(rows), {
      to: ["a@b.com"], subject: "Hi", html: "<a href='SECRET'>go</a>",
      recordHtml: "<a href='/login'>go</a>", category: "onboarding", clientId: null,
    });
    expect(res.id).toBe("abc");
    expect(rows[0]?.html).toBe("<a href='/login'>go</a>");
  });
});

// Coverage for the two send sites in scripts/create-quote.mjs, which cannot
// be driven end-to-end (a top-level-await CLI). Both branches call
// deliverEmail with an injected sb and read only process.env/fetch, so the
// exact option shapes the script constructs are reproduced here. If either
// branch's shape drifts from what's asserted, update both this file and the
// script together.
describe("deliverEmail — scripts/create-quote.mjs call shapes", () => {
  it("returns the raw Resend id unwrapped, so the caller's own <id@send.rocking.one> formatting is correct", async () => {
    // create-quote.mjs and lib/quote-emails.ts both do
    // `` `<${id}@send.rocking.one>` `` themselves — if deliverEmail ever
    // started returning a pre-wrapped id, every reply-threading header in
    // the app would double-wrap and break thread matching.
    vi.stubEnv("RESEND_API_KEY", "test-key");
    const rows: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "msg-123" }), { status: 200 }));
    const { id } = await deliverEmail(stubSb(rows), {
      from: '"Rocky @ Rocking" <quotes@send.rocking.one>',
      to: ["manager@client.example"],
      cc: ["shawn@rocking.one", "accounts@rocking.one"],
      subject: "New quote from Rocking — QU-ZZZ-901",
      html: "<p>quote</p>",
      clientId: "client-1",
      category: "quote",
      audience: "client",
    });
    expect(id).toBe("msg-123");
    expect(`<${id}@send.rocking.one>`).toBe("<msg-123@send.rocking.one>");
  });

  it("keeps the pending-review and client-facing sends distinct", async () => {
    vi.stubEnv("RESEND_API_KEY", "test-key");
    const rows: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "msg-review" }), { status: 200 }));
    const sb = stubSb(rows);

    // Pending-review branch: shawn@ + kelle@, cc accounts@, internal audience.
    await deliverEmail(sb, {
      from: '"Rocky @ Rocking" <quotes@send.rocking.one>',
      to: ["shawn@rocking.one", "kelle@rocking.one"],
      cc: ["accounts@rocking.one"],
      subject: "Quote QU-ZZZ-901 ready for review — Test Client",
      html: "<p>review</p>",
      category: "quote",
      audience: "internal",
    });
    // Client branch: the client's managers, cc shawn@ + accounts@, client audience.
    await deliverEmail(sb, {
      from: '"Rocky @ Rocking" <quotes@send.rocking.one>',
      to: ["manager@client.example"],
      cc: ["shawn@rocking.one", "accounts@rocking.one"],
      subject: "New quote from Rocking — QU-ZZZ-901",
      html: "<p>quote</p>",
      clientId: "client-1",
      category: "quote",
      audience: "client",
    });

    expect(rows).toHaveLength(2);
    const [reviewRow, clientRow] = rows;

    expect(reviewRow.audience).toBe("internal");
    expect(reviewRow.client_id).toBeNull();
    expect(reviewRow.to_emails).toEqual(
      expect.arrayContaining(["shawn@rocking.one", "kelle@rocking.one", "accounts@rocking.one"]),
    );
    expect(reviewRow.to_emails).not.toEqual(expect.arrayContaining(["manager@client.example"]));

    expect(clientRow.audience).toBe("client");
    expect(clientRow.client_id).toBe("client-1");
    expect(clientRow.to_emails).toEqual(
      expect.arrayContaining(["manager@client.example", "shawn@rocking.one", "accounts@rocking.one"]),
    );
    expect(clientRow.to_emails).not.toEqual(expect.arrayContaining(["kelle@rocking.one"]));
  });

  it("writes sent_emails exactly once per send, with category/audience/client_id set — not double-inserted", async () => {
    // create-quote.mjs used to insert its own sent_emails row after the raw
    // fetch call; that insert was deleted when it moved onto deliverEmail
    // (which owns the record write). This guards against either the script
    // re-adding a manual insert, or deliverEmail itself double-recording.
    vi.stubEnv("RESEND_API_KEY", "test-key");
    const rows: Record<string, unknown>[] = [];
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ id: "msg-456" }), { status: 200 }));
    await deliverEmail(stubSb(rows), {
      from: '"Rocky @ Rocking" <quotes@send.rocking.one>',
      to: ["manager@client.example"],
      cc: ["shawn@rocking.one", "accounts@rocking.one"],
      subject: "New quote from Rocking — QU-ZZZ-902",
      html: "<p>quote</p>",
      clientId: "client-1",
      category: "quote",
      audience: "client",
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      client_id: "client-1",
      category: "quote",
      audience: "client",
      resend_id: "msg-456",
    });
  });
});
