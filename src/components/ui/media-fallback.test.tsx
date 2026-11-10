// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isUnsignedMemberPhoto } from "@/lib/photo-urls";

import { PhotoImage } from "./photo-image";
import { Media } from "./primitives";

const mocks = vi.hoisted(() => ({ reportUnsignedPhoto: vi.fn<(src: string) => void>() }));
vi.mock("@/lib/photo-report", () => ({ reportUnsignedPhoto: mocks.reportUnsignedPhoto }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const O = "https://proj.supabase.co";
const unsigned = `${O}/storage/v1/object/public/car-images/11111111-1111-4111-8111-111111111111/a.webp`;
const signed = `${O}/storage/v1/object/sign/car-images/11111111-1111-4111-8111-111111111111/a.webp?token=abc`;

let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  mocks.reportUnsignedPhoto.mockClear();
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

describe("N1053: an unsigned member photo that reaches a page is reported, not only hidden (work review #137)", () => {
  it("N1053: the card frame and the plain image both report the photo they could not show", () => {
    act(() => root.render(<Media src={unsigned} alt="Cover" />));
    expect(mocks.reportUnsignedPhoto).toHaveBeenCalledWith(unsigned);
    mocks.reportUnsignedPhoto.mockClear();
    act(() => root.render(<PhotoImage src={unsigned} alt="Cover" width={40} height={40} />));
    expect(mocks.reportUnsignedPhoto).toHaveBeenCalledWith(unsigned);
  });

  it("N1053: a signed photo, a failed load, a site image and no photo at all report nothing", () => {
    act(() => root.render(<Media src={signed} alt="Cover" />));
    act(() => {
      host.querySelector("img")!.dispatchEvent(new Event("error"));
    });
    act(() => root.render(<Media src="/seed/cars/1.webp" alt="Cover" />));
    act(() => root.render(<Media src={undefined} alt="Cover" />));
    expect(mocks.reportUnsignedPhoto).not.toHaveBeenCalled();
  });
});
