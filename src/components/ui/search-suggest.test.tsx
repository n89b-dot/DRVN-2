// @vitest-environment jsdom
import { act } from "react";
import { flushSync } from "react-dom";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The search box is server-rendered and usable before its code arrives. What
 * a visitor types in that gap has to survive hydration, and everything the
 * field did while React controlled its text has to keep working now that the
 * input owns it.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const { SuggestingSearchField } = await import("./search-suggest");
type Group = import("./search-suggest").SearchSuggestGroup;

const GROUPS: Group[] = [
  {
    kind: "parts",
    label: "Parts",
    items: [{ id: "p1", label: "APR intake", sub: "$385.00", href: "/parts/apr" }],
  },
  {
    kind: "builds",
    label: "Builds",
    items: [{ id: "b1", label: "Track Golf", sub: "2024 Golf R", href: "/cars/track-golf" }],
  },
];

const fetcher = vi.fn(async (q: string) => {
  void q;
  return GROUPS;
});

function field(defaultValue?: string) {
  return (
    <form action="/explore" role="search">
      <SuggestingSearchField
        label="Search DRVN"
        defaultValue={defaultValue}
        endpoint="/unused"
        fetcher={fetcher}
      />
    </form>
  );
}

let container: HTMLDivElement;
let root: Root | null = null;

const input = () => container.querySelector("input")!;

/** What a keystroke does: the platform sets the value (not React's tracked
 *  setter), then an `input` event bubbles. */
function type(text: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  setter.call(input(), text);
  input().dispatchEvent(new Event("input", { bubbles: true }));
}

function press(key: string) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true });
  input().dispatchEvent(event);
  return event;
}

/** Past the 150 ms debounce and the fetcher's promise. */
const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 220)); });

async function serverRender(defaultValue?: string) {
  container.innerHTML = renderToString(field(defaultValue));
}

