"use client";

import { useRef, useState } from "react";
import { Button, FinderRefineSheet, SearchField } from "@/components/ui";

export function FinderDemo() {
  const form = useRef<HTMLFormElement>(null);
  const [condition, setCondition] = useState("");
  return (
    <form ref={form} className="finder !mb-0" onSubmit={event => { event.preventDefault(); setCondition(String(new FormData(event.currentTarget).get("condition") ?? "")); }}>
      <div className="finder__main">
        <SearchField label="Search parts specimen" placeholder="Search parts" />
        <FinderRefineSheet activeCount={condition ? 1 : 0} onDismiss={() => form.current?.reset()}>
          <select key={condition} name="condition" aria-label="Specimen condition" defaultValue={condition} className="ctl w-full">
            <option value="">Any condition</option><option value="used">Used</option><option value="new">New</option>
          </select>
          <Button type="submit">Apply filters</Button>
        </FinderRefineSheet>
      </div>
      <p role="status">Applied condition: {condition || "Any"}. Cancel restores this applied value.</p>
    </form>
  );
}
