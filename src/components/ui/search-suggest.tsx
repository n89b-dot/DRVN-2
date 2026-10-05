"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
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
 *
 * The typed text belongs to the input, not to React state. The field is
 * server-rendered and usable before its code arrives, so a visitor can type
 * (and submit) before hydration; a React-controlled `value` would put the
 * field back to its initial text the moment React took over. So the input is
 * uncontrolled and the component reads its text from the DOM
 * (`useSyncExternalStore` over the input's own `input` events): whatever is
 * in the box when React arrives is the query, and suggestions carry on from
 * it. React only mirrors that text into the `value` attribute — as it did
 * when the field was controlled — so a `form.reset()` leaves the query alone.
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

/** Buyable results before chatter: parts are the only thing a suggestion can
 *  sell, and on a phone they used to sit below the popover's cut, under
 *  three updates. Unlisted kinds keep the endpoint's order after these. */
const GROUP_ORDER = ["builds", "parts", "accounts", "updates"];

/** Phones get two per group so every group fits the popover without a
 *  hidden scroll; wider screens take what the endpoint sends. */
const PHONE_QUERY = "(max-width: 639px)";
const PHONE_CAP = 2;

function subscribePhone(cb: () => void) {
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener("change", cb);
  return () => mq.removeEventListener("change", cb);
}

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
  const initialQuery = defaultValue ?? "";
  const inputRef = useRef<HTMLInputElement>(null);
  // The first render's query is the URL's — don't immediately reopen a
  // popover over results the server already delivered.
  const interactedRef = useRef(false);
  // The input is the store. Subscribed natively on the element so the text
  // is re-read on every edit, whoever made it. An edit is also what counts
  // as interaction, and it is marked here rather than in onChange below: for
  // a real keystroke or paste the browser runs React's re-render (and the
  // fetch effect) after this listener and before the event reaches React's
  // handler, so a flag set there was still false when the effect looked.
  const subscribeQuery = useCallback((onChange: () => void) => {
    const input = inputRef.current;
    if (!input) return () => {};
    const onInput = () => {
      interactedRef.current = true;
      onChange();
    };
    input.addEventListener("input", onInput);
    return () => input.removeEventListener("input", onInput);
  }, []);
  // Server and hydration render with the server's text; straight after
  // hydration React compares it with the box and re-renders if a visitor has
  // already typed something else. Before the input exists (a client-side
  // first render) the text can only be the initial one.
  const query = useSyncExternalStore(
    subscribeQuery,
    () => inputRef.current?.value ?? initialQuery,
    () => initialQuery
  );
  const [groups, setGroups] = useState<SearchSuggestGroup[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const phone = useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false
  );
  const shown = useMemo(() => {
    const rank = (kind: string) => {
      const i = GROUP_ORDER.indexOf(kind);
      return i === -1 ? GROUP_ORDER.length : i;
    };
    return [...groups]
      .sort((a, b) => rank(a.kind) - rank(b.kind))
      .map((g) => ({ ...g, items: phone ? g.items.slice(0, PHONE_CAP) : g.items }))
      .filter((g) => g.items.length > 0);
  }, [groups, phone]);
  const flat = useMemo(() => shown.flatMap((g) => g.items), [shown]);
  // Global option indices per group, precomputed so render never counts.
  const indexed = useMemo(() => {
    let i = 0;
    return shown.map((group) => ({
      ...group,
      items: group.items.map((item) => ({ item, index: i++ })),
    }));
  }, [shown]);
  // The last option is always "Search for …" — the full results page, one
  // tap away, where the capped groups end.
  const allIndex = flat.length;
  const optionCount = flat.length + 1;

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

  // Text typed before this component was live counts as interaction when the
  // visitor is still in the field: the re-render that adopts it then fetches
  // suggestions for it. Text the browser restored into an unfocused field
  // stays quiet. Declared after the fetch effect on purpose — on the first
  // pass that effect must still see "not interacted" (its query is the
  // server's); the adopting re-render comes after this has run.
  useEffect(() => {
    const input = inputRef.current;
    if (!input || input.value === input.defaultValue) return;
    if (document.activeElement === input) interactedRef.current = true;
  }, []);

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

  const searchAll = () => {
    setOpen(false);
    const form = rootRef.current?.closest("form");
    if (form) form.requestSubmit();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (!flat.length) return;
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActiveIndex(event.key === "ArrowDown" ? 0 : optionCount - 1);
        return;
      }
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (current + delta + optionCount) % optionCount);
    } else if (event.key === "Enter") {
      if (open && activeIndex >= 0 && flat[activeIndex]) {
        event.preventDefault();
        commit(flat[activeIndex]);
      }
      // The "Search for …" row, or no selection: the natural GET submit.
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
    <div
      ref={rootRef}
      className={cx("combo combo--suggest w-full max-w-none flex-[1_1_220px]", className)}
    >
      <label className="search">
        <Icon name="search" className="h-4 w-4 shrink-0" />
        <input
          ref={inputRef}
          type="search"
          name={name}
          // Uncontrolled: the attribute follows the text, the text itself is
          // never written by React (see the component note).
          defaultValue={query}
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
            const next = event.target.value;
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
                        <span className="combo__optlabel">{item.label}</span>
                        {item.sub && <span className="combo__optnote">{item.sub}</span>}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
              <li
                id={optionId(allIndex)}
                role="option"
                aria-selected={activeIndex === allIndex}
                className={cx("combo__opt combo__all", activeIndex === allIndex && "is-active")}
                onPointerDown={(event) => {
                  event.preventDefault();
                  searchAll();
                }}
                onPointerMove={() => setActiveIndex(allIndex)}
              >
                <span className="combo__optlabel">Search for &ldquo;{query.trim()}&rdquo;</span>
                <span aria-hidden="true">→</span>
              </li>
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
