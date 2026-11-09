// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isUnsignedMemberPhoto } from "@/lib/photo-urls";

import { Media } from "./primitives";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const O = "https://proj.supabase.co";
const unsigned = `${O}/storage/v1/object/public/car-images/11111111-1111-4111-8111-111111111111/a.webp`;
const signed = `${O}/storage/v1/object/sign/car-images/11111111-1111-4111-8111-111111111111/a.webp?token=abc`;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("a photo the storage layer would refuse shows the no-photo plate (N940, report five #105)", () => {
  it("recognises a member photo still in its canonical spelling, and nothing else", () => {
    expect(isUnsignedMemberPhoto(unsigned)).toBe(true);
    expect(isUnsignedMemberPhoto(signed)).toBe(false);
    expect(isUnsignedMemberPhoto(`${O}/storage/v1/object/public/avatars/me.webp`)).toBe(false);
    expect(isUnsignedMemberPhoto("/seed/cars/1.webp")).toBe(false);
    expect(isUnsignedMemberPhoto(undefined)).toBe(false);
  });

  it("renders the plate, not an image, for an unsigned member photo", () => {
    act(() => root.render(<Media src={unsigned} alt="Cover" fallbackClassName="plate-undrawn" />));
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector('[role="img"][aria-label="Cover"]')).not.toBeNull();
  });

  it("renders a signed photo, and falls back to the plate when it fails to load", () => {
    act(() => root.render(<Media src={signed} alt="Cover" />));
    const img = host.querySelector("img");
    expect(img).not.toBeNull();
    act(() => {
      img!.dispatchEvent(new Event("error"));
    });
    expect(host.querySelector("img")).toBeNull();
    expect(host.querySelector('[role="img"][aria-label="Cover"]')).not.toBeNull();
  });
});
