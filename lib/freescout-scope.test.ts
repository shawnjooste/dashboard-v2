import { describe, it, expect } from "vitest";
import { canAccessConversation, filterConversations, emailDomain, htmlToText } from "./freescout-scope";

describe("freescout scope", () => {
  it("extracts email domains", () => {
    expect(emailDomain("Rose@GSRLaw.co.za")).toBe("gsrlaw.co.za");
    expect(emailDomain("nodomain")).toBe("");
  });

  it("members can access only their own conversations", () => {
    expect(canAccessConversation("me@x.com", "me@x.com", [])).toBe(true);
    expect(canAccessConversation("Me@X.com", "me@x.com", [])).toBe(true);
    expect(canAccessConversation("colleague@x.com", "me@x.com", [])).toBe(false);
    expect(canAccessConversation(null, "me@x.com", [])).toBe(false);
  });

  it("managers can access conversations from their client's domains", () => {
    const domains = ["gsrlaw.co.za"];
    expect(canAccessConversation("rose@gsrlaw.co.za", "boss@gsrlaw.co.za", domains)).toBe(true);
    expect(canAccessConversation("stranger@other.com", "boss@gsrlaw.co.za", domains)).toBe(false);
    // domain must match exactly, not as a suffix of a longer domain
    expect(canAccessConversation("x@evilgsrlaw.co.za", "boss@gsrlaw.co.za", domains)).toBe(false);
  });

  it("converts email HTML to safe plain text", () => {
    expect(htmlToText("<p>Hello<br>world</p><script>alert(1)</script>")).toBe(
      "Hello\nworld\nalert(1)",
    );
    expect(htmlToText("a &amp; b &lt;c&gt;")).toBe("a & b <c>");
  });

  it("filters and dedupes conversation lists", () => {
    const list = [
      { id: 1, customerEmail: "me@x.com" },
      { id: 1, customerEmail: "me@x.com" },
      { id: 2, customerEmail: "other@y.com" },
    ];
    expect(filterConversations(list, "me@x.com", []).map((c) => c.id)).toEqual([1]);
  });
});
