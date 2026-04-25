"use client";

import { useState, useEffect } from "react";
import { Modal, ModalFooter } from "./Modal";
import { useToast } from "./chat/ToastProvider";

interface CreateBinModalProps {
  open: boolean;
  parentBinId: string | null;
  parentBinName?: string | null; // optional, for header context
  onClose(): void;
  onCreated(newBinId: string): void;
}

export function CreateBinModal({ open, parentBinId, parentBinName, onClose, onCreated }: CreateBinModalProps) {
  const { show } = useToast();
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const trimmed = name.trim();
  const tooLong = trimmed.length > 120;
  const valid = trimmed.length > 0 && !tooLong;
  const title = parentBinName ? `New child bin in "${parentBinName}"` : "New bin";

  async function handleSubmit() {
    if (!valid || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/bins", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: trimmed, parent_bin_id: parentBinId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Create failed (${res.status})`);
      }
      const data = await res.json();
      show(`Created '${trimmed}'`, "info");
      onCreated(data.bin.id);
      onClose();
    } catch (e) {
      show(e instanceof Error ? e.message : "Create failed", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && valid) handleSubmit(); }}
        placeholder="Bin name"
        className="w-full px-3 py-2 bg-base border border-border-default rounded text-text-primary outline-none focus:border-accent"
      />
      {tooLong && (
        <div className="mt-2 text-xs text-red-400">Too long — max 120 characters</div>
      )}
      <ModalFooter>
        <button
          onClick={onClose}
          className="px-3 py-1.5 font-mono uppercase tracking-wide text-xs text-text-secondary hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          disabled={!valid || submitting}
          onClick={handleSubmit}
          className="px-3 py-1.5 font-mono uppercase tracking-wide text-xs bg-accent text-base rounded disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? "Creating…" : "Create"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
