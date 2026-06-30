// Branded onboarding email — the "welcome to The Portal" template, rendered for
// passwordless sign-in (a one-click magic link, no password). Sent by the admin
// invite flow. Plain string output so it can post straight to Resend.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://portal.rocking.one";
const SUPPORT_EMAIL = "support@rocking.co.za";

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
}

export type OnboardingFeature = { title: string; body: string };

const DEFAULT_FEATURES: OnboardingFeature[] = [
  { title: "Raise and follow support tickets", body: "See what we’re working on and reply in plain English — no phone tag." },
  { title: "Check your team’s computers and backups", body: "Everything organised by person, so you can see who needs a hand at a glance." },
  { title: "Manage Microsoft 365 & licences", body: "See who has what, and ask us to add a new starter in a couple of clicks." },
];

/** Render the numbered "what's inside" rows from a feature list. */
function featureRows(features: OnboardingFeature[]): string {
  return features
    .map((f, i) => {
      const pad = i === features.length - 1 ? "0" : "0 0 18px 0";
      return `<tr>
                        <td width="44" valign="top" style="padding:${pad};">
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
                            <td width="32" height="32" align="center" valign="middle" bgcolor="#FDECEC" style="border-radius:8px; font-family:Arial,Helvetica,sans-serif; font-size:15px; font-weight:bold; color:#D7141C;">${i + 1}</td>
                          </tr></table>
                        </td>
                        <td valign="top" style="padding:${pad}; font-family:Arial,Helvetica,sans-serif;">
                          <div style="font-size:15px; font-weight:bold; color:#18181B;">${esc(f.title)}</div>
                          <div style="font-size:14px; line-height:21px; color:#71717A; padding-top:2px;">${esc(f.body)}</div>
                        </td>
                      </tr>`;
    })
    .join("\n");
}

/** Support-rollout copy: reframes the welcome around raising + following tickets. */
export function supportOnboardingContent(company: string): {
  preheader: string;
  intro: string;
  eyebrow: string;
  features: OnboardingFeature[];
} {
  return {
    preheader: "Your Rocking support portal — raise a request and follow it through.",
    intro: `We&rsquo;ve set up a simple place for ${esc(company)} to get IT help from Rocking &mdash; raise a request, see what we&rsquo;re working on, and reply without digging through email. No technical know-how needed.`,
    eyebrow: "What you can do here",
    features: [
      { title: "Raise a request in seconds", body: "Tell us what you need in plain English — no phone tag, no chasing." },
      { title: "Follow it through", body: "See the status of every request and reply right here as we work on it." },
      { title: "Everything in one place", body: "All your requests, and how each was resolved, kept together." },
    ],
  };
}

