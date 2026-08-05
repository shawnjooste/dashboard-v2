import { describe, it, expect } from "vitest";
import { isClientUpdate, activityLabel, CLIENT_UPDATE_KINDS } from "./job-activity";

describe("isClientUpdate", () => {
  it("is true for 'update' — the only kind that emails the client", () => {
    expect(isClientUpdate("update")).toBe(true);
  });
  it("is false for opening and completing, which no longer email anyone", () => {
    expect(isClientUpdate("opened")).toBe(false);
    expect(isClientUpdate("completed")).toBe(false);
  });
  it("is false for internal activity kinds", () => {
    expect(isClientUpdate("status")).toBe(false);
    expect(isClientUpdate("assigned")).toBe(false);
  });
  it("is false for an unknown kind, so new internal kinds never leak into the client panel", () => {
    expect(isClientUpdate("something_new")).toBe(false);
  });
  it("exposes only 'update' — the one kind that actually emails the client", () => {
    expect([...CLIENT_UPDATE_KINDS]).toEqual(["update"]);
  });
});

describe("activityLabel", () => {
  it("labels every known kind", () => {
    expect(activityLabel("opened")).toBe("Opened");
    expect(activityLabel("update")).toBe("Update sent");
    expect(activityLabel("completed")).toBe("Completed");
    expect(activityLabel("status")).toBe("Status changed");
    expect(activityLabel("assigned")).toBe("Task assigned");
  });
  it("falls back to the raw kind rather than rendering blank", () => {
    expect(activityLabel("something_new")).toBe("something_new");
  });
});
