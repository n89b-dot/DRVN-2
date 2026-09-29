"use client";

import { useState } from "react";

import { ChatComposer, ResultNote } from "@/components/ui";

/** The production composer with local state — type, press Enter (Shift+Enter
 *  for a new line), attach a photo; nothing is sent anywhere. */
export function ChatComposerDemo() {
  const [value, setValue] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [files, setFiles] = useState(0);
  return (
    <ChatComposer
      value={value}
      onValueChange={setValue}
      canSend={value.trim().length > 0 || files > 0}
      onSend={() => {
        setNote(`Would send ${value.trim() ? `"${value.trim().slice(0, 40)}"` : ""}${files ? ` + ${files} photo${files === 1 ? "" : "s"}` : ""}.`);
        setValue("");
        setFiles(0);
      }}
      placeholder="Message Kaito…"
      inputLabel="Message Kaito"
      onFiles={(picked) => setFiles((n) => Math.min(4, n + picked.length))}
      above={<span className="chatbox__topic">About Selling · E46 M3 front sport seats · Ship it{files ? ` · ${files} photo${files === 1 ? "" : "s"} attached` : ""}</span>}
      below={<ResultNote ok={note} />}
    />
  );
}
