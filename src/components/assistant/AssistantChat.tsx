"use client";

import { useRef, useState, useTransition } from "react";
import { BTN_PRIMARY, FIELD } from "@/components/tasks/styles";
import { HomeyFace } from "@/components/homey/HomeyFace";

type Msg = { role: "user" | "assistant"; content: string };
type Send = (messages: Msg[]) => Promise<{ ok: true; reply: string; proposed: number } | { ok: false; error: string }>;

/** The conversation lives only in this component's state: closing the tab discards it. */
export function AssistantChat({ send }: { send: Send }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const input = useRef<HTMLTextAreaElement>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = input.current?.value.trim() ?? "";
    if (!text || pending) return;
    const next = [...messages, { role: "user" as const, content: text }].slice(-20);
    setMessages(next);
    setError(null);
    if (input.current) input.current.value = "";
    start(async () => {
      const r = await send(next);
      if (r.ok) {
        // When something was proposed the action revalidates /assistant and its response already
        // carries the new proposal list, so no extra router.refresh() round trip is needed.
        setMessages((m) => [...m, { role: "assistant", content: r.reply }]);
      } else {
        setError(r.error);
      }
    });
  }

  return (
    <section aria-label="Chat" className="flex flex-col gap-3">
      <p className="text-xs text-muted">This chat is not saved. It disappears when you close the page.</p>
      <ul aria-live="polite" className="flex flex-col gap-3 text-sm">
        {messages.map((m, i) =>
          m.role === "user" ? (
            <li key={i} className="flex justify-end">
              <span className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent-soft px-3 py-2">
                <span className="sr-only">You: </span>
                {m.content}
              </span>
            </li>
          ) : (
            <li key={i} className="flex items-end gap-2">
              <HomeyAvatar />
              <span className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-sm border border-border bg-surface px-3 py-2">
                <span className="sr-only">Homey: </span>
                {m.content}
              </span>
            </li>
          ),
        )}
        {pending ? (
          <li className="flex items-end gap-2 text-muted">
            <HomeyAvatar talking />
            <span>Thinking...</span>
          </li>
        ) : null}
      </ul>
      {error ? (
        <p role="alert" className="rounded-md border border-warning-border bg-warning-bg px-3 py-2 text-sm font-medium text-warning-fg">
          {error}
        </p>
      ) : null}
      <form
        onSubmit={submit}
        className="sticky bottom-[calc(var(--tabbar-height)+env(safe-area-inset-bottom))] z-20 flex items-end gap-2 border-t border-border bg-background pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 lg:bottom-0"
      >
        <label className="flex-1">
          <span className="sr-only">Ask Homey</span>
          <textarea ref={input} rows={1} maxLength={2000} required placeholder="Ask Homey..." className={FIELD} />
        </label>
        <button type="submit" disabled={pending} className={BTN_PRIMARY}>
          Send
        </button>
      </form>
    </section>
  );
}

/** Homey beside his replies. A fixed 28px box, so the face's motion never moves the text. */
function HomeyAvatar({ talking = false }: { talking?: boolean }) {
  return (
    <span aria-hidden="true" className="homey-avatar inline-flex h-7 w-7 shrink-0 items-center justify-center">
      <HomeyFace expression="smiley" size={28} talking={talking} />
    </span>
  );
}
