"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { uploadImages, type UploadImagesResult } from "@/lib/media-upload";
import { deleteStagedIfUnconsumed } from "@/lib/media-staging";

/**
 * The upload queue (brief §S1): immediate local previews, per-image status,
 * partial-failure handling, retry, and continued editing while uploads run —
 * over the untouched uploadImages → staged-ledger → GC lifecycle. Three
 * files upload concurrently; byte-level percentages are deliberately not
 * simulated (files are small after §S4 normalization) — an honest
 * queued → uploading → done/failed ladder instead of a fake progress bar.
 *
 * Lifecycle (R2-10). A job always gives its slot back and pumps the next
 * entry, however it ends: a rejected upload becomes a retryable failure on
 * that one item, and a consumer callback that throws fails that item rather
 * than freezing the queue. Every job carries the generation it started in;
 * unmounting, or changing the target (bucket, pathPrefix, or `target`),
 * starts a new generation, and a completion from an older one is ignored —
 * a late file never lands in a different editor. Its staged object is left
 * to the staging ledger's GC sweep; the queue never deletes on its own.
 */

export type QueuedUpload = {
  id: string;
  /** Object URL for the instant local preview. Revoked on removal. */
  previewUrl: string;
  name: string;
  status: "queued" | "uploading" | "done" | "failed";
  /** Public URL once uploaded. */
  url?: string;
  error?: string;
  retryable?: boolean;
  file: File;
};

const CONCURRENCY = 3;

