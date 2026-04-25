"use client";

import { useEffect, useState, useRef } from "react";
import { Modal, ModalFooter } from "./Modal";
import { useToast } from "./chat/ToastProvider";

interface Preview {
  child_bin_count: number;
  child_bin_names: string[];
  has_more_children: boolean;
  note_count: number;
}

interface DeleteBinModalProps {
  open: boolean;
  binId: string | null;
  binName: string;
  onClose(): void;
  onDeleted(): void;
}

export function DeleteBinModal({ open, binId, binName, onClose, onDeleted }: DeleteBinModalProps) {
  const { show } = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open || !binId) return;
    setPreview(null);
    fetch(`/api/bins/${binId}/preview-delete`)
      .then((r) => r.json())
      .then((d) => setPreview(d))
      .catch(() => setPreview({ child_bin_count: 0, child_bin_names: [], has_more_children: false, note_count: 0 }));
  }, [open, binId]);

  useEffect(() => {
    if (open) cancelRef.current?.focus();
  }, [open, preview]);

  async function handleDelete() {
    if (!binId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/bins/${binId}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Delete failed (${res.status})`);
      }
      const childWord = preview && preview.child_bin_count > 0
        ? ` and ${preview.child_bin_count} sub-bin${preview.child_bin_count === 1 ? "" : "s"}`
        : "";
      show(`Deleted '${binName}'${childWord}`, "info");
      onDeleted();
      onClose();
    } catch (e) {
      show(e instanceof Error ? e.message : "Delete failed", "error");
    } finally {
      setSubmitting(false);
    }
  }

  const isEmpty = preview && preview.child_bin_count === 0 && preview.note_count === 0;
  const namesLine = preview && preview.child_bin_names.length > 0
    ? ` (${preview.child_bin_names.join(", ")}${preview.has_more_children ? ", …and more" : ""})`
    : "";

  return (
    <Modal open={open} onClose={onClose} title={`Delete bin "${binName}"?`} size="md">
      {!preview ? (
        <div className="text-xs text-text-tertiary">Loading preview…</div>
      ) : isEmpty ? (
        <div className="text-sm text-text-secondary">This bin is empty. Delete it?</div>
      ) : (
        <div className="text-sm text-text-secondary space-y-2">
          <div>This will:</div>
          <ul className="list-disc list-inside space-y-1">
            {preview.child_bin_count > 0 && (
              <li>Delete {preview.child_bin_count} sub-bin{preview.child_bin_count === 1 ? "" : "s"}{namesLine}</li>
            )}
            {preview.note_count > 0 && (
              <li>Unassign {preview.note_count} note{preview.note_count === 1 ? "" : "s"} (notes themselves stay in vault)</li>
            )}
          </ul>
          <div className="pt-2 text-xs text-text-tertiary">This cannot be undone.</div>
        </div>
      )}
      <ModalFooter>
        <button
          ref={cancelRef}
          onClick={onClose}
          className="px-3 py-1.5 font-mono uppercase tracking-wide text-xs text-text-secondary hover:text-text-primary"
        >
          Cancel
        </button>
        <button
          disabled={submitting || !preview}
          onClick={handleDelete}
          className="px-3 py-1.5 font-mono uppercase tracking-wide text-xs bg-red-500/20 text-red-400 border border-red-500/30 rounded hover:bg-red-500/30 disabled:opacity-50"
        >
          {submitting ? "Deleting…" : "Delete"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