async function hydrate(defaultValue?: string) {
  await act(async () => {
    root = hydrateRoot(container, field(defaultValue), {
      onRecoverableError(error) {
        throw error;
      },
    });
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.appendChild(container);
  fetcher.mockClear();
  push.mockClear();
});

afterEach(async () => {
  await act(async () => root?.unmount());
  root = null;
  container.remove();
});

describe("SuggestingSearchField", () => {
  it("renders a plain GET field on the server: named, with the URL's query", async () => {
    await serverRender("golf");
    expect(input().getAttribute("name")).toBe("q");
    expect(input().getAttribute("value")).toBe("golf");
    expect(input().getAttribute("type")).toBe("search");
    expect(input().getAttribute("role")).toBe("combobox");
    expect(input().disabled).toBe(false);
  });

  it("keeps text typed before hydration and suggests from it", async () => {
    await serverRender();
    input().focus();
    type("track go");

    await hydrate();
    expect(input().value).toBe("track go");

    await settle();
    expect(input().value).toBe("track go");
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe("track go");
    expect(input().getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(".combo__all")?.textContent).toContain("track go");
    // The form would submit what is in the box.
    expect(new FormData(container.querySelector("form")!).get("q")).toBe("track go");
  });

  it("keeps early text when the field re-renders without an edit", async () => {
    // A phone: the group cap's media query answers differently from the
    // server, so the field re-renders straight after hydration. A controlled
    // input was put back to its initial text by exactly this render.
    window.matchMedia = ((query: string) => ({
      matches: true,
      media: query,
      addEventListener() {},
      removeEventListener() {},
    })) as unknown as typeof window.matchMedia;
    await serverRender();
    type("left alone");

    await hydrate();
    expect(input().value).toBe("left alone");
    // And the bar re-rendering around it (counts streaming in, the menu).
    await act(async () => root!.render(field()));
    expect(input().value).toBe("left alone");
    expect(new FormData(container.querySelector("form")!).get("q")).toBe("left alone");
  });

  it("keeps early text over a server query, without fetching for the stale one", async () => {
    await serverRender("golf");
    input().focus();
    type("golf r intake");

    await hydrate("golf");
    await settle();
    expect(input().value).toBe("golf r intake");
    expect(fetcher.mock.calls.map((call) => call[0])).toEqual(["golf r intake"]);
  });

  it("keeps restored text in an unfocused field but stays quiet about it", async () => {
    await serverRender();
    type("left behind");
    input().blur();

    await hydrate();
    await settle();
    expect(input().value).toBe("left behind");
    expect(fetcher).not.toHaveBeenCalled();
    expect(input().getAttribute("aria-expanded")).toBe("false");
  });

  it("does not open over the URL's own query on load", async () => {
    await serverRender("golf");
    input().focus();
    await hydrate("golf");
    await settle();
    expect(input().value).toBe("golf");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("suggests when the browser lets React render between the input's own listener and React's handler", async () => {
    // A real keystroke or paste is dispatched by the browser with nothing on
    // the stack, so microtasks — React's re-render and its effects — run
    // after the listener on the input itself and BEFORE the event reaches
    // React's onChange at the root. A script-dispatched event (most test
    // helpers) never shows this. flushSync in a listener registered after the
    // field's own stands in for that checkpoint.
    await act(async () => {
      root = createRoot(container);
      root.render(field());
    });
    input().addEventListener("input", () => flushSync(() => {}));
    input().focus();
    await act(async () => type("apr intake"));
    await settle();
    expect(fetcher).toHaveBeenCalledWith("apr intake", expect.anything());
    expect(input().getAttribute("aria-expanded")).toBe("true");
  });

  it("suggests, walks the options with the keyboard, and navigates on Enter", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(field());
    });
    input().focus();
    await act(async () => type("go"));
    await settle();

    expect(fetcher).toHaveBeenCalledWith("go", expect.anything());
    const listbox = container.querySelector("[role=listbox]")!;
    expect(input().getAttribute("aria-controls")).toBe(listbox.id);
    // Builds are ordered ahead of parts, then the pinned "Search for …" row.
    const options = [...container.querySelectorAll("[role=option]")];
    expect(options.map((option) => option.textContent)).toEqual([
      "Track Golf2024 Golf R",
      "APR intake$385.00",
      "Search for “go”→",
    ]);
    expect(input().hasAttribute("aria-activedescendant")).toBe(false);

    await act(async () => { press("ArrowDown"); });
    expect(input().getAttribute("aria-activedescendant")).toBe(options[0].id);
    expect(options[0].getAttribute("aria-selected")).toBe("true");
    await act(async () => { press("ArrowUp"); });
    expect(input().getAttribute("aria-activedescendant")).toBe(options[2].id);
    await act(async () => { press("ArrowDown"); });

    // Escape closes and keeps the text; ArrowDown reopens on the first option.
    await act(async () => { press("Escape"); });
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(input().value).toBe("go");
    await act(async () => { press("ArrowDown"); });
    expect(input().getAttribute("aria-expanded")).toBe("true");

    let enter!: KeyboardEvent;
    await act(async () => { enter = press("Enter"); });
    expect(enter.defaultPrevented).toBe(true);
    expect(push).toHaveBeenCalledWith("/cars/track-golf");
  });

  it("leaves Enter alone when no option is active, so the form submits", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(field());
    });
    input().focus();
    await act(async () => type("go"));
    await settle();
    let enter!: KeyboardEvent;
    await act(async () => { enter = press("Enter"); });
    expect(enter.defaultPrevented).toBe(false);
    expect(push).not.toHaveBeenCalled();
  });

  it("closes and clears suggestions when the text drops under the threshold", async () => {
    await act(async () => {
      root = createRoot(container);
      root.render(field());
    });
    input().focus();
    await act(async () => type("go"));
    await settle();
    expect(input().getAttribute("aria-expanded")).toBe("true");
    await act(async () => type("g"));
    expect(input().getAttribute("aria-expanded")).toBe("false");
    expect(input().value).toBe("g");
  });

  it("keeps the typed query through a form reset, as it did when controlled", async () => {
    await serverRender("golf");
    await hydrate("golf");
    input().focus();
    await act(async () => type("golf r"));
    expect(input().getAttribute("value")).toBe("golf r");
    await act(async () => container.querySelector("form")!.reset());
    expect(input().value).toBe("golf r");
  });
});
