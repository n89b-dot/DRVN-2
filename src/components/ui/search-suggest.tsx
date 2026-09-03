"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

import { cx } from "@/lib/format";
import { surface } from "@/lib/motion";

import { Icon } from "./icons";

/**
 * SuggestingSearchField — the `.search` plate with grouped autocomplete
 * (ARIA 1.2 combobox over a grouped listbox, on the `.combo` popover
 * recipe). A progressive enhancement over a GET search form: without JS (or
 * before any suggestion arrives) the field submits the form exactly like
 * SearchField; with it, a short query surfaces a compact set of direct
 * destinations fetched from `endpoint` (`?q=` → `{ groups: [{ kind, label,
 * items: [{ id, label, sub, href }] }] }`).
 *
 * Orientation aid, not a results page: the popover never paginates, never
 * blocks typing (requests are debounced, stale responses dropped via
 * AbortController), and Enter without an active option is a normal form
 * submit. Escape closes the popover first and only then falls through to
 * the input's native clear.
 */

export type SearchSuggestItem = {
  id: string;
  label: string;
  /** Dim supporting text after the label (a vehicle, a price, a handle). */
  sub: string | null;
  href: string;
};

export type SearchSuggestGroup = {
  kind: string;
  label: string;
  items: SearchSuggestItem[];
};

const DEBOUNCE_MS = 150;

export function SuggestingSearchField({
  label,
  name = "q",
  defaultValue,
  placeholder,
  endpoint,
  minQuery = 2,
  fetcher,
  className,
}: {
  /** Accessible name — required; the placeholder is documentation, not a label. */
  label: string;
  name?: string;
  defaultValue?: string;
  placeholder?: string;
  /** GET endpoint answering `?q=` with `{ groups: SearchSuggestGroup[] }`. */
  endpoint: string;
  minQuery?: number;
  /** Test/story seam: replaces the endpoint fetch. Production callers use
   *  `endpoint`. */
  fetcher?: (q: string, signal: AbortSignal) => Promise<SearchSuggestGroup[]>;
  className?: string;
}) {
  const router = useRouter();
  const listboxId = useId();
  const [query, setQuery] = useState(defaultValue ?? "");
  const [groups, setGroups] = useState<SearchSuggestGroup[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  // The first render's query is the URL's — don't immediately reopen a
  // popover over results the server already delivered.
  const interactedRef = useRef(false);

  const flat = useMemo(() => groups.flatMap((g) => g.items), [groups]);
  // Global option indices per group, precomputed so render never counts.
  const indexed = useMemo(() => {
    let i = 0;
    return groups.map((group) => ({
      ...group,
      items: group.items.map((item) => ({ item, index: i++ })),
    }));
  }, [groups]);

  useEffect(() => {
    if (!interactedRef.current) return;
    const term = query.trim();
    abortRef.current?.abort();
    // Under-threshold queries are cleared in the change handler; here they
    // just mean "nothing to fetch".
    if (term.length < minQuery) return;
    const controller = new AbortController();
    abortRef.current = controller;
    const timer = setTimeout(async () => {
      try {
        let next: SearchSuggestGroup[];
        if (fetcher) {
          next = await fetcher(term, controller.signal);
        } else {
          const res = await fetch(`${endpoint}?q=${encodeURIComponent(term)}`, {
            signal: controller.signal,
          });
          if (!res.ok) return;
          const body = (await res.json()) as { groups?: SearchSuggestGroup[] };
          next = body.groups ?? [];
        }
        if (controller.signal.aborted) return; // stale — a newer keystroke won
        setGroups(next);
        setActiveIndex(-1);
        setOpen(next.length > 0);
      } catch {
        // Aborted or offline: the form still submits — suggestions are a bonus.
      }
    }, DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, endpoint, minQuery, fetcher]);

  // Close on outside pointerdown — blur alone misfires when clicking options.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const optionId = (index: number) => `${listboxId}-opt-${index}`;

  const commit = (item: SearchSuggestItem) => {
    setOpen(false);
    router.push(item.href);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!flat.length) return;
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(event.key === "ArrowDown" ? 0 : flat.length - 1);
        return;
      }
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + delta + flat.length) % flat.length);
    } else if (event.key === "Enter") {
      if (open && activeIndex >= 0 && flat[activeIndex]) {
        event.preventDefault();
        commit(flat[activeIndex]);
      }
      // else: natural GET submit — the full results page is the answer.
    } else if (event.key === "Escape") {
      if (open) {
        // Close the popover, keep the text — a second Escape reaches the
        // native search-input clear.
        event.preventDefault();
        setOpen(false);
      }
    }
  };

  return (
    <div ref={rootRef} className={cx("combo w-full max-w-none flex-[1_1_220px]", className)}>
      <label className="search">
        <Icon name="search" className="h-4 w-4 shrink-0" />
        <input
          type="search"
          name={name}
          value={query}
          placeholder={placeholder}
          aria-label={label}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && activeIndex >= 0 ? optionId(activeIndex) : undefined
          }
          autoComplete="off"
          onChange={(event) => {
            interactedRef.current = true;
            const next = event.target.value;
            setQuery(next);
            if (next.trim().length < minQuery) {
              setGroups([]);
              setOpen(false);
            }
          }}
          onFocus={() => {
            if (interactedRef.current && groups.length) setOpen(true);
          }}
          onKeyDown={onKeyDown}
        />
      </label>
      <AnimatePresence>
        {open && (
          <motion.div
            className="combo__pop"
            variants={surface}
            initial="hidden"
            animate="visible"
            exit="exit"
          >
            <ul id={listboxId} role="listbox" aria-label={label} className="combo__list">
              {indexed.map((group) => (
                <li key={group.kind} role="presentation">
                  <span className="combo__note block" role="presentation">
                    {group.label}
                  </span>
                  <ul role="group" aria-label={group.label} className="m-0 list-none p-0">
                    {group.items.map(({ item, index }) => (
                      <li
                        key={item.id}
                        id={optionId(index)}
                        role="option"
                        aria-selected={index === activeIndex}
                        className={cx("combo__opt", index === activeIndex && "is-active")}
                        onPointerDown={(event) => {
                          // Land before blur closes the popover.
                          event.preventDefault();
                          commit(item);
                        }}
                        onPointerMove={() => setActiveIndex(index)}
                      >
                        <span className="min-w-0 truncate">{item.label}</span>
                        {item.sub && <span className="combo__optnote">{item.sub}</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
