"use client";

import { useState, useTransition } from "react";

import { motion } from "motion/react";

import { AuthIntentDialog } from "@/components/ui";
import { cx } from "@/lib/format";
import { press } from "@/lib/motion";

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
      <motion.button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={toggleClass(saved)}
        {...press}
      >
        {saved ? "Saved" : "Save"}
      </motion.button>
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
      <motion.button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={toggleClass(following)}
        {...press}
      >
        {following ? labels[1] : labels[0]}
      </motion.button>
      <AuthIntentDialog
        open={askAuth}
        onClose={() => setAskAuth(false)}
        intent="follow"
        returnPath={path}
      />
    </>
  );
}
