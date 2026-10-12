import "server-only";
import type { NextRequest } from "next/server";
import { Receiver } from "@upstash/qstash";
import { AppError } from "./api";
import { env } from "./env";
import { idempotencyKeySchema } from "./validation/schemas";

/**
 * Shared Route Handler utilities (plan §11.11, §12.3, §12.9).
 */

/** Parse a bounded JSON body. Throws VALIDATION_FAILED on malformed input. */
export async function readJsonBody<T = unknown>(
  req: NextRequest,
  maxBytes = 64 * 1024
): Promise<T> {
  const length = req.headers.get("content-length");
  if (length && Number(length) > maxBytes) {
    throw new AppError("VALIDATION_FAILED", "Request body too large");
  }
  let text: string;
  try {
    text = await req.text();
  } catch {
    throw new AppError("BAD_REQUEST", "Unable to read request body");
  }
  if (text.length > maxBytes) {
    throw new AppError("VALIDATION_FAILED", "Request body too large");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new AppError("BAD_REQUEST", "Request body must be valid JSON");
  }
}

/** Read the raw body as text (webhooks need the exact bytes for HMAC). */
export async function readRawBody(req: NextRequest, maxBytes = 1024 * 1024): Promise<string> {
  const length = req.headers.get("content-length");
  if (length && Number(length) > maxBytes) {
    throw new AppError("VALIDATION_FAILED", "Request body too large");
  }
  return req.text();
}

/** Extract and validate the Idempotency-Key header (plan §7.9). */
export function requireIdempotencyKey(req: NextRequest): string {
  const raw = req.headers.get("idempotency-key");
  if (!raw) {
    throw new AppError("BAD_REQUEST", "Idempotency-Key header is required");
  }
  const parsed = idempotencyKeySchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError("BAD_REQUEST", "Idempotency-Key must be a UUID");
  }
  return parsed.data;
}

/**
 * Verify a QStash delivery signature (plan §12.9, §13.4). Job wake endpoints
 * are only callable by QStash; without configured keys they fail closed.
 */
export async function verifyQstashSignature(req: NextRequest, body: string): Promise<void> {
  const e = env();
  if (!e.QSTASH_CURRENT_SIGNING_KEY) {
    throw new AppError("UNAUTHORIZED", "Job endpoint is not configured");
  }
  const signature = req.headers.get("upstash-signature");
  if (!signature) {
    throw new AppError("UNAUTHORIZED", "Missing QStash signature");
  }
  const receiver = new Receiver({
    currentSigningKey: e.QSTASH_CURRENT_SIGNING_KEY,
    nextSigningKey: e.QSTASH_NEXT_SIGNING_KEY ?? undefined,
  });
  try {
    await receiver.verify({
      signature,
      body,
      url: req.url,
    });
  } catch {
    throw new AppError("UNAUTHORIZED", "Invalid QStash signature");
  }
}
