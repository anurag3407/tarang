import type { Instrumentation } from "next";
import * as Sentry from "@sentry/nextjs";

/**
 * Server instrumentation (plan §15.10).
 *
 * `register()` runs once per server instance before it accepts requests:
 * validate the environment contract early (fail fast on invalid values) and
 * record a startup line. `onRequestError` captures server render/request
 * errors into the structured log stream.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
    const { env } = await import("@/lib/env");
    const { logger } = await import("@/lib/logger");
    try {
      const e = env();
      logger().info(
        {
          appEnv: e.APP_ENV,
          deploymentId: e.DEPLOYMENT_ID ?? null,
          node: process.version,
        },
        "server starting"
      );
    } catch (err) {
      // Invalid environment is a fatal startup condition — surface it.
      console.error(err);
      throw err;
    }
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export const onRequestError: Instrumentation.onRequestError = async (
  err,
  request,
  context
) => {
  try {
    await Sentry.captureRequestError(err, request, context);
  } catch {
    // Never let Sentry break the error path
  }

  try {
    const { logger } = await import("@/lib/logger");
    const digest =
      typeof err === "object" && err !== null && "digest" in err
        ? String((err as { digest: unknown }).digest)
        : undefined;
    logger().error(
      {
        err,
        digest,
        path: request.path,
        method: request.method,
        route: context.routePath,
        routeKind: context.routerKind,
      },
      "request error"
    );
  } catch {
    // Never let observability break the error path.
  }
};

