// The "please sign" email body. Marker-free and alias-free, like deliver.ts,
// so scripts can build the identical message that the portal sends — one
// definition, no drifting copy.

export type AgreementEmailInput = {
  reference: string;
  title: string;
  companyName: string;
  agreementId: string;
  appUrl: string;
};

export function agreementForSignatureEmail(input: AgreementEmailInput): { subject: string; html: string } {
  const url = `${input.appUrl}/agreements/${input.agreementId}`;
  return {
    subject: `Please review and sign: ${input.title}`,
    html: `
      <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:520px;color:#1a1a1a;">
        <h2 style="margin:0 0 8px;">An agreement is ready for you</h2>
        <p style="color:#444;margin:0 0 16px;">
          We've prepared <strong>${input.title}</strong> for ${input.companyName}.
          You can read it in the portal and sign it there — no printing or scanning.
        </p>
        <p style="margin:20px 0 0;">
          <a href="${url}" style="background:#D7141C;color:#fff;padding:11px 22px;border-radius:8px;text-decoration:none;font-weight:600;">
            Read and sign
          </a>
        </p>
        <p style="color:#666;margin:20px 0 0;font-size:13px;">
          Reference ${input.reference}. Once signed you can download a PDF copy, and the
          agreement stays available in the portal.
        </p>
      </div>`,
  };
}
