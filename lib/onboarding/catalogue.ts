/** The onboarding tour, as data. Pure — no server imports (vitest-safe).
 *
 *  Order is the order steps are offered. `minDays` is the EARLIEST a step may
 *  fire, measured from enrolment, not a schedule: a feature granted long after
 *  onboarding has its floor already in the past and fires on the next run.
 *  Every step's copy must therefore read correctly both ways. */

export type DataGate = "devices" | "xero" | null;

export type OnboardingStep = {
  /** Stable identifier stored in onboarding_sequence_sends.step_key.
   *  Never rename one — a rename re-sends the step to everybody. */
  key: string;
  /** Earliest day, counted from enrolment. */
  minDays: number;
  /** Feature that must be visible to the recipient; null means everyone. */
  feature: string | null;
  /** Client data that must exist before the step is worth sending. */
  dataGate: DataGate;
  /** portal_activity sections that count as "already using this". */
  sections: string[];
  subject: string;
};

export const CATALOGUE: OnboardingStep[] = [
  {
    key: "support",
    minDays: 3,
    feature: null, // Support is not gated — everyone can raise a request.
    dataGate: null,
    sections: ["support"],
    subject: "Getting help, without the phone tag",
  },
  {
    key: "devices",
    minDays: 7,
    feature: "devices",
    dataGate: "devices",
    // The list tracks as "devices"; a single machine tracks as "device".
    sections: ["devices", "device"],
    subject: "Your computers, and how safe they are",
  },
  {
    key: "billing",
    minDays: 11,
    feature: "billing",
    dataGate: "xero",
    sections: ["billing"],
    subject: "Your invoices and balance, whenever you want them",
  },
  {
    key: "connectivity",
    minDays: 15,
    feature: "connectivity",
    dataGate: null, // The empty state sells connectivity, so no data needed.
    sections: ["connectivity"],
    subject: "Seeing your connection, live",
  },
  {
    key: "team",
    minDays: 19,
    feature: "team",
    dataGate: null,
    sections: ["team"],
    subject: "Adding your colleagues to the portal",
  },
];
