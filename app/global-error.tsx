"use client";

/** Root error boundary — catches errors that escape every nested boundary
 *  (root/app layouts, server actions), replacing the host's raw error page.
 *  Surfaces the error so it can be diagnosed. */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, sans-serif", background: "#FAFAFB" }}>
        <div style={{ maxWidth: 560, margin: "12vh auto", padding: "0 24px", color: "#18181B" }}>
          <h1 style={{ fontSize: 22, fontWeight: 700, margin: "0 0 8px" }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: "#52525B", margin: "0 0 16px", lineHeight: 1.6 }}>
            We hit a snag loading this page. Please reload — if it keeps happening, share the details
            below with support.
          </p>
          <pre
            style={{
              fontSize: 12,
              background: "#F1EFE8",
              border: "1px solid #E4E4E7",
              borderRadius: 8,
              padding: 16,
              overflow: "auto",
              whiteSpace: "pre-wrap",
              color: "#3F3F46",
            }}
          >
            {error?.message || "(no message)"}
            {error?.digest ? `\n\ndigest: ${error.digest}` : ""}
          </pre>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: 16,
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 600,
              color: "#fff",
              background: "#D7141C",
              border: "none",
              borderRadius: 8,
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
