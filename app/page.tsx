"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { ChatMessages, parseCitations, type ChatMessage } from "@/components/chat/ChatMessages";
import { ChatInput } from "@/components/chat/ChatInput";
import { ScopeBadge } from "@/components/chat/ScopeBadge";
import { useToast } from "@/components/chat/ToastProvider";
import { ReadingPane } from "@/components/ReadingPane";

interface SuggestedPromptsResponse {
  prompts: string[];
}

function newId() {
  return Math.random().toString(36).slice(2);
}

function ChatPageInner() {
  const router = useRouter();
  const { show } = useToast();
  const [profileReady, setProfileReady] = useState<boolean | null>(null);
  const [activeModel, setActiveModel] = useState<string>("");
  const [selectedBinId, setSelectedBinId] = useState<string | null>(null);
  const [scopeName, setScopeName] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [suggested, setSuggested] = useState<string[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [readingPath, setReadingPath] = useState<string | null>(null);
  const [presetText, setPresetText] = useState<string>("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/settings/profiles")
      .then((r) => r.json())
      .then((d: { profiles: { id: string; default_model?: string }[]; active_id: string | null }) => {
        if (!d.active_id) {
          setProfileReady(false);
          return;
        }
        setProfileReady(true);
        const active = d.profiles.find((p) => p.id === d.active_id);
        if (active?.default_model) setActiveModel(active.default_model);
      });
  }, []);

  useEffect(() => {
    const host = document.querySelector("main");
    const observer = new MutationObserver(() => {
      const binAttr = host?.getAttribute("data-selected-bin") ?? "";
      setSelectedBinId(binAttr ? binAttr : null);
    });
    if (host) observer.observe(host, { attributes: true, attributeFilter: ["data-selected-bin"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!selectedBinId) {
      setScopeName(null);
      return;
    }
    fetch(`/api/bins`)
      .then((r) => r.json())
      .then((d: { bins: { id: string; name: string; children?: { id: string; name: string }[] }[] }) => {
        const find = (nodes: typeof d.bins, id: string, path: string[]): string[] | null => {
          for (const n of nodes) {
            const next = [...path, n.name];
            if (n.id === id) return next;
            if (n.children) {
              const inner = find(n.children as typeof d.bins, id, next);
              if (inner) return inner;
            }
          }
          return null;
        };
        const p = find(d.bins, selectedBinId, []);
        setScopeName(p ? p.join(" / ") : null);
      });
  }, [selectedBinId]);

  useEffect(() => {
    fetch("/api/chat/suggested-prompts")
      .then((r) => (r.ok ? (r.json() as Promise<SuggestedPromptsResponse>) : { prompts: [] }))
      .then((d) => setSuggested(d.prompts ?? []))
      .catch(() => setSuggested([]));
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const submit = useCallback(
    async (text: string) => {
      const userMsg: ChatMessage = { id: newId(), role: "user", content: text };
      const assistantMsg: ChatMessage = { id: newId(), role: "assistant", content: "", streaming: true };
      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setStreaming(true);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...messages, userMsg].map((m) => ({ role: m.role, content: m.content })),
            scope_bin_id: selectedBinId,
          }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          show(data.error ?? `Chat failed (${res.status})`, "error");
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsg.id ? { ...m, content: "(agent unavailable)", streaming: false } : m
            )
          );
          setStreaming(false);
          return;
        }
        if (!res.body) throw new Error("no response body");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let citations: string[] = [];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            let event: { type: string; text?: string; message?: string; paths?: string[] };
            try {
              event = JSON.parse(data);
            } catch {
              continue;
            }
            if (event.type === "retrieved" && event.paths) {
              citations = event.paths;
            } else if (event.type === "text" && event.text) {
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id ? { ...m, content: m.content + event.text } : m
                )
              );
            } else if (event.type === "error") {
              show(event.message ?? "Agent error", "error");
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsg.id ? { ...m, content: m.content + " (agent error)" } : m
                )
              );
            }
          }
        }
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== assistantMsg.id) return m;
            const { cites } = parseCitations(m.content);
            return { ...m, streaming: false, citations: cites.length > 0 ? cites : citations };
          })
        );
      } catch (err) {
        show(err instanceof Error ? err.message : "Agent unreachable", "error");
        setMessages((prev) =>
          prev.map((m) => (m.id === assistantMsg.id ? { ...m, streaming: false } : m))
        );
      } finally {
        setStreaming(false);
      }
    },
    [messages, selectedBinId, show]
  );

  if (profileReady === null) {
    return <div className="text-xs text-text-muted p-6">Loading…</div>;
  }

  return (
    <div className="flex flex-col h-screen">
      {scopeName && (
        <div className="border-b border-border-subtle px-6 py-2 flex items-center gap-3">
          <span className="mono text-2xs text-text-subtle uppercase tracking-wider">Scope</span>
          <ScopeBadge label={scopeName.toLowerCase()} onClear={() => setSelectedBinId(null)} />
          {activeModel && (
            <span className="ml-auto mono text-2xs text-text-dim">{activeModel}</span>
          )}
        </div>
      )}
      <div className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="h-full flex items-center justify-center">
            <ChatEmptyState
              user_name="Carter"
              has_profile={profileReady}
              suggested_prompts={suggested}
              onPickPrompt={(p) => setPresetText(p)}
              onGoToSettings={() => router.push("/settings")}
            />
          </div>
        ) : (
          <>
            <ChatMessages messages={messages} onCitationClick={setReadingPath} />
            <div ref={messagesEndRef} />
          </>
        )}
      </div>
      <ChatInput onSubmit={submit} disabled={streaming || !profileReady} presetText={presetText} />
      {readingPath && (
        <ReadingPane path={readingPath} onClose={() => setReadingPath(null)} />
      )}
    </div>
  );
}

export default function ChatPage() {
  return <ChatPageInner />;
}
