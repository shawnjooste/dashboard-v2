"use client";

/** Graceful error boundary for the client portal — catches render errors
 *  (including ones thrown inside child components) instead of the raw host
 *  error page. */
export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-xl font-bold text-ink">Something went wrong</h1>
      <p className="max-w-sm text-sm text-muted">
        We hit a snag loading this page. Please try again — if it keeps happening, let us know.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-1 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-dark"
      >
        Try again
      </button>
    </div>
  );
}
