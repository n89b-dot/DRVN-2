"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { deleteActivityPost } from "@/app/(product)/garage/actions";
import { Alert, Button } from "@/components/ui";

/**
 * The author's way out of a post that has no car (W-5). A car post is
 * deleted from its editor on the car's sheet; a carless one has no sheet,
 * so the control lives on the post itself. Two steps, because it can't be
 * undone and sits one tap from the comments.
 */
export function DeletePostButton({ postId }: { postId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function remove() {
    setError(null);
    startTransition(async () => {
      const data = new FormData();
      data.set("post_id", postId);
      const result = await deleteActivityPost({}, data);
      if (result.error) {
        setError(result.error);
        return;
      }
      router.push(result.href ?? "/home");
    });
  }

  return (
    <div className="grid gap-2 justify-items-start">
      {confirming ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="destructive" onClick={remove} loading={pending} pendingLabel="Deleting…">
            Delete for good
          </Button>
          <Button variant="quiet" onClick={() => setConfirming(false)} disabled={pending}>
            Keep it
          </Button>
        </div>
      ) : (
        <Button variant="quiet" onClick={() => setConfirming(true)}>
          Delete this post
        </Button>
      )}
      {error && <Alert tone="live" role="alert" title={error} />}
    </div>
  );
}
