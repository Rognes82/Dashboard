import { NextResponse } from "next/server";
import type { ClientStatus } from "./types";

export const CLIENT_STATUSES: ClientStatus[] = ["active", "paused", "completed"];

export function parseLimit(raw: string | null, fallback: number, max = 5000): number {
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}

export async function readJson(req: Request): Promise<unknown | null> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

export function isNonEmptyString(v: unknown, maxLen = 500): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= maxLen;
}

export function isOptionalString(v: unknown, maxLen = 5000): v is string | undefined {
  if (v === undefined || v === null) return true;
  return typeof v === "string" && v.length <= maxLen;
}

export function isClientStatus(v: unknown): v is ClientStatus {
  return typeof v === "string" && (CLIENT_STATUSES as string[]).includes(v);
}

export function badRequest(message: string) {
  return NextResponse.json({ error: message }, { status: 400 });
}
