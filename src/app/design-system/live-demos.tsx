"use client";

import { useState } from "react";

import { TabNav } from "@/components/ui";

export function TabNavDemo() {
  const [tab, setTab] = useState("About");
  return (
    <div>
      <TabNav tabs={["About", "Activity"]} active={tab} onChange={setTab} />
      <p className="mt-3 text-sm text-text-muted">Active tab: {tab}</p>
    </div>
  );
}
