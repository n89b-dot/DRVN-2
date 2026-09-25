"use client";

import { useEffect, useRef, useState, useTransition } from "react";

import { motion } from "motion/react";

import { AuthIntentDialog } from "@/components/ui";
import { Icon } from "@/components/ui/icons";
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
  resumeSave = false,
  itemLabel,
  variant = "button",
}: {
  /** `icon` — a bookmark square beside a card's cart square (the same glyph
   *  the engagement strip uses), for places where a worded button would be
   *  the loudest thing on the card. */
  variant?: "button" | "icon";
  targetType: SaveTargetType;
  targetId: string;
  path: string;
  initialSaved: boolean;
  resumeSave?: boolean;
  itemLabel?: string;
  isLoggedIn: boolean;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Signed out, the shared auth-intent dialog explains what the account is
  // for and carries the return path — same pattern as Buy now / Make an offer,
  // rather than a bespoke redirect per button.
  const [askAuth, setAskAuth] = useState(false);

  const resumed = useRef(false);
  useEffect(() => {
    if (!resumeSave || !isLoggedIn || resumed.current) return;
    resumed.current = true;
    const clearIntent = () => {
      const url = new URL(window.location.href);
      if (url.pathname === path.split("?")[0] && url.searchParams.get("action") === "save") {
        url.searchParams.delete("action");
        window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      }
    };
    // An already-saved return also consumes the intent. Otherwise a later
    // deliberate Unsave could be followed by an unintended automatic Save.
    if (initialSaved) { clearIntent(); return; }
    startTransition(async () => {
      try {
        const result = await toggleSave(targetType, targetId, path, true);
        if ("saved" in result) {
          setSaved(result.saved);
          clearIntent();
        }
        else setError("Couldn't save this part. Try again.");
      } catch { setError("Couldn't save this part. Try again."); }
    });
  }, [resumeSave, isLoggedIn, initialSaved, targetType, targetId, path]);

  function onClick() {
    if (!isLoggedIn) {
      setAskAuth(true);
      return;
    }
    const next = !saved;
    setError(null);
    startTransition(async () => {
      try {
        const result = await toggleSave(targetType, targetId, path, next);
        if ("saved" in result) setSaved(result.saved);
        else setError(result.error === "login" ? "Sign in again to save this." : result.error);
      } catch {
        setError("Couldn't update that. Try again.");
      }
    });
  }

  return (
    <>
      <motion.button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={variant === "icon" ? cx("savebtn", saved && "is-on") : toggleClass(saved)}
        aria-pressed={saved}
        aria-label={
          itemLabel
            ? `${saved ? "Unsave" : "Save"} ${itemLabel}`
            : variant === "icon"
              ? saved ? "Saved — tap to remove" : "Save"
              : undefined
        }
        data-tip={variant === "icon" ? (saved ? "Saved" : "Save") : undefined}
        {...press}
      >
        {variant === "icon" ? <Icon name="bookmark" className="savebtn__ico" /> : saved ? "Saved" : "Save"}
      </motion.button>
      {error && <span role="alert" aria-live="polite" className="field__err">{error}</span>}
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
  const [error, setError] = useState<string | null>(null);

  function onClick() {
    if (!isLoggedIn) {
      setAskAuth(true);
      return;
    }
    const next = !following;
    setError(null);
    startTransition(async () => {
      try {
        const result = await toggleFollow(targetType, targetId, path, next);
        if ("following" in result) setFollowing(result.following);
        else setError(result.error === "login" ? "Sign in again to follow this." : result.error);
      } catch {
        setError("Couldn't update that. Try again.");
      }
    });
  }

  return (
    <>
      <motion.button
        type="button"
        onClick={onClick}
        disabled={pending}
        className={toggleClass(following)}
        aria-pressed={following}
        {...press}
      >
        {following ? labels[1] : labels[0]}
      </motion.button>
      {error && <span role="alert" aria-live="polite" className="field__err">{error}</span>}
      <AuthIntentDialog
        open={askAuth}
        onClose={() => setAskAuth(false)}
        intent="follow"
        returnPath={path}
      />
    </>
  );
}
