"use client";
import { PendingProposalRow } from "./PendingProposalRow";

export interface ProposalForCard {
  id: string;
  note_title: string;
  note_id: string;
  existing_bin_path: string | null;
  existing_confidence: number;
  new_bin_path: string | null;
  new_bin_rating: number | null;
  reasoning: string;
}

interface Props {
  proposals: ProposalForCard[];
  onChanged: () => void;
}

export function PendingProposalsCard({ proposals, onChanged }: Props) {
  if (proposals.length === 0) return null;
  return (
    <section className="border border-white/10 rounded p-4 mb-4">
      <h2 className="font-mono text-sm text-white/70 mb-3">
        Pending classifier proposals ({proposals.length})
      </h2>
      {proposals.map((p) => (
        <PendingProposalRow
          key={p.id}
          id={p.id}
          noteTitle={p.note_title}
          noteId={p.note_id}
          existingBinPath={p.existing_bin_path}
          existingConfidence={p.existing_confidence}
          newBinPath={p.new_bin_path}
          newBinRating={p.new_bin_rating}
          reasoning={p.reasoning}
          onChanged={onChanged}
        />
      ))}
    </section>
  );
}
