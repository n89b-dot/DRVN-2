// @vitest-environment jsdom
import { StrictMode, act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { UploadImagesResult } from "@/lib/media-upload";

/**
 * R2-10: the queue's lifecycle — slots always come back, a rejection or a
 * throwing consumer fails one item and never freezes the rest, and a late
 * completion after unmount or a target change is ignored.
 */

type Deferred = {
  file: File;
  pathPrefix: string;
  resolve: (result: UploadImagesResult) => void;
  reject: (error: unknown) => void;
};
const calls: Deferred[] = [];

vi.mock("@/lib/media-upload", () => ({
  uploadImages: vi.fn(
    ({ files, pathPrefix }: { files: Iterable<File>; pathPrefix: string }) =>
      new Promise<UploadImagesResult>((resolve, reject) => {
        calls.push({ file: Array.from(files)[0], pathPrefix, resolve, reject });
      }),
  ),
}));
vi.mock("@/lib/media-staging", () => ({ deleteStagedIfUnconsumed: vi.fn(async () => {}) }));

const { useUploadQueue } = await import("./use-upload-queue");

type Queue = ReturnType<typeof useUploadQueue>;
type Props = { pathPrefix?: string; target?: string; onUploaded?: (item: { id: string; url: string }) => void };

let root: Root | null = null;
let latest: Queue;

function Harness({ pathPrefix = "user-1", target, onUploaded, report }: Props & { report: (queue: Queue) => void }) {
  const queue = useUploadQueue({ bucket: "listing-images", pathPrefix, target, onUploaded });
  // Committed state only — act() flushes this after every render.
  useEffect(() => {
    report(queue);
  });
  return null;
}

function render(props: Props = {}, strict = false) {
  const report = (queue: Queue) => {
    latest = queue;
  };
  const element = <Harness {...props} report={report} />;
  act(() => {
    if (!root) root = createRoot(document.createElement("div"));
    root.render(strict ? <StrictMode>{element}</StrictMode> : element);
  });
}

const file = (name: string) => new File(["x"], name, { type: "image/png" });
const ok = (call: Deferred, url = `https://cdn.test/${call.file.name}`): UploadImagesResult => ({
  uploaded: [{ url, path: call.file.name, file: call.file }],
  failed: [],
});
const statuses = () => latest.items.map((item) => `${item.name}:${item.status}`);

async function settle(fn: () => void) {
  await act(async () => {
    fn();
    // Let the job's await, its settle and the pump run.
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  calls.length = 0;
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:preview-${++n}`);
  URL.revokeObjectURL = vi.fn();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.restoreAllMocks();
});

describe("useUploadQueue", () => {
  it("dispatches one selected file exactly once, even under Strict Mode", () => {
    render({}, true);
    act(() => latest.addFiles([file("a.png")]));
    expect(calls).toHaveLength(1);
    expect(statuses()).toEqual(["a.png:uploading"]);
  });

  it("runs at most three uploads at a time and starts the next as one finishes", async () => {
    render();
    act(() => latest.addFiles(["a", "b", "c", "d", "e"].map((n) => file(`${n}.png`))));
    expect(calls.map((c) => c.file.name)).toEqual(["a.png", "b.png", "c.png"]);
    expect(statuses()).toEqual(["a.png:uploading", "b.png:uploading", "c.png:uploading", "d.png:queued", "e.png:queued"]);

    await settle(() => calls[0].resolve(ok(calls[0])));
    expect(calls).toHaveLength(4);
    expect(statuses().filter((s) => s.endsWith(":uploading"))).toHaveLength(3);
  });

  it("turns a rejected upload into a retryable failure and keeps the queue moving", async () => {
    render();
    act(() => latest.addFiles(["a", "b", "c", "d"].map((n) => file(`${n}.png`))));
    await settle(() => calls[0].reject(new Error("Network down")));

    expect(latest.items[0]).toMatchObject({ status: "failed", error: "Network down", retryable: true });
    // Its slot came back: d started.
    expect(calls.map((c) => c.file.name)).toEqual(["a.png", "b.png", "c.png", "d.png"]);

    // And the failure retries like any other.
    await settle(() => calls[1].resolve(ok(calls[1])));
    act(() => latest.retry(latest.items[0].id));
    expect(calls.at(-1)!.file.name).toBe("a.png");
    expect(latest.items[0].status).toBe("uploading");
  });

  it("fails the item, not the queue, when the consumer callback throws", async () => {
    const onUploaded = vi.fn(() => {
      throw new Error("editor gone");
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    render({ onUploaded });
    act(() => latest.addFiles(["a", "b", "c", "d"].map((n) => file(`${n}.png`))));
    await settle(() => calls[0].resolve(ok(calls[0])));

    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(latest.items[0]).toMatchObject({ status: "failed", retryable: true, url: undefined });
    expect(calls).toHaveLength(4);
    expect(latest.uploading).toBe(true);
  });

  it("delivers a normal completion to the consumer once", async () => {
    const onUploaded = vi.fn();
    render({ onUploaded });
    act(() => latest.addFiles([file("a.png")]));
    await settle(() => calls[0].resolve(ok(calls[0], "https://cdn.test/a")));
    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(onUploaded).toHaveBeenCalledWith({ id: latest.items[0].id, url: "https://cdn.test/a" });
    expect(latest.items[0]).toMatchObject({ status: "done", url: "https://cdn.test/a" });
    expect(latest.uploading).toBe(false);
  });

  it("ignores a completion that lands after unmount", async () => {
    const onUploaded = vi.fn();
    render({ onUploaded });
    act(() => latest.addFiles([file("a.png")]));
    act(() => root!.unmount());
    root = null;
    await settle(() => calls[0].resolve(ok(calls[0])));
    expect(onUploaded).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview-1");
  });

  it("ignores a completion from the previous target and starts the new one clean", async () => {
    const onUploaded = vi.fn();
    render({ onUploaded, target: "draft-1" });
    act(() => latest.addFiles(["a", "b", "c", "d"].map((n) => file(`${n}.png`))));
    expect(calls).toHaveLength(3);

    render({ onUploaded, target: "draft-2" });
    expect(latest.items).toEqual([]);

    // The old draft's uploads finish late: nothing attaches, nothing pumps.
    await settle(() => calls.slice(0, 3).forEach((c) => c.resolve(ok(c))));
    expect(onUploaded).not.toHaveBeenCalled();
    expect(calls).toHaveLength(3);
    expect(latest.items).toEqual([]);

    // The new target has all three slots.
    act(() => latest.addFiles(["x", "y", "z"].map((n) => file(`${n}.png`))));
    expect(calls).toHaveLength(6);
    await settle(() => calls[3].resolve(ok(calls[3], "https://cdn.test/x")));
    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(onUploaded).toHaveBeenCalledWith(expect.objectContaining({ url: "https://cdn.test/x" }));
  });

  it("treats a new pathPrefix as a new target", async () => {
    const onUploaded = vi.fn();
    render({ onUploaded, pathPrefix: "user-1/car-1" });
    act(() => latest.addFiles([file("a.png")]));
    render({ onUploaded, pathPrefix: "user-1/car-2" });
    await settle(() => calls[0].resolve(ok(calls[0])));
    expect(onUploaded).not.toHaveBeenCalled();

    act(() => latest.addFiles([file("b.png")]));
    expect(calls[1].pathPrefix).toBe("user-1/car-2");
  });

  it("frees the slot of an item removed mid-upload without reporting it", async () => {
    const onUploaded = vi.fn();
    render({ onUploaded });
    act(() => latest.addFiles(["a", "b", "c", "d"].map((n) => file(`${n}.png`))));
    act(() => latest.remove(latest.items[0].id));
    await settle(() => calls[0].resolve(ok(calls[0])));
    expect(onUploaded).not.toHaveBeenCalled();
    expect(calls).toHaveLength(4);
  });
});
