"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { uploadImages } from "@/lib/media-upload";
import { deleteStagedIfUnconsumed } from "@/lib/media-staging";

/**
 * The upload queue (brief §S1): immediate local previews, per-image status,
 * partial-failure handling, retry, and continued editing while uploads run —
 * over the untouched uploadImages → staged-ledger → GC lifecycle. Three
 * files upload concurrently; byte-level percentages are deliberately not
 * simulated (files are small after §S4 normalization) — an honest
 * queued → uploading → done/failed ladder instead of a fake progress bar.
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
  onUploaded,
}: {
  bucket: string;
  pathPrefix: string;
  maxBytes?: number;
  /** Public photography normalization (§S4). Never pass true for evidence. */
  normalize?: boolean;
  /** Fires once per file the moment its public URL exists. */
  onUploaded?: (item: { id: string; url: string }) => void;
}) {
  const [items, setItems] = useState<QueuedUpload[]>([]);
  const active = useRef(0);
  const onUploadedRef = useRef(onUploaded);
  const pumpRef = useRef<() => void>(() => {});
  useEffect(() => {
    onUploadedRef.current = onUploaded;
  }, [onUploaded]);

  const pump = useCallback(() => {
    setItems((current) => {
      const startIds: string[] = [];
      let slots = CONCURRENCY - active.current;
      const next = current.map((item) => {
        if (slots > 0 && item.status === "queued") {
          slots -= 1;
          startIds.push(item.id);
          return { ...item, status: "uploading" as const };
        }
        return item;
      });
      active.current += startIds.length;

      for (const id of startIds) {
        const item = next.find((entry) => entry.id === id)!;
        void uploadImages({ files: [item.file], bucket, pathPrefix, maxBytes, normalize }).then(
          ({ uploaded, failed }) => {
            active.current -= 1;
            setItems((state) =>
              state.map((entry) => {
                if (entry.id !== id) return entry;
                if (uploaded[0]) {
                  onUploadedRef.current?.({ id: entry.id, url: uploaded[0].url });
                  return { ...entry, status: "done" as const, url: uploaded[0].url };
                }
                const failure = failed[0];
                return {
                  ...entry,
                  status: "failed" as const,
                  error: failure?.reason ?? "Upload failed.",
                  retryable: failure?.retryable ?? true,
                };
              }),
            );
            pumpRef.current();
          },
        );
      }
      return startIds.length ? next : current;
    });
  }, [bucket, pathPrefix, maxBytes, normalize]);
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

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
      setItems((current) => [...current, ...fresh]);
      // Let the state land before pumping.
      queueMicrotask(pump);
    },
    [pump],
  );

  const retry = useCallback(
    (id: string) => {
      setItems((current) =>
        current.map((item) =>
          item.id === id && item.status === "failed" ? { ...item, status: "queued", error: undefined } : item,
        ),
      );
      queueMicrotask(pump);
    },
    [pump],
  );

  const remove = useCallback((id: string) => {
    setItems((current) => {
      const item = current.find((entry) => entry.id === id);
      if (item) {
        URL.revokeObjectURL(item.previewUrl);
        if (item.url) void deleteStagedIfUnconsumed(item.url).catch(() => {});
      }
      return current.filter((entry) => entry.id !== id);
    });
  }, []);

  /** Drop finished entries from the queue view (previews revoked). */
  const clearDone = useCallback(() => {
    setItems((current) => {
      for (const item of current) if (item.status === "done") URL.revokeObjectURL(item.previewUrl);
      return current.filter((item) => item.status !== "done");
    });
  }, []);

  // Revoke previews on unmount.
  const itemsRef = useRef(items);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);
  useEffect(
    () => () => {
      for (const item of itemsRef.current) URL.revokeObjectURL(item.previewUrl);
    },
    [],
  );

  const uploading = items.some((item) => item.status === "queued" || item.status === "uploading");

  return { items, addFiles, retry, remove, clearDone, uploading };
}