export function onboardingEmailHtml(opts: {
  firstName: string;
  companyName: string;
  portalUrl: string;
  intro?: string;
  eyebrow?: string;
  features?: OnboardingFeature[];
  preheader?: string;
  supportNote?: string | null;
}): string {
  const name = esc(opts.firstName);
  const company = esc(opts.companyName);
  const portalUrl = opts.portalUrl;
  const preheader = esc(opts.preheader ?? "Your Rocking customer portal is ready — see your support, computers and Microsoft 365 in one place.");
  const supportNote =
    opts.supportNote === undefined
      ? "Stuck on anything? Just reply to this email and a real person — Tim or Gareth — will pick it up, normally within the hour on weekdays."
      : opts.supportNote;
  // The support box also carries the card's bottom padding; when omitted, render a spacer instead.
  const supportHtml = supportNote
    ? `<tr>
                  <td class="px" style="padding:28px 40px 36px 40px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAFAFB; border:1px solid #F0F0F2; border-radius:10px;">
                      <tr>
                        <td style="padding:16px 18px; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:21px; color:#52525B;">
                          ${esc(supportNote)}
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>`
    : `<tr><td style="padding:0 0 36px 0; font-size:0; line-height:0;">&nbsp;</td></tr>`;
  const intro =
    opts.intro ??
    `We&rsquo;ve set up a home for everything Rocking looks after for ${company} &mdash; your support tickets, computers, Microsoft&nbsp;365 and more, all in one simple place. No technical know-how needed.`;
  const eyebrow = esc(opts.eyebrow ?? "What you can do inside");
  const featuresHtml = featureRows(opts.features ?? DEFAULT_FEATURES);

  return `<!DOCTYPE html>
<html lang="en" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>Welcome to The Portal</title>
  <!--[if mso]>
  <noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript>
  <![endif]-->
  <style>
    body { margin: 0; padding: 0; width: 100% !important; -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table { border-collapse: collapse !important; }
    img { border: 0; line-height: 100%; outline: none; text-decoration: none; -ms-interpolation-mode: bicubic; }
    a { text-decoration: none; }
    .hover-btn:hover { background-color: #B81016 !important; }
    @media only screen and (max-width: 600px) {
      .container { width: 100% !important; }
      .px { padding-left: 24px !important; padding-right: 24px !important; }
      .h1 { font-size: 26px !important; line-height: 32px !important; }
    }
  </style>
</head>
<body style="margin:0; padding:0; background-color:#FAFAFB;">

  <div style="display:none; max-height:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px; color:#FAFAFB; opacity:0;">
    ${preheader}
    &#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;&#8204;&nbsp;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#FAFAFB;">
    <tr>
      <td align="center" style="padding:32px 16px;">

        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px; max-width:600px;">

          <!-- Brand bar -->
          <tr>
            <td class="px" style="padding:4px 8px 20px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="left" valign="middle">
                    <img src="${APP_URL}/rocking-logo.png" width="130" height="25" alt="Rocking" style="display:block; border:0;">
                  </td>
                  <td align="right" valign="middle" style="font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:bold; letter-spacing:1.5px; color:#A1A1AA; text-transform:uppercase;">
                    The Portal
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td style="background-color:#FFFFFF; border:1px solid #E4E4E7; border-radius:14px;">

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr><td style="height:4px; background-color:#D7141C; border-radius:14px 14px 0 0; font-size:0; line-height:0;">&nbsp;</td></tr>
              </table>

              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td class="px" style="padding:36px 40px 0 40px;">
                    <h1 class="h1" style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:30px; line-height:36px; font-weight:bold; color:#18181B; letter-spacing:-0.5px;">
                      Welcome to The Portal, ${name}
                    </h1>
                    <p style="margin:16px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:25px; color:#3F3F46;">
                      ${intro}
                    </p>
                  </td>
                </tr>

                <!-- CTA -->
                <tr>
                  <td class="px" style="padding:28px 40px 8px 40px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0">
                      <tr>
                        <td align="center" bgcolor="#D7141C" style="border-radius:8px;">
                          <!--[if mso]>
                          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word" href="${portalUrl}" style="height:48px;v-text-anchor:middle;width:240px;" arcsize="17%" stroke="f" fillcolor="#D7141C">
                          <w:anchorlock/>
                          <center style="color:#FFFFFF;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:bold;">Sign in to The Portal</center>
                          </v:roundrect>
                          <![endif]-->
                          <!--[if !mso]><!-->
                          <a class="hover-btn" href="${portalUrl}" target="_blank" style="display:inline-block; padding:14px 32px; font-family:Arial,Helvetica,sans-serif; font-size:16px; font-weight:bold; color:#FFFFFF; background-color:#D7141C; border-radius:8px;">
                            Sign in to The Portal
                          </a>
                          <!--<![endif]-->
                        </td>
                      </tr>
                    </table>
                    <p style="margin:14px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:19px; color:#A1A1AA;">
                      This link is just for you and signs you straight in &mdash; no password to remember. It works for a limited time; if it&rsquo;s expired, just enter your email at The Portal and we&rsquo;ll send a fresh one-time code.
                    </p>
                  </td>
                </tr>

                <tr>
                  <td class="px" style="padding:28px 40px 0 40px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      <tr><td style="border-top:1px solid #F0F0F2; font-size:0; line-height:0;">&nbsp;</td></tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td class="px" style="padding:24px 40px 0 40px;">
                    <p style="margin:0 0 4px 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; font-weight:bold; letter-spacing:1px; text-transform:uppercase; color:#A1A1AA;">
                      ${eyebrow}
                    </p>
                  </td>
                </tr>

                <tr>
                  <td class="px" style="padding:14px 40px 0 40px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                      ${featuresHtml}
                    </table>
                  </td>
                </tr>

                ${supportHtml}
              </table>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="px" style="padding:24px 8px 8px 8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
                <tr>
                  <td align="center" style="font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:20px; color:#A1A1AA;">
                    <strong style="color:#71717A;">Rocking</strong> &nbsp;&bull;&nbsp; <a href="mailto:${SUPPORT_EMAIL}" style="color:#71717A; text-decoration:underline;">${SUPPORT_EMAIL}</a>
                    <br>
                    <span style="color:#C8C8CE;">You&rsquo;re receiving this because Rocking manages IT for ${company}.</span>
                    <br>
                    <a href="${APP_URL}" style="color:#A1A1AA; text-decoration:underline;">Open The Portal</a>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`;
}
