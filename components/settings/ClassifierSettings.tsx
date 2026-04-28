"use client";
import { useEffect, useState } from "react";

interface Profile {
  id: string;
  name: string;
  type: string;
  default_model: string;
}

interface SettingsState {
  profile_id: string | null;
  cron_interval_min: number;
  rate_limit_rpm: number;
  thresholds: { existing_min: number; new_bin_floor: number; new_bin_margin: number };
}

const DEFAULTS = {
  cron_interval_min: 10,
  rate_limit_rpm: 45,
  thresholds: { existing_min: 0.6, new_bin_floor: 0.75, new_bin_margin: 0.3 },
};

export function ClassifierSettings() {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [state, setState] = useState<SettingsState | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const [p, s] = await Promise.all([
        fetch("/api/settings/profiles").then((r) => r.json()),
        fetch("/api/settings/classify").then((r) => r.json()),
      ]);
      setProfiles(p.profiles ?? []);
      setState(s);
    })();
  }, []);

  if (!state) return <div className="text-white/50 text-sm">Loading…</div>;

  async function save(patch: Partial<SettingsState>): Promise<void> {
    setSaving(true);
    try {
      await fetch("/api/settings/classify", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      setState((s) => (s ? { ...s, ...patch } : s));
    } finally {
      setSaving(false);
    }
  }

  function resetThresholds(): void {
    void save({ thresholds: DEFAULTS.thresholds });
  }

  return (
    <section className="border border-white/10 rounded p-4 mb-4">
      <h2 className="font-mono text-sm text-white/70 mb-3">Classifier</h2>
      <div className="space-y-3 text-sm">
        <label className="flex items-center gap-3">
          <span className="w-32 font-mono text-xs text-white/50">Profile</span>
          <select
            value={state.profile_id ?? ""}
            onChange={(e) => save({ profile_id: e.target.value || null })}
            className="bg-black/40 border border-white/20 rounded px-2 py-1 font-mono text-xs"
          >
            <option value="">(falls back to active chat profile)</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>{p.name} — {p.default_model}</option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-3">
          <span className="w-32 font-mono text-xs text-white/50">Cron interval</span>
          <input
            type="number" min={1} max={60}
            value={state.cron_interval_min}
            onChange={(e) => save({ cron_interval_min: parseInt(e.target.value, 10) || 10 })}
            className="w-20 bg-black/40 border border-white/20 rounded px-2 py-1 font-mono text-xs"
          />
          <span className="text-white/50 text-xs">minutes</span>
        </label>
        <label className="flex items-center gap-3">
          <span className="w-32 font-mono text-xs text-white/50">Rate limit</span>
          <input
            type="number" min={1} max={1000}
            value={state.rate_limit_rpm}
            onChange={(e) => save({ rate_limit_rpm: parseInt(e.target.value, 10) || 45 })}
            className="w-20 bg-black/40 border border-white/20 rounded px-2 py-1 font-mono text-xs"
          />
          <span className="text-white/50 text-xs">requests / minute</span>
        </label>
        <div className="border-t border-white/10 pt-3">
          <div className="font-mono text-xs text-white/50 mb-2">Thresholds</div>
          {(["existing_min", "new_bin_floor", "new_bin_margin"] as const).map((k) => (
            <label key={k} className="flex items-center gap-3 mb-2">
              <span className="w-48 font-mono text-xs text-white/40">{k}</span>
              <input
                type="number" step={0.01} min={0} max={1}
                value={state.thresholds[k]}
                onChange={(e) => {
                  const value = parseFloat(e.target.value);
                  if (Number.isFinite(value)) {
                    save({ thresholds: { ...state.thresholds, [k]: value } });
                  }
                }}
                className="w-20 bg-black/40 border border-white/20 rounded px-2 py-1 font-mono text-xs"
              />
            </label>
          ))}
          <button
            onClick={resetThresholds}
            className="px-2 py-1 text-xs border border-white/20 text-white/60 rounded hover:bg-white/5"
          >
            Reset to defaults
          </button>
        </div>
        {saving && <div className="text-white/40 text-xs">Saving…</div>}
      </div>
    </section>
  );
}
