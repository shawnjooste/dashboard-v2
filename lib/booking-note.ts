import { fmtRands } from "./booking-helpers";

/** Internal note posted on the anchored ticket when a session is paid. Keeps
 *  the money trail on the ticket the work belongs to, so nobody has to
 *  cross-reference a second conversation. */
export function bookingNoteText(o: {
  serviceName: string;
  slotLabel: string;
  totalCents: number;
  reference: string;
  note?: string | null;
}): string {
  const lines = [
    `Paid ${o.serviceName} booked for ${o.slotLabel}.`,
    `Amount: ${fmtRands(o.totalCents)} incl VAT · ref ${o.reference}`,
  ];
  if (o.note) lines.push("", `Client's note: ${o.note}`);
  return lines.join("\n");
}

/** Internal note posted when a booking is cancelled. */
export function bookingCancelledNoteText(o: { serviceName: string; slotLabel: string }): string {
  return `The ${o.serviceName} booked for ${o.slotLabel} was cancelled. Any refund is handled manually in Paystack.`;
}
