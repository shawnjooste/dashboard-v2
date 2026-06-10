// Microsoft license SKU part-number → friendly name. Extend as new SKUs appear;
// unknowns fall back to the raw part number.
const SKU_NAMES: Record<string, string> = {
  O365_BUSINESS_PREMIUM: "Microsoft 365 Business Standard",
  O365_BUSINESS_ESSENTIALS: "Microsoft 365 Business Basic",
  O365_BUSINESS: "Microsoft 365 Apps for Business",
  SPB: "Microsoft 365 Business Premium",
  SPE_E3: "Microsoft 365 E3",
  SPE_E5: "Microsoft 365 E5",
  ENTERPRISEPACK: "Office 365 E3",
  ENTERPRISEPREMIUM: "Office 365 E5",
  EXCHANGESTANDARD: "Exchange Online (Plan 1)",
  EXCHANGEENTERPRISE: "Exchange Online (Plan 2)",
  EXCHANGEARCHIVE_ADDON: "Exchange Online Archiving",
  EXCHANGEDESKLESS: "Exchange Online Kiosk",
  FLOW_FREE: "Power Automate Free",
  POWERAPPS_DEV: "Power Apps for Developer",
  DYN365_BUSINESS_MARKETING: "Dynamics 365 Marketing",
  DYN365_ENTERPRISE_P1_IW: "Dynamics 365 P1 (trial)",
  WINDOWS_STORE: "Windows Store for Business",
  MCOMEETADV: "Microsoft 365 Audio Conferencing",
  TEAMS_EXPLORATORY: "Teams Exploratory",
  POWER_BI_STANDARD: "Power BI (free)",
  PROJECTPROFESSIONAL: "Project Plan 3",
  VISIOCLIENT: "Visio Plan 2",
  AAD_PREMIUM: "Entra ID P1",
  AAD_PREMIUM_P2: "Entra ID P2",
  EMS: "Enterprise Mobility + Security E3",
};

export function friendlySku(partNumber: string): string {
  return SKU_NAMES[partNumber] ?? partNumber;
}
