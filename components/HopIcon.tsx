/** Line-art glyphs for path hops. Inline SVG — no icon dependency, and they
 *  inherit colour from the panel they sit in. */
export function HopIcon({ kind, className = "" }: { kind: string; className?: string }) {
  const common = {
    width: 28,
    height: 28,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "square" as const,
    className,
    "aria-hidden": true,
  };

  switch (kind) {
    case "internet":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M3 12h18" />
          <path d="M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3Z" />
        </svg>
      );
    case "core":
      return (
        <svg {...common}>
          <rect x="3" y="4" width="18" height="6" />
          <rect x="3" y="14" width="18" height="6" />
          <path d="M7 7h.01M7 17h.01" />
          <path d="M11 7h6M11 17h6" />
        </svg>
      );
    case "distribution":
    case "tower":
    case "wireless":
      return (
        <svg {...common}>
          <path d="M12 4v16" />
          <path d="M7 20 12 9l5 11" />
          <path d="M5.5 7a7 7 0 0 1 13 0" />
          <path d="M2.5 4.5a11 11 0 0 1 19 0" />
        </svg>
      );
    case "site":
      return (
        <svg {...common}>
          <path d="M3 11 12 4l9 7" />
          <path d="M5 10v10h14V10" />
          <path d="M10 20v-6h4v6" />
        </svg>
      );
    case "cpe":
    default:
      return (
        <svg {...common}>
          <rect x="2.5" y="12" width="19" height="8" />
          <path d="M6 16h.01M9.5 16h.01" />
          <path d="M17 16h2" />
          <path d="M12 12V8" />
          <path d="M8.5 5.5a5 5 0 0 1 7 0" />
        </svg>
      );
  }
}
