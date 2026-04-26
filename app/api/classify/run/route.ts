import { NextResponse } from "next/server";
import { runClassifierBatch } from "../../../../scripts/agent-classify";
import { resolveClassifyProfileId } from "../../../../lib/classify/profile";
import { getProfile } from "../../../../lib/llm/profiles";
import { buildClassifierLlm } from "../../../../lib/classify/llm-adapter";
import { ConcurrentRunError } from "../../../../lib/queries/classifications";
import { getSetting } from "../../../../lib/queries/app-settings";

const DEFAULT_RPM = 45;
const DEFAULT_CONCURRENCY = 3;
const DEFAULT_CAP = 100;

export async function POST(_req: Request): Promise<Response> {
  const profileId = resolveClassifyProfileId();
  if (!profileId) {
    return NextResponse.json(
      { error: "No classifier profile configured. Set one in Settings." },
      { status: 503 },
    );
  }
  const profile = getProfile(profileId);
  if (!profile) {
    return NextResponse.json({ error: `Classifier profile ${profileId} not found.` }, { status: 503 });
  }
  const llm = buildClassifierLlm(profile);
  const rpm = parseInt(getSetting("classify.rate_limit_rpm") ?? String(DEFAULT_RPM), 10);

  try {
    const summary = await runClassifierBatch({
      trigger: "manual",
      llm,
      profileId,
      concurrency: DEFAULT_CONCURRENCY,
      rateLimitRpm: rpm,
      cap: DEFAULT_CAP,
    });
    return NextResponse.json(summary);
  } catch (e) {
    if (e instanceof ConcurrentRunError) {
      return NextResponse.json({ error: "classifier run already in flight" }, { status: 409 });
    }
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
