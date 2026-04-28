import { NextResponse } from "next/server";
import { getSetting, setSetting, getSettingJson, setSettingJson } from "../../../../lib/queries/app-settings";

export async function GET(): Promise<Response> {
  return NextResponse.json({
    profile_id: getSetting("classify.profile_id"),
    cron_interval_min: parseInt(getSetting("classify.cron_interval_min") ?? "10", 10),
    rate_limit_rpm: parseInt(getSetting("classify.rate_limit_rpm") ?? "45", 10),
    thresholds: getSettingJson("classify.thresholds") ?? {
      existing_min: 0.6,
      new_bin_floor: 0.75,
      new_bin_margin: 0.3,
    },
  });
}

interface PutBody {
  profile_id?: string | null;
  cron_interval_min?: number;
  rate_limit_rpm?: number;
  thresholds?: { existing_min: number; new_bin_floor: number; new_bin_margin: number };
}

export async function PUT(req: Request): Promise<Response> {
  const body = (await req.json()) as PutBody;
  if (body.profile_id !== undefined) {
    if (body.profile_id === null) {
      setSetting("classify.profile_id", "");
    } else {
      setSetting("classify.profile_id", body.profile_id);
    }
  }
  if (typeof body.cron_interval_min === "number") {
    setSetting("classify.cron_interval_min", String(body.cron_interval_min));
  }
  if (typeof body.rate_limit_rpm === "number") {
    setSetting("classify.rate_limit_rpm", String(body.rate_limit_rpm));
  }
  if (body.thresholds) {
    setSettingJson("classify.thresholds", body.thresholds);
  }
  return NextResponse.json({ ok: true });
}
