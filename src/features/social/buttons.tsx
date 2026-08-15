"use client";

import { useState, useTransition } from "react";

import { AuthIntentDialog } from "@/components/ui";
import { cx } from "@/lib/format";

import {
  toggleFollow,
  toggleSave,
  type FollowTargetType,
  type SaveTargetType,
} from "./actions";

function toggleClass(active: boolean) {
  // Livesheet: a fired toggle reads as a live state, rest state is a ghost.
  return cx("btn", active ? "btn--live" : "btn--ghost");
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
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();
  // Signed out, the shared auth-intent dialog explains what the account is
  // for and carries the return path — same pattern as Buy now / Make an offer,
  // rather than a bespoke redirect per button.
  const [askAuth, setAskAuth] = useState(false);

  function onClick() {
    if (!isLoggedIn) {
      setAskAuth(true);
      return;
    }
    startTransition(async () => {
      const result = await toggleSave(targetType, targetId, path);
      if ("saved" in result) setSaved(result.saved);
    });
  }

  return (
    <>
      <button type="button" onClick={onClick} disabled={pending} className={toggleClass(saved)}>
        {saved ? "Saved" : "Save"}
      </button>
      <AuthIntentDialog
        open={askAuth}
        onClose={() => setAskAuth(false)}
        intent="save"
        returnPath={path}
      />
    </>
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
  const [following, setFollowing] = useState(initialFollowing);
  const [pending, startTransition] = useTransition();
  const [askAuth, setAskAuth] = useState(false);

  function onClick() {
    if (!isLoggedIn) {
      setAskAuth(true);
      return;
    }
    startTransition(async () => {
      const result = await toggleFollow(targetType, targetId, path);
      if ("following" in result) setFollowing(result.following);
    });
  }

  return (
    <>
      <button type="button" onClick={onClick} disabled={pending} className={toggleClass(following)}>
        {following ? labels[1] : labels[0]}
      </button>
      <AuthIntentDialog
        open={askAuth}
        onClose={() => setAskAuth(false)}
        intent="follow"
        returnPath={path}
      />
    </>
  );
}
