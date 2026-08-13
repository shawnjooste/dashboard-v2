import { describe, it, expect } from "vitest";
import { visibleNavGroups, mobileMenuGroups, MOBILE_TABS } from "../nav";

const hrefs = (gs: { items: { href: string }[] }[]) => gs.flatMap((g) => g.items.map((i) => i.href));

describe("visibleNavGroups", () => {
  it("gives a manager their full nav when nothing is restricted", () => {
    const got = hrefs(visibleNavGroups({ role: "client_manager", billingEnabled: true }));
    expect(got).toContain("/quotes");
    expect(got).toContain("/billing");
  });

  it("drops billing when the client has no Xero link", () => {
    const got = hrefs(visibleNavGroups({ role: "client_manager", billingEnabled: false }));
    expect(got).not.toContain("/billing");
  });

  it("honours per-user feature overrides", () => {
    const got = hrefs(
      visibleNavGroups({ role: "client_manager", allowedHrefs: ["/support"], billingEnabled: true }),
    );
    expect(got).not.toContain("/quotes");
    expect(got).toContain("/support");
  });

  it("gives a pending user status only", () => {
    const got = hrefs(visibleNavGroups({ role: "client_member", pendingMode: "pending" }));
    expect(got).toEqual(["/status"]);
  });

  it("gives a rejected user nothing", () => {
    expect(visibleNavGroups({ role: "client_member", pendingMode: "rejected" })).toEqual([]);
  });

  it("drops groups that end up empty", () => {
    const groups = visibleNavGroups({ role: "client_manager", allowedHrefs: [], billingEnabled: false });
    expect(groups.every((g) => g.items.length > 0)).toBe(true);
  });
});

describe("mobileMenuGroups", () => {
  it("excludes anything already reachable as a tab", () => {
    const got = hrefs(mobileMenuGroups({ role: "client_manager", billingEnabled: true }));
    for (const tab of MOBILE_TABS) expect(got).not.toContain(tab.href);
  });

  it("still hides what the user isn't entitled to", () => {
    const got = hrefs(
      mobileMenuGroups({ role: "client_manager", allowedHrefs: ["/support"], billingEnabled: true }),
    );
    expect(got).not.toContain("/quotes");
  });
});
