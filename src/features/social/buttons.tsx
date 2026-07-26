"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import { cx } from "@/lib/format";

import {
  toggleFollow,
  toggleSave,
  type FollowTargetType,
  type SaveTargetType,
} from "./actions";

function pillClass(active: boolean) {
  return cx(
    "rounded-pill border px-4 py-1.5 text-sm transition",
    active
      ? "border-accent bg-accent/10 text-accent"
      : "border-border text-text-secondary hover:text-text-primary"
  );
}

export function SaveButton({
  targetType,
  targetId,
  path,
  initialSaved,
  isLoggedIn,
}: {
  targetType: SaveTargetType;
  targetId: string;
  path: string;
  initialSaved: boolean;
  isLoggedIn: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!isLoggedIn) {
      router.push(`/login?next=${encodeURIComponent(path)}`);
      return;
    }
    startTransition(async () => {
      const result = await toggleSave(targetType, targetId, path);
      if ("saved" in result) setSaved(result.saved);
    });
  }

  return (
    <button type="button" onClick={onClick} disabled={pending} className={pillClass(saved)}>
      {saved ? "Saved" : "Save"}
    </button>
  );
}

export function FollowButton({
  targetType,
  targetId,
  path,
  initialFollowing,
  isLoggedIn,
  labels = ["Follow", "Following"],
}: {
  targetType: FollowTargetType;
  targetId: string;
  path: string;
  initialFollowing: boolean;
  isLoggedIn: boolean;
  labels?: [string, string];
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, startTransition] = useTransition();

  function onClick() {
    if (!isLoggedIn) {
      router.push(`/login?next=${encodeURIComponent(path)}`);
      return;
    }
    startTransition(async () => {
      const result = await toggleFollow(targetType, targetId, path);
      if ("following" in result) setFollowing(result.following);
    });
  }

  return (
    <button type="button" onClick={onClick} disabled={pending} className={pillClass(following)}>
      {following ? labels[1] : labels[0]}
    </button>
  );
}
