"use client";
import { useState } from "react";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { Dialog } from "@/components/ui/dialog";
/** Uses the production primitives to exercise nested focus and scroll ownership. */
export function DialogDemo() {
  const [outer, setOuter] = useState(false), [inner, setInner] = useState(false);
  return <div>
    <button type="button" className="btn" onClick={() => setOuter(true)}>Open nested dialog example</button>
    <BottomSheet open={outer} onClose={() => setOuter(false)} label="Outer example">
      <button type="button" className="btn" onClick={() => setInner(true)}>Open inner example</button>
      <Dialog open={inner} onClose={() => setInner(false)} label="Inner example" align="center" className="p-6 bg-[var(--paper)]">
        <p>This panel has no editable content.</p>
      </Dialog>
    </BottomSheet>
  </div>;
}
