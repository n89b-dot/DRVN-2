"use client";

import { useState } from "react";

/**
 * A YouTube video that loads nothing from YouTube until the visitor presses
 * play. An iframe in the page contacts YouTube as soon as it renders — before
 * the visitor has chosen anything — so the page shows DRVN's own ink plate
 * instead (no thumbnail: that is a request to YouTube too) and swaps in the
 * player on the click. The click is the choice; it is not remembered, so the
 * next video asks again.
 */
export function ConsentVideo({
  videoId,
  title,
  className,
}: {
  /** The 11-character YouTube id (youtubeId in lib/activity-blocks). */
  videoId: string;
  /** What the video is, for the play button and the player's title. */
  title?: string | null;
  className?: string;
}) {
  const [playing, setPlaying] = useState(false);
  const label = title?.trim() || "Video";

  return (
    <div className={className}>
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${encodeURIComponent(videoId)}?autoplay=1`}
          title={label}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          className="aspect-video w-full rounded-r"
        />
      ) : (
        <button
          type="button"
          onClick={() => setPlaying(true)}
          aria-label={`Play ${label} from YouTube`}
          className="relative grid aspect-video w-full place-items-center overflow-hidden rounded-r bg-ink transition hover:opacity-90"
        >
          <span className="grid h-14 w-20 place-items-center rounded-ctl bg-on-ink text-ink">
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden>
              <path d="M8 5v14l11-7z" />
            </svg>
          </span>
        </button>
      )}
      <p className="mt-2 font-mono text-xs text-dim">
        {playing ? "Playing from YouTube." : "Plays from YouTube. Nothing is sent to YouTube until you press play."}{" "}
        <a
          href={`https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`}
          target="_blank"
          rel="noreferrer"
          className="jumplink"
        >
          Open on YouTube ↗
        </a>
      </p>
    </div>
  );
}
