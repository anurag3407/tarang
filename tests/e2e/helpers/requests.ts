import { NextRequest } from "next/server";

/**
 * Request builders + response helpers for driving real Route Handlers.
 * All URLs use the configured APP_BASE_URL so CSRF origin checks pass.
 */

export const BASE_URL = "https://tarang.example.com";

export type ExtraHeaders = Record<string, string>;

function headersFrom(extra?: ExtraHeaders): Headers {
  return new Headers(extra ?? {});
}

interface PostOpts {
  body?: unknown;
  /** Set to null to omit the Origin header (server-to-server style). */
  origin?: string | null;
  headers?: ExtraHeaders;
}

/** POST with JSON body + same-origin header defaults. */
export function post(path: string, opts: PostOpts = {}): NextRequest {
  const headers = headersFrom(opts.headers);
  headers.set("content-type", "application/json");
  if (opts.origin !== null) {
    headers.set("origin", opts.origin ?? BASE_URL);
  }
  const text = JSON.stringify(opts.body ?? {});
  headers.set("content-length", String(Buffer.byteLength(text)));
  const init = {
    method: "POST",
    headers,
    body: text,
    duplex: "half" as const,
  };
  return new NextRequest(BASE_URL + path, init);
}

/** POST with a raw body (webhooks sign the exact bytes). */
export function rawPost(path: string, rawBody: string, headers?: ExtraHeaders): NextRequest {
  const h = headersFrom(headers);
  h.set("content-type", "application/json");
  h.set("content-length", String(Buffer.byteLength(rawBody)));
  const init = {
    method: "POST",
    headers: h,
    body: rawBody,
    duplex: "half" as const,
  };
  return new NextRequest(BASE_URL + path, init);
}

export function get(path: string, headers?: ExtraHeaders): NextRequest {
  return new NextRequest(BASE_URL + path, {
    method: "GET",
    headers: headersFrom(headers),
  });
}

export function del(path: string, opts: PostOpts = {}): NextRequest {
  const headers = headersFrom(opts.headers);
  headers.set("content-type", "application/json");
  if (opts.origin !== null) {
    headers.set("origin", opts.origin ?? BASE_URL);
  }
  const text = JSON.stringify(opts.body ?? {});
  headers.set("content-length", String(Buffer.byteLength(text)));
  const init = {
    method: "DELETE",
    headers,
    body: text,
    duplex: "half" as const,
  };
  return new NextRequest(BASE_URL + path, init);
}

/** Dynamic-route context matching Next's generated RouteContext shape. */
export function ctx<P extends Record<string, string>>(params: P): {
  params: Promise<P>;
} {
  return { params: Promise.resolve(params) };
}

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OkEnvelope<T = any> {
  ok: true;
  requestId: string;
  data: T;
}

export interface ErrEnvelope {
  ok: false;
  code: string;
  message: string;
  requestId: string;
  details?: unknown;
}

export async function json(res: Response): Promise<OkEnvelope | ErrEnvelope> {
  return (await res.json()) as OkEnvelope | ErrEnvelope;
}

export function expectOkEnvelope(body: OkEnvelope | ErrEnvelope): asserts body is OkEnvelope {
  if (body.ok !== true) {
    throw new Error(`expected success envelope, got: ${JSON.stringify(body)}`);
  }
  if (typeof body.requestId !== "string" || body.requestId.length === 0) {
    throw new Error("success envelope must carry a requestId");
  }
}

export function expectErrEnvelope(
  body: OkEnvelope | ErrEnvelope,
  code: string
): asserts body is ErrEnvelope {
  if (body.ok !== false || body.code !== code) {
    throw new Error(`expected error ${code}, got: ${JSON.stringify(body)}`);
  }
}
