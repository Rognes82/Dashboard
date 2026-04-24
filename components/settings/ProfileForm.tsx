"use client";

import { useState } from "react";
import type { LlmProviderType } from "@/lib/llm/types";

interface Props {
  initial?: {
    id?: string;
    name: string;
    type: LlmProviderType;
    default_model: string;
    base_url?: string;
    max_context_tokens: number;
  };
  onSave: (input: {
    id?: string;
    name: string;
    type: LlmProviderType;
    api_key?: string;
    default_model: string;
    base_url?: string;
    max_context_tokens: number;
  }) => void;
  onCancel: () => void;
}

export function ProfileForm({ initial, onSave, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? "");
  const [type, setType] = useState<LlmProviderType>(initial?.type ?? "anthropic");
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState(initial?.base_url ?? "");
  const [model, setModel] = useState(initial?.default_model ?? "claude-opus-4-7");
  const [maxCtx, setMaxCtx] = useState<number>(initial?.max_context_tokens ?? 200_000);
  const isEdit = !!initial?.id;

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (!model.trim()) return;
    if (!isEdit && !apiKey.trim()) return;
    if (type === "openai-compatible" && !baseUrl.trim()) return;
    onSave({
      id: initial?.id,
      name: name.trim(),
      type,
      api_key: apiKey.trim() || undefined,
      default_model: model.trim(),
      base_url: type === "openai-compatible" ? baseUrl.trim() : undefined,
      max_context_tokens: maxCtx,
    });
  }

  return (
    <form onSubmit={submit} className="bg-sunken border border-border-default rounded-md p-4 flex flex-col gap-3 mono text-2xs">
      <div className="grid grid-cols-[100px_1fr] items-center gap-x-3 gap-y-2">
        <label className="text-text-subtle">name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} className="bg-base border border-border-strong rounded-sm px-2 py-1 text-text-primary focus:border-accent focus:outline-none" />
        <label className="text-text-subtle">type</label>
        <select value={type} onChange={(e) => setType(e.target.value as LlmProviderType)} className="bg-base border border-border-strong rounded-sm px-2 py-1 text-text-primary focus:border-accent focus:outline-none">
          <option value="anthropic">anthropic (native)</option>
          <option value="openai-compatible">openai-compatible</option>
        </select>
        <label className="text-text-subtle">api key</label>
        <input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder={isEdit ? "leave blank to keep existing" : "sk-…"} className="bg-base border border-border-strong rounded-sm px-2 py-1 text-text-primary focus:border-accent focus:outline-none" />
        {type === "openai-compatible" && (
          <>
            <label className="text-text-subtle">base url</label>
            <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://openrouter.ai/api/v1" className="bg-base border border-border-strong rounded-sm px-2 py-1 text-text-primary focus:border-accent focus:outline-none" />
          </>
        )}
        <label className="text-text-subtle">model</label>
        <input value={model} onChange={(e) => setModel(e.target.value)} placeholder="claude-opus-4-7" className="bg-base border border-border-strong rounded-sm px-2 py-1 text-text-primary focus:border-accent focus:outline-none" />
        <label className="text-text-subtle">context</label>
        <input type="number" value={maxCtx} onChange={(e) => setMaxCtx(Number(e.target.value))} min={1000} max={2_000_000} step={1000} className="bg-base border border-border-strong rounded-sm px-2 py-1 text-text-primary focus:border-accent focus:outline-none" />
      </div>
      <div className="flex gap-2 justify-end mt-2">
        <button type="button" onClick={onCancel} className="px-3 py-1.5 border border-border-default rounded-sm text-text-muted hover:text-text-primary">cancel</button>
        <button type="submit" className="px-3 py-1.5 bg-accent text-raised rounded-sm font-medium">save</button>
      </div>
    </form>
  );
}
