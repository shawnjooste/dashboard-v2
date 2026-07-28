import { describe, it, expect } from "vitest";
import { documentError, safeDocName, MAX_DOC_BYTES } from "./compliance-helpers";

const pdf = (over: Partial<{ type: string; size: number; name: string }> = {}) => ({
  type: "application/pdf",
  size: 1000,
  name: "letter.pdf",
  ...over,
});

describe("documentError", () => {
  it("accepts a normal PDF", () => {
    expect(documentError(pdf())).toBeNull();
  });
  it("rejects a non-PDF mime type", () => {
    expect(documentError(pdf({ type: "image/png", name: "logo.png" }))).toBe("logo.png: only PDF files are allowed.");
  });
  it("rejects a .pdf name carrying the wrong mime type", () => {
    expect(documentError(pdf({ type: "application/octet-stream" }))).toBe("letter.pdf: only PDF files are allowed.");
  });
  it("accepts an uppercase .PDF extension", () => {
    expect(documentError(pdf({ name: "LETTER.PDF" }))).toBeNull();
  });
  it("rejects a PDF mime type with a non-pdf extension", () => {
    expect(documentError(pdf({ name: "letter.exe" }))).toBe("letter.exe: only PDF files are allowed.");
  });
  it("rejects an empty file", () => {
    expect(documentError(pdf({ size: 0 }))).toBe("letter.pdf: the file is empty.");
  });
  it("rejects a file over the size cap", () => {
    expect(documentError(pdf({ size: MAX_DOC_BYTES + 1 }))).toBe("letter.pdf: over the 4 MB limit — compress it or split it.");
  });
  it("accepts a file exactly at the cap", () => {
    expect(documentError(pdf({ size: MAX_DOC_BYTES }))).toBeNull();
  });
});

describe("safeDocName", () => {
  it("keeps a clean name", () => {
    expect(safeDocName("bank-letter.pdf")).toBe("bank-letter.pdf");
  });
  it("replaces spaces and unsafe characters", () => {
    expect(safeDocName("Bank Letter (2026).pdf")).toBe("Bank_Letter__2026_.pdf");
  });
  it("neutralises path separators so a name cannot escape its folder", () => {
    // Dots are preserved (as in safePhotoName); only the separators matter for
    // traversal, and the stored path is UUID-prefixed regardless.
    expect(safeDocName("../../etc/passwd.pdf")).toBe(".._.._etc_passwd.pdf");
  });
  it("preserves dots inside a legitimate filename", () => {
    expect(safeDocName("report.v2.pdf")).toBe("report.v2.pdf");
  });
});
