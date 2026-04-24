"use client";

export interface ProfileDisplay {
  id: string;
  name: string;
  type: "anthropic" | "openai-compatible";
  default_model: string;
  base_url?: string;
  max_context_tokens: number;
  has_key: true;
}

interface Props {
  profile: ProfileDisplay;
  active: boolean;
  onSetActive: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

export function ProfileCard({ profile, active, onSetActive, onEdit, onDelete }: Props) {
  if (active) {
    return (
      <div className="p-3 bg-accent-tint border border-accent rounded-md">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" style={{ boxShadow: "0 0 6px #7dd3fc" }} />
          <span className="text-xs text-text-primary font-medium">{profile.name}</span>
          <span className="ml-auto mono text-2xs text-accent uppercase tracking-wider">active</span>
        </div>
        <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 mono text-2xs">
          <span className="text-text-subtle">type</span><span className="text-text-primary">{profile.type}</span>
          <span className="text-text-subtle">model</span><span className="text-text-primary">{profile.default_model}</span>
          {profile.base_url && (<><span className="text-text-subtle">base</span><span className="text-text-primary truncate">{profile.base_url}</span></>)}
          <span className="text-text-subtle">context</span><span className="text-text-primary">{profile.max_context_tokens.toLocaleString()}</span>
          <span className="text-text-subtle">key</span><span className="text-text-primary">stored</span>
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={onEdit} className="mono text-2xs px-2 py-1 border border-border-default rounded-sm text-text-primary hover:bg-hover">edit</button>
          <button onClick={onDelete} className="mono text-2xs px-2 py-1 border border-border-default rounded-sm text-text-muted hover:text-red-400">delete</button>
        </div>
      </div>
    );
  }
  return (
    <div className="p-3 bg-sunken border border-border-default rounded-md">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-border-strong" />
        <span className="text-xs text-text-secondary">{profile.name}</span>
        <button onClick={onSetActive} className="ml-auto mono text-2xs text-text-muted hover:text-accent">set active</button>
      </div>
      <div className="mono text-2xs text-text-muted">
        {profile.type} · {profile.default_model}
      </div>
      <div className="flex gap-2 mt-2">
        <button onClick={onEdit} className="mono text-2xs px-2 py-1 border border-border-default rounded-sm text-text-secondary hover:bg-hover">edit</button>
        <button onClick={onDelete} className="mono text-2xs px-2 py-1 border border-border-default rounded-sm text-text-muted hover:text-red-400">delete</button>
      </div>
    </div>
  );
}
