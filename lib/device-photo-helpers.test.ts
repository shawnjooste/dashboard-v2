import { describe, expect, it } from "vitest";
import { MAX_PHOTO_BYTES, photoError, safePhotoName } from "./device-photo-helpers";

describe("safePhotoName", () => {
  it("keeps safe characters", () => {
    expect(safePhotoName("IMG_2041.jpeg")).toBe("IMG_2041.jpeg");
  });
  it("replaces spaces and specials", () => {
    expect(safePhotoName("cracked hinge (front).jpg")).toBe("cracked_hinge__front_.jpg");
  });
});

describe("photoError", () => {
  it("accepts a normal photo", () => {
    expect(photoError({ type: "image/jpeg", size: 3_000_000, name: "a.jpg" })).toBeNull();
  });
  it("rejects non-images", () => {
    expect(photoError({ type: "application/pdf", size: 1000, name: "doc.pdf" })).toMatch(/not an image/);
  });
  it("rejects oversized files", () => {
    expect(photoError({ type: "image/png", size: MAX_PHOTO_BYTES + 1, name: "big.png" })).toMatch(/10 MB/);
  });
});
