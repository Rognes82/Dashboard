import { xxh64 } from "@node-rs/xxhash";

export function hashContent(content: string): string {
  return xxh64(content).toString(16);
}
