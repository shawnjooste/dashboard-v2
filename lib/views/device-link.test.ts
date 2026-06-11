import { describe, it, expect } from "vitest";
import { suggestPerson, type SuggestPerson } from "./device-link";

const people: SuggestPerson[] = [
  { id: "1", email: "anita@gsrlaw.co.za", name: "Anita Mbasa" },
  { id: "2", email: "belinda@gsrlaw.co.za", name: "Belinda Lamont" },
  { id: "3", email: "rose@gsrlaw.co.za", name: "Rose Adams" },
  { id: "4", email: "ulrik@gsrlaw.co.za", name: "Ulrik Strandvik" },
];

describe("suggestPerson", () => {
  it("exact email-local match wins (strip DOMAIN\\)", () => {
    const s = suggestPerson({ lastUser: "GUNSTONS\\rose", label: null }, people);
    expect(s?.person.id).toBe("3");
    expect(s?.score).toBe(100);
  });
  it("login is a prefix-extension of the email (Anitam -> anita)", () => {
    expect(suggestPerson({ lastUser: "GUNSTONS\\Anitam", label: null }, people)?.person.id).toBe("1");
    expect(suggestPerson({ lastUser: "GUNSTONS\\BelindaL", label: null }, people)?.person.id).toBe("2");
    expect(suggestPerson({ lastUser: "ulrikstrandvik", label: null }, people)?.person.id).toBe("4");
  });
  it("falls back to the Datto label first-name", () => {
    expect(suggestPerson({ lastUser: null, label: "Rose" }, people)?.person.id).toBe("3");
  });
  it("returns null when nothing clears the confidence floor", () => {
    expect(suggestPerson({ lastUser: "GUNSTONS\\xyz123", label: "Nobody" }, people)).toBe(null);
    expect(suggestPerson({ lastUser: null, label: null }, people)).toBe(null);
  });
});
