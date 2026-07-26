"use client";

/**
 * Last resort: an error in the root layout itself, where the app's own CSS and
 * shell may not have loaded. Deliberately self-contained.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "#efede6",
          color: "#17181c",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          padding: "24px",
        }}
      >
        <main style={{ maxWidth: "42ch", textAlign: "center" }}>
          <p
            style={{
              fontFamily: "ui-monospace, monospace",
              fontSize: "11px",
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "#6b6e78",
            }}
          >
            DRVN
          </p>
          <h1 style={{ fontSize: "24px", margin: "12px 0" }}>Something broke badly</h1>
          <p style={{ lineHeight: 1.6, color: "#6b6e78" }}>
            The app failed to start. Reloading usually clears it.
            {error.digest ? ` (ref ${error.digest})` : ""}
          </p>
          <button
            type="button"
            onClick={reset}
            style={{
              marginTop: "20px",
              padding: "10px 20px",
              borderRadius: "6px",
              border: 0,
              background: "#17181c",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
