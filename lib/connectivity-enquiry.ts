/** Turns a connectivity enquiry from the portal into the RFQ text a human
 *  reads on the admin board. Pure, no server imports (vitest-safe) — the
 *  wording is provable without a database.
 *
 *  Optional fields arrive from a form as "", never undefined.
 *
 *  Every value is flattened to a single line before it goes in. The
 *  description's only structure is its newlines, and it is read by staff on
 *  the RFQ board and interpolated into Shawn's notification email — so a
 *  pasted multi-line note must not be able to forge a "Contact:" line of its
 *  own. */

export type EnquiryInput = {
  address: string;
  provider: string;
  speed: string;
  note: string;
  contactName: string;
  contactEmail: string;
};

export type EnquiryPayload = { title: string; description: string; requestedBy: string };

const MAX_FIELD = 1200;
const MAX_NAME = 80;

/** One line, trimmed, capped. */
function clean(s: string, max = MAX_FIELD): string {
  const flat = s.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** The contact name is rendered as `Name <email>` in `requested_by`, so angle
 *  brackets would let it forge a second recipient. Stripped, and kept short. */
function cleanName(s: string): string {
  return clean(s.replace(/[<>]/g, " "), MAX_NAME);
}

export function buildEnquiry(
  clientName: string,
  input: EnquiryInput,
): { ok: true; payload: EnquiryPayload } | { ok: false; error: string } {
  const address = clean(input.address);
  if (!address) return { ok: false, error: "Enter the address you'd like us to check." };
  if (address.length < 10) {
    return { ok: false, error: "Enter the full street address, suburb and city so we can check coverage." };
  }
  const email = clean(input.contactEmail);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "Enter a valid contact email address." };
  }

  const name = cleanName(input.contactName);
  const provider = clean(input.provider);
  const speed = clean(input.speed);
  const note = clean(input.note);
  const contact = name ? `${name} <${email}>` : email;

  const lines = [
    `Site address: ${address}`,
    provider ? `Current provider: ${provider}` : null,
    speed ? `Current speed: ${speed}` : null,
    note ? `Note: ${note}` : null,
    `Contact: ${contact}`,
    "",
    "Raised from the portal's Connectivity page.",
  ].filter((l): l is string => l !== null);

  return {
    ok: true,
    payload: {
      title: `Connectivity enquiry — ${clean(clientName)}`,
      description: lines.join("\n"),
      requestedBy: contact,
    },
  };
}
