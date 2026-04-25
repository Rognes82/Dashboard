"use client";

import { useEffect, useState } from "react";
import { Modal, ModalFooter } from "./Modal";
import { useToast } from "./chat/ToastProvider";

interface Preview {
  direct_child_count: number;
  direct_note_count: number;
}

interface MergeBinModalProps {
  open: boolean;
  sourceId: string | null;
  sourceName: string;
  targetId: string | null;
  targetName: string;
  onClose(): void;
  onMerged(targetId: string): void;
}

export function MergeBinModal({
  open, sourceId, sourceName, targetId, targetName, onClose, onMerged,
}: MergeBinModalProps) {
  const { show } = useToast();
  const [preview, setPreview] = useState<Preview | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !sourceId) return;
    setPreview(null);
    fetch(`/api/bins/${sourceId}/preview-merge`)
      .then((r) => {
        if (!r.ok) throw new Error(`preview failed (${r.status})`);
        return r.json();
      })
      .then((d) => setPreview(d))
      .catch(() => {
        // Don't fall back to a fake-empty preview — surface the error.
        show("Couldn't load merge preview", "error");
      });
  }, [open, sourceId, show]);

  async function handleMerge() {
    if (!sourceId || !targetId || submitting) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/bins/${sourceId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ merge_into: targetId }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? `Merge failed (${res.status})`);
      }
      show(`Merged '${sourceName}' into '${targetName}'`, "info");
      onMerged(targetId);
      onClose();
    } catch (e) {
      show(e instanceof Error ? e.message : "Merge failed", "error");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title={`Merge "${sourceName}" into "${targetName}"?`} size="md">
      {!preview ? (
        <div className="text-xs text-text-tertiary">Loading preview…</div>
      ) : (
        <div className="text-sm text-text-secondary space-y-2">
          <div>This will:</div>
          <ul className="list-disc list-inside space-y-1">
            <li>
              Move {preview.direct_note_count} note{preview.direct_note_count === 1 ? "" : "s"} from "{sourceName}" to "{targetName}"
            </li>
            <li>Delete the empty "{sourceName}" bin</li>
          </ul>
          {preview.direct_child_count > 0 && (
            <div className="pt-2 text-xs text-yellow-400">
              ⚠ Sub-bins of "{sourceName}" ({preview.direct_child_count}) will be re-parented to "{targetName}".
            </div>
          )}
          <div className="pt-2 text-xs text-text-tertiary">This cannot be undone.</div>
        </div>
      )}
      <ModalFooter>
        <button onClick={onClose} className="px-3 py-1.5 font-mono uppercase tracking-wide text-xs text-text-secondary hover:text-text-primary">
          Cancel
        </button>
        <button
          disabled={submitting || !preview}
          onClick={handleMerge}
          className="px-3 py-1.5 font-mono uppercase tracking-wide text-xs bg-accent text-base rounded disabled:opacity-50"
        >
          {submitting ? "Merging…" : "Merge"}
        </button>
      </ModalFooter>
    </Modal>
  );
}
