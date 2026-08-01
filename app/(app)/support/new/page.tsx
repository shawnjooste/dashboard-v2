import { getActiveServices, getOpenSlotsByService } from "@/lib/views/bookings";
import { GetHelpForm } from "./GetHelpForm";

/** "Get help": one flow that always produces a ticket, and optionally anchors
 *  a paid session to it. Availability is fetched here so the picker can be
 *  embedded in the client form. */
export default async function NewTicketPage() {
  const services = await getActiveServices();
  const slotsByService = await getOpenSlotsByService(services);
  return <GetHelpForm services={services} slotsByService={slotsByService} />;
}
