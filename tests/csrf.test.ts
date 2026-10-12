import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { isAllowedOrigin, validateMutationRequest } from "@/lib/csrf";

function req(opts: {
  origin?: string;
  contentType?: string;
  contentLength?: string;
}): NextRequest {
  const headers = new Headers();
  if (opts.origin !== undefined) headers.set("origin", opts.origin);
  if (opts.contentType !== undefined) headers.set("content-type", opts.contentType);
  if (opts.contentLength !== undefined) headers.set("content-length", opts.contentLength);
  return new NextRequest("https://pulse.example.com/api/checkout/base-pass", {
    method: "POST",
    headers,
  });
}

describe("CSRF / origin validation (plan §11.4)", () => {
  it("accepts the configured app origin", () => {
    expect(isAllowedOrigin(req({ origin: "https://pulse.example.com" }))).toBe(true);
  });

  it("accepts the origin with a trailing slash", () => {
    expect(isAllowedOrigin(req({ origin: "https://pulse.example.com/" }))).toBe(true);
  });

  it("rejects a foreign origin", () => {
    expect(isAllowedOrigin(req({ origin: "https://evil.example" }))).toBe(false);
  });

  it("rejects subdomain/lookalike origins", () => {
    expect(isAllowedOrigin(req({ origin: "https://pulse.example.com.evil.example" }))).toBe(false);
    expect(isAllowedOrigin(req({ origin: "https://evilpulse.example.com" }))).toBe(false);
  });

  it("allows requests without an Origin header (non-browser clients)", () => {
    expect(isAllowedOrigin(req({}))).toBe(true);
  });
});

describe("mutation request validation", () => {
  it("accepts a same-origin JSON request", () => {
    const r = req({
      origin: "https://pulse.example.com",
      contentType: "application/json",
    });
    expect(validateMutationRequest(r)).toBeNull();
  });

  it("rejects a foreign origin before anything else", () => {
    const r = req({ origin: "https://evil.example", contentType: "application/json" });
    expect(validateMutationRequest(r)).toBe("ORIGIN_NOT_ALLOWED");
  });

  it("rejects non-JSON content types", () => {
    const r = req({
      origin: "https://pulse.example.com",
      contentType: "text/plain",
    });
    expect(validateMutationRequest(r)).toBe("UNSUPPORTED_CONTENT_TYPE");
  });

  it("rejects oversized bodies by content-length", () => {
    const r = req({
      origin: "https://pulse.example.com",
      contentType: "application/json",
      contentLength: String(1024 * 1024),
    });
    expect(validateMutationRequest(r)).toBe("BODY_TOO_LARGE");
  });
});
