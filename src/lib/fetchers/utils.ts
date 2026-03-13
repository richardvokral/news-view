import { createHash } from "crypto";

export function hashId(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}
