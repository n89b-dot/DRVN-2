"use client";

import { useRouter } from "next/navigation";
import { useActionState, useCallback, useEffect, useRef, useState } from "react";

import { Alert, Button, Checkbox, Stepper, TextArea, TextField } from "@/components/ui";
import type { ImportProgress } from "@/lib/listing-import/engine";

import {
  chooseImportItem,
  pollImport,
  providePasteFallback,
  retryImport,
  startPasteImport,
  startUrlImport,
  type ImportStartState,
} from "./actions";

/**
 * The import flow: source in (URL or pasted post) → honest progress driven by
 * the real backend states → the seller lands in the normal sell form.
 * Failures degrade forward — a refused page becomes the paste path with the
 * URL kept; nothing sends the seller back to the start.
 */

const POLL_MS = 1600;

function progressSteps(progress: ImportProgress | null) {
  const status = progress?.status ?? "pending";
  const stage =
    status === "pending" || status === "fetching"
      ? 0
      : status === "extracting"
        ? 1
        : status === "importing_media"
          ? 2
          : 3;
  const mode = (i: number): "done" | "now" | "todo" =>
    stage > i ? "done" : stage === i ? "now" : "todo";
  return [
    { label: "Reading your listing", state: mode(0) },
    { label: "Organizing the details", state: mode(1) },
    {
      label:
        progress && progress.imagesImported > 0
          ? `Bringing over photos — ${progress.imagesImported} so far`
          : "Bringing over photos",
      state: mode(2),
    },
    { label: "Preparing your listing", state: mode(3) },
  ];
}

