import { describe, expect, it } from "vitest";
import {
  MAX_PHOTO_BYTES,
  MAX_REQUEST_BYTES,
  chunkBySize,
  fitWithin,
  photoError,
  safePhotoName,
} from "./device-photo-helpers";

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

describe("fitWithin", () => {
  it("leaves small images untouched", () => {
    expect(fitWithin(800, 600, 1920)).toEqual({ width: 800, height: 600 });
  });
  it("scales a landscape photo down to the max edge", () => {
    expect(fitWithin(4032, 3024, 1920)).toEqual({ width: 1920, height: 1440 });
  });
  it("scales a portrait photo down to the max edge", () => {
    expect(fitWithin(3024, 4032, 1920)).toEqual({ width: 1440, height: 1920 });
  });
  it("never returns zero for extreme aspect ratios", () => {
    expect(fitWithin(10000, 1, 1920)).toEqual({ width: 1920, height: 1 });
  });
});

describe("chunkBySize", () => {
  const f = (size: number, name: string) => ({ size, name });
  it("keeps everything in one chunk when it fits", () => {
    const files = [f(1_000_000, "a"), f(1_000_000, "b")];
    expect(chunkBySize(files, 4_000_000)).toEqual([files]);
  });
  it("splits when the running total would exceed the limit", () => {
    const [a, b, c] = [f(2_000_000, "a"), f(2_000_000, "b"), f(1_000_000, "c")];
    expect(chunkBySize([a, b, c], 4_000_000)).toEqual([[a, b], [c]]);
  });
  it("gives an oversized file its own chunk", () => {
    const [a, big] = [f(1_000, "a"), f(5_000_000, "big")];
    expect(chunkBySize([a, big], 4_000_000)).toEqual([[a], [big]]);
  });
  it("MAX_REQUEST_BYTES stays under Vercel's 4.5 MB cap with headroom", () => {
    expect(MAX_REQUEST_BYTES).toBeLessThanOrEqual(4_000_000);
  });
});