export function useUploadQueue({
  bucket,
  pathPrefix,
  maxBytes,
  normalize = true,
  target,
  onUploaded,
}: {
  bucket: string;
  pathPrefix: string;
  maxBytes?: number;
  /** Public photography normalization (§S4). Never pass true for evidence. */
  normalize?: boolean;
  /** What uploads attach to (an editor, a draft), when bucket + pathPrefix
   *  don't already say. Changing it discards the queue and ignores any
   *  upload still in flight for the old one. */
  target?: string;
  /** Fires once per file the moment its public URL exists. Throwing fails
   *  that item (retryable); it never stops the queue. */
  onUploaded?: (item: { id: string; url: string }) => void;
}) {
  const [items, setItems] = useState<QueuedUpload[]>([]);
  // The queue's source of truth, updated synchronously. Uploads are side
  // effects, so they must never start inside a setState updater: React may
  // run an updater more than once (Strict Mode, or re-applying queued
  // updates), and each run started another upload of the same file — one
  // chosen photo became 3–5 gallery rows. Every change goes through
  // `update`, which runs its function exactly once and then renders.
  const queueRef = useRef<QueuedUpload[]>([]);
  const update = useCallback((change: (current: QueuedUpload[]) => QueuedUpload[]) => {
    queueRef.current = change(queueRef.current);
    setItems(queueRef.current);
  }, []);
  const active = useRef(0);
  // Bumped on unmount and on a target change. A job only reports — and
  // only gives back a slot — while its generation is still current.
  const generation = useRef(0);
  const onUploadedRef = useRef(onUploaded);
  const pumpRef = useRef<() => void>(() => {});
  useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);

  /** One finished upload → its item's final state, and the consumer told. */
  const settle = useCallback(
    (id: string, { uploaded, failed }: UploadImagesResult) => {
      // Removed while uploading: nothing to report.
      if (!queueRef.current.some((entry) => entry.id === id)) return;
      let next: Partial<QueuedUpload>;
      if (uploaded[0]) {
        next = { status: "done", url: uploaded[0].url, error: undefined };
        try {
          onUploadedRef.current?.({ id, url: uploaded[0].url });
        } catch (error) {
          // The file is up but the editor didn't take it. Fail the item so
          // the person sees it and can retry; the unconsumed upload is the
          // staging ledger's to reclaim.
          console.error("[upload-queue] onUploaded threw", error);
          next = { status: "failed", url: undefined, error: "Couldn't add this photo — try again.", retryable: true };
        }
      } else {
        const failure = failed[0];
        next = { status: "failed", error: failure?.reason ?? "Upload failed.", retryable: failure?.retryable ?? true };
      }
      update((state) => state.map((entry) => (entry.id === id ? { ...entry, ...next } : entry)));
    },
    [update],
  );

  const pump = useCallback(() => {
    const startIds: string[] = [];
    let slots = CONCURRENCY - active.current;
    update((current) =>
      current.map((item) => {
        if (slots > 0 && item.status === "queued") {
          slots -= 1;
          startIds.push(item.id);
          return { ...item, status: "uploading" as const };
        }
        return item;
      }),
    );
    active.current += startIds.length;

    const run = async (id: string, file: File, startedIn: number) => {
      let result: UploadImagesResult;
      try {
        result = await uploadImages({ files: [file], bucket, pathPrefix, maxBytes, normalize });
      } catch (error) {
        result = {
          uploaded: [],
          failed: [{ file, reason: error instanceof Error && error.message ? error.message : "Upload failed.", retryable: true }],
        };
      }
      // A newer generation already released every slot this one held.
      if (startedIn !== generation.current) return;
      try {
        settle(id, result);
      } finally {
        active.current -= 1;
        pumpRef.current();
      }
    };

    for (const id of startIds) {
      const item = queueRef.current.find((entry) => entry.id === id)!;
      void run(id, item.file, generation.current);
    }
  }, [bucket, pathPrefix, maxBytes, normalize, update, settle]);
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  // A new target is a new queue. What was in flight for the old one is
  // fenced, not delivered; done items already reached their consumer.
  const targetKey = `${bucket}\u0000${pathPrefix}\u0000${target ?? ""}`;
  const lastTarget = useRef(targetKey);
  useEffect(() => {
    if (lastTarget.current === targetKey) return;
    lastTarget.current = targetKey;
    generation.current += 1;
    active.current = 0;
    for (const item of queueRef.current) URL.revokeObjectURL(item.previewUrl);
    update(() => []);
  }, [targetKey, update]);

  const addFiles = useCallback(
    (files: Iterable<File>) => {
      const fresh: QueuedUpload[] = Array.from(files).map((file) => ({
        id: crypto.randomUUID(),
        previewUrl: URL.createObjectURL(file),
        name: file.name,
        status: "queued",
        file,
      }));
      if (!fresh.length) return;
      update((current) => [...current, ...fresh]);
      pump();
    },
    [pump, update],
  );

  const retry = useCallback(
    (id: string) => {
      update((current) =>
        current.map((item) =>
          item.id === id && item.status === "failed" ? { ...item, status: "queued", error: undefined } : item,
        ),
      );
      pump();
    },
    [pump, update],
  );

  const remove = useCallback(
    (id: string) => {
      const item = queueRef.current.find((entry) => entry.id === id);
      if (item) {
        URL.revokeObjectURL(item.previewUrl);
        if (item.url) void deleteStagedIfUnconsumed(item.url).catch(() => {});
      }
      update((current) => current.filter((entry) => entry.id !== id));
    },
    [update],
  );

  /** Drop finished entries from the queue view (previews revoked). */
  const clearDone = useCallback(() => {
    for (const item of queueRef.current) if (item.status === "done") URL.revokeObjectURL(item.previewUrl);
    update((current) => current.filter((item) => item.status !== "done"));
  }, [update]);

  // Unmount: fence every job in flight and revoke previews. Mount (and a
  // remount that kept state) puts back anything a fenced job left behind as
  // "uploading", so a stale item can't hold the queue's slots forever.
  useEffect(() => {
    if (queueRef.current.some((item) => item.status === "uploading")) {
      update((current) =>
        current.map((item) =>
          item.status === "uploading"
            ? { ...item, status: "failed", error: "Upload interrupted — try again.", retryable: true }
            : item,
        ),
      );
    }
    return () => {
      // Fenced jobs never hand their slots back, so release them here.
      generation.current += 1;
      active.current = 0;
      for (const item of queueRef.current) URL.revokeObjectURL(item.previewUrl);
    };
  }, [update]);

  const uploading = items.some((item) => item.status === "queued" || item.status === "uploading");

  return { items, addFiles, retry, remove, clearDone, uploading };
}
