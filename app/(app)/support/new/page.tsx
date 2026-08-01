import { getActiveServices, getOpenSlotsByService } from "@/lib/views/bookings";
import { getSupportStatus } from "@/lib/views/support-packages";
import { getCurrentProfile } from "@/lib/auth/profile";
import { GetHelpForm } from "./GetHelpForm";

/** "Get help": one flow that always produces a ticket, and optionally anchors
 *  a session to it. Availability and whether the client's plan covers sessions
 *  are resolved here so the picker can be embedded in the client form. */
export default async function NewTicketPage() {
  const me = await getCurrentProfile();
  const services = await getActiveServices();
  const [slotsByService, status] = await Promise.all([
    getOpenSlotsByService(services),
    me.authenticated && me.profile.client_id ? getSupportStatus(me.profile.client_id) : null,
  ]);
  const covered = !!status?.pkg && !status.pkg.isDefault;
  return <GetHelpForm services={services} slotsByService={slotsByService} covered={covered} />;
}
