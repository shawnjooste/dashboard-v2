/** The opt-out line appended to Portal Updates — and to nothing else. An
 *  opt-out is only meaningful if the people receiving the mail can find it. */
const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";

export function portalUpdateFooterHtml(): string {
  return `
    <div style="margin-top:28px; padding-top:14px; border-top:1px solid #E5E5E5; font-family:-apple-system,Segoe UI,Roboto,sans-serif; font-size:12px; color:#8A8A8E;">
      You&rsquo;re getting this because you use the Rocking portal.
      <a href="${APP_URL}/communications" style="color:#8A8A8E;">Turn off portal updates</a>.
    </div>`;
}
