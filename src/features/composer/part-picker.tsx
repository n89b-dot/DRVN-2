"use client";

import { useMemo, useState } from "react";

import { BottomSheet, Button, ObjectRow, TextField } from "@/components/ui";

export type TaggablePart = {
  id: string;
  title: string;
  price: string;
  cover: string | null;
  /** The car it came off, so the current car's parts can lead the list. */
  sourceCarId: string | null;
};

const MAX_TAGGED = 3;

/**
 * W-3 — tag a part on a post.
 *
 * Only the author's own active listings, because a post is a place to say
 * "this is for sale", not a place to advertise somebody else's stock (the
 * database enforces the same rule). The current car's parts come first:
 * somebody posting about their Silvia is overwhelmingly tagging a part that
 * came off the Silvia.
 *
 * Three at most. A post with eight parts tagged has stopped being an update
 * and become a shop window, and the feed is not the marketplace.
 */
export function PartPicker({
  parts,
  carId,
  selected,
  onChange,
}: {
  parts: TaggablePart[];
  carId: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const ordered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matching = q ? parts.filter((p) => p.title.toLowerCase().includes(q)) : parts;
    return [...matching].sort((a, b) => {
      const aHere = a.sourceCarId === carId ? 0 : 1;
      const bHere = b.sourceCarId === carId ? 0 : 1;
      return aHere - bHere;
    });
  }, [parts, query, carId]);

  if (!parts.length) return null;

  function toggle(id: string) {
    onChange(
      selected.includes(id)
        ? selected.filter((s) => s !== id)
        : selected.length >= MAX_TAGGED
          ? selected
          : [...selected, id]
    );
  }

  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}>
        {selected.length ? `Parts (${selected.length})` : "Tag a part"}
      </Button>
      <BottomSheet open={open} onClose={() => setOpen(false)} label="Tag a part" align="center" closeLabel={null}>
        <h2 className="text-section">Tag a part</h2>
        <p className="text-body text-dim">
          Up to {MAX_TAGGED}. They show under the photos with a price and add-to-cart.
        </p>
        <TextField
          id="part-picker-filter"
          label="Find one of your parts"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Type to filter…"
          className="max-w-none"
          fieldClassName="mt-3 !mb-0"
        />
        <div className="rowlist mt-3">
          {ordered.map((part) => {
            const checked = selected.includes(part.id);
            return (
              <ObjectRow
                key={part.id}
                as="label"
                media={{ src: part.cover ?? undefined, alt: "" }}
                title={part.title}
                meta={part.price}
                actions={
                  <input
                    type="checkbox"
                    className="sq"
                    checked={checked}
                    disabled={!checked && selected.length >= MAX_TAGGED}
                    onChange={() => toggle(part.id)}
                    aria-label={`Tag ${part.title}`}
                  />
                }
              />
            );
          })}
          {ordered.length === 0 && (
            <p className="text-body text-dim">Nothing matches that.</p>
          )}
        </div>
        <div className="mt-4">
          <Button onClick={() => setOpen(false)}>Done</Button>
        </div>
      </BottomSheet>
    </>
  );
}