export function ImportFlow({
  attested,
  resumeImportId,
}: {
  /** Content-rights acknowledgement already on file for this account. */
  attested: boolean;
  /** An in-flight import to pick back up (deep link / bounce-back). */
  resumeImportId: string | null;
}) {
  const router = useRouter();
  /** Overrides the action-derived import id: a fresh id (resume) or "cleared". */
  const [importOverride, setImportOverride] = useState<string | null>(resumeImportId);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const pollingRef = useRef(false);

  const [urlState, urlAction, urlPending] = useActionState<ImportStartState, FormData>(
    startUrlImport,
    null
  );
  const [pasteState, pasteAction, pastePending] = useActionState<ImportStartState, FormData>(
    startPasteImport,
    null
  );
  const [fallbackState, fallbackAction, fallbackPending] = useActionState<
    ImportStartState,
    FormData
  >(providePasteFallback, null);

  // The import being worked: derived from whichever start action produced
  // one, unless explicitly overridden (resume deep-link, or "start over").
  const startedId =
    fallbackState?.importId ?? pasteState?.importId ?? urlState?.importId ?? null;

  // Adjust-state-during-render: a NEW start-action result supersedes any
  // earlier "cleared" override and stale progress/error.
  const [prevStartedId, setPrevStartedId] = useState<string | null>(null);
  if (startedId !== prevStartedId) {
    setPrevStartedId(startedId);
    if (startedId) {
      setImportOverride(null);
      setProgress(null);
      setFatal(null);
    }
  }

  const importId = importOverride === "cleared" ? null : (importOverride ?? startedId);

  const ready = progress?.status === "ready" && !progress.multipleItems;

  // Poll loop: each poll advances one durable step server-side.
  const poll = useCallback(async () => {
    if (!importId || pollingRef.current) return;
    pollingRef.current = true;
    try {
      const result = await pollImport(importId);
      if ("error" in result) {
        setFatal(result.error);
        setImportOverride("cleared");
        setProgress(null);
      } else {
        setProgress(result);
      }
    } catch {
      // Transient network blip — the next tick retries.
    } finally {
      pollingRef.current = false;
    }
  }, [importId]);

  useEffect(() => {
    if (!importId) return;
    const kick = setTimeout(() => void poll(), 0);
    const timer = setInterval(() => void poll(), POLL_MS);
    return () => {
      clearTimeout(kick);
      clearInterval(timer);
    };
  }, [importId, poll]);

  // Ready → the review IS the sell form.
  useEffect(() => {
    if (ready && importId) router.push(`/sell?import=${importId}`);
  }, [ready, importId, router]);

  // A blocking failure moves focus to the explanation (a11y §35).
  useEffect(() => {
    if (progress?.status === "failed" || fatal) errorRef.current?.focus();
  }, [progress?.status, fatal]);

  const attestField = !attested && (
    <Checkbox
      name="attest_ownership"
      label="This is my own listing — or content I have permission to use."
      hint="Asked once; remembered on your account."
      required
    />
  );

  // ---------------------------------------------------------------- source
  if (!importId && !progress) {
    const pasteRequired = urlState?.pasteRequired;
    return (
      <div className="deck !pb-0">
        {fatal && (
          <div ref={errorRef} tabIndex={-1}>
            <Alert tone="live" role="alert" title="That import didn't make it">
              {fatal}
            </Alert>
          </div>
        )}

        {!pasteOpen && !pasteRequired && (
          <form action={urlAction} className="flex flex-col gap-3">
            <TextField
              id="import-url"
              name="source_url"
              label="Paste the listing URL"
              placeholder="https://…  — Facebook Marketplace, a forum thread, anywhere"
              inputMode="url"
              autoComplete="off"
              className="max-w-none"
              error={urlState?.error}
              hint="We read that one page — nothing else — and build your DRVN listing from it."
            />
            {attestField}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="live" disabled={urlPending}>
                {urlPending ? "Starting…" : "Import listing"}
              </Button>
              <button
                type="button"
                className="jumplink"
                onClick={() => setPasteOpen(true)}
              >
                Paste your post instead →
              </button>
            </div>
          </form>
        )}

        {(pasteOpen || pasteRequired) && (
          <form action={pasteAction} className="flex flex-col gap-3">
            {pasteRequired && (
              <>
                <Alert title={`${pasteRequired.label} can't be read directly`}>
                  Paste the post you&apos;ve already written and we&apos;ll do the rest — the
                  link stays attached to your listing&apos;s history.
                </Alert>
                <input type="hidden" name="source_url" value={pasteRequired.url} />
              </>
            )}
            <TextArea
              id="import-paste"
              name="post_text"
              label="Your existing post"
              rows={8}
              maxLength={20000}
              placeholder="Paste the whole post"
              className="!max-w-none"
              error={pasteState?.error}
              hint={'Any format, any mess — e.g. "FS: IE intercooler mk7 GTI/R, some bent fins, $450 shipped OBO". We\'ll organize it; you add photos on the next screen.'}
            />
            {attestField}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" variant="live" disabled={pastePending}>
                {pastePending ? "Starting…" : "Build my listing"}
              </Button>
              {!pasteRequired && (
                <button type="button" className="jumplink" onClick={() => setPasteOpen(false)}>
                  ← Back to the link
                </button>
              )}
            </div>
          </form>
        )}
      </div>
    );
  }

  // ---------------------------------------------------------- multi-item
  if (progress?.status === "ready" && progress.multipleItems && progress.items?.length) {
    return (
      <div className="deck !pb-0">
        <Alert title={`We found ${progress.items.length} parts in this post`} role="status">
          Which one are you listing? You can import the others afterwards.
        </Alert>
        <ul className="flex list-none flex-col gap-2 p-0">
          {progress.items.map((item, index) => (
            <li key={`${index}-${item.label}`}>
              <button
                type="button"
                className="tile w-full text-left transition hover:border-[var(--ink)]"
                onClick={() => {
                  setProgress(null);
                  void chooseImportItem(progress.id, index).then((result) => {
                    if ("error" in result) setFatal(result.error);
                    else setProgress(result);
                  });
                }}
              >
                <span className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-body">{item.label}</span>
                  {item.priceText && (
                    <span className="font-mono text-micro uppercase tracking-[0.08em] text-dim">
                      {item.priceText}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // ---------------------------------------------------------------- failed
  if (progress?.status === "failed" || progress?.status === "expired") {
    const expired = progress.status === "expired";
    return (
      <div className="deck !pb-0">
        <div ref={errorRef} tabIndex={-1}>
          <Alert
            tone="live"
            role="alert"
            title={expired ? "This import expired" : "We hit a wall reading that"}
          >
            {expired
              ? "Imports keep for 48 hours. Start it again — it only takes a moment."
              : progress.errorMessage}
          </Alert>
        </div>

        {progress.needsPaste && !expired && (
          <form action={fallbackAction} className="flex flex-col gap-3">
            <input type="hidden" name="import_id" value={progress.id} />
            <TextArea
              id="import-fallback"
              name="post_text"
              label="Paste the post you already wrote"
              rows={8}
              maxLength={20000}
              placeholder="Copy your listing text from the original post and drop it here."
              className="!max-w-none"
              error={fallbackState?.error}
              hint="Same import — the link stays attached, nothing starts over."
            />
            <div>
              <Button type="submit" variant="live" disabled={fallbackPending}>
                {fallbackPending ? "Continuing…" : "Finish the import"}
              </Button>
            </div>
          </form>
        )}

        <div className="flex flex-wrap items-center gap-3">
          {progress.retryable && !expired && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setProgress(null);
                void retryImport(progress.id).then((result) => {
                  if ("error" in result) setFatal(result.error);
                  else setProgress(result);
                });
              }}
            >
              Try again
            </Button>
          )}
          <button
            type="button"
            className="jumplink"
            onClick={() => {
              setImportOverride("cleared");
              setProgress(null);
              setFatal(null);
            }}
          >
            Start a different import →
          </button>
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------- working
  return (
    <div className="deck !pb-0" role="status" aria-live="polite">
      <p className="microlabel microlabel--ink">
        {ready ? "Ready — opening your listing…" : `Reading from ${progress?.sourceLabel ?? "your source"}`}
      </p>
      <Stepper steps={progressSteps(progress)} label="Import progress" />
      <p className="spec-note">
        This usually takes under half a minute. Nothing publishes without your say-so.
      </p>
    </div>
  );
}
