"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CitationChip } from "./CitationChip";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  streaming?: boolean;
  citations?: string[];
}

interface Props {
  messages: ChatMessage[];
  onCitationClick: (vault_path: string) => void;
}

export function parseCitations(text: string): { body: string; cites: string[] } {
  const m = text.match(/<citations>([\s\S]*?)<\/citations>/i);
  if (!m) {
    const self = text.match(/<citations\s*\/>/i);
    if (self) return { body: text.replace(/<citations\s*\/>/i, "").trim(), cites: [] };
    return { body: text, cites: [] };
  }
  const inner = m[1];
  const cites = Array.from(inner.matchAll(/<cite\s+path="([^"]+)"\s*\/?>/g)).map((x) => x[1]);
  const body = text.replace(m[0], "").trim();
  return { body, cites: Array.from(new Set(cites)) };
}

export function ChatMessages({ messages, onCitationClick }: Props) {
  return (
    <div className="flex flex-col gap-4 px-6 py-5">
      {messages.map((msg) => {
        if (msg.role === "user") {
          return (
            <div
              key={msg.id}
              className="self-end max-w-[80%] px-3 py-2 bg-raised border border-border-default rounded-lg text-sm text-text-primary"
              style={{ borderBottomRightRadius: "2px" }}
            >
              {msg.content}
            </div>
          );
        }
        const { body, cites } = parseCitations(msg.content);
        const renderedCites = msg.citations?.length ? msg.citations : cites;
        return (
          <div key={msg.id} className="max-w-[92%] text-sm text-text-primary leading-relaxed">
            <div className={msg.streaming ? "streaming-caret" : ""}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{body}</ReactMarkdown>
            </div>
            {renderedCites.length > 0 && (
              <div className="flex gap-1.5 flex-wrap mt-2">
                {renderedCites.map((p) => (
                  <CitationChip key={p} vault_path={p} onClick={() => onCitationClick(p)} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
