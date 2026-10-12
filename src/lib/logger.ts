import "server-only";
import pino from "pino";
import { env } from "./env";

/**
 * Structured logger (plan §5.1). One shared pino instance per process.
 *
 * PII redaction: we never log raw emails, phones, IPs, QR tokens, webhook
 * bodies, or access tokens. Callers pass already-minimized payloads; the
 * redact paths below are a second line of defense for accidental slips.
 */

let instance: pino.Logger | null = null;

export function logger(): pino.Logger {
  if (instance) return instance;
  instance = pino({
    level: env().LOG_LEVEL,
    base: {
      app: "pulse",
      appEnv: env().APP_ENV,
      deploymentId: env().DEPLOYMENT_ID ?? "dev",
    },
    serializers: {
      err: (err: unknown) => {
        if (err instanceof Error) {
          return {
            type: err.name,
            message: (err.message || "").slice(0, 1000),
            stack: (err.stack || "").slice(0, 2000),
          };
        }
        return typeof err === "string" ? err.slice(0, 1000) : err;
      },
    },
    formatters: {
      log(object) {
        if (object.err && typeof object.err === "string" && object.err.length > 1000) {
          object.err = object.err.slice(0, 1000) + "... [TRUNCATED]";
        }
        return object;
      },
    },
    redact: {
      paths: [
        "*.email",
        "*.phone",
        "*.phone_e164",
        "*.ip",
        "*.rawToken",
        "*.token",
        "*.accessToken",
        "*.access_token",
        "*.refresh_token",
        "*.authorization",
        "*.webhookBody",
        "*.privateKey",
        "*.serviceRoleKey",
      ],
      censor: "[REDACTED]",
    },
  });
  return instance;
}

/** Child logger bound to a request id for correlation. */
export function requestLogger(requestId: string) {
  return logger().child({ requestId });
}
