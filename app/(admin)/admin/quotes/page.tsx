import { getAllQuotesAdmin } from "@/lib/views/quotes";
import { QuotesAdminView } from "./QuotesAdminView";

export default async function AdminQuotesPage() {
  const quotes = await getAllQuotesAdmin();
  return <QuotesAdminView quotes={quotes} />;
}
