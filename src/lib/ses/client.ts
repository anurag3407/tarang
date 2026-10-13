import "server-only";
import { SESv2Client } from "@aws-sdk/client-sesv2";
import { env, sesConfigured } from "@/lib/env";

let instance: SESv2Client | null = null;

/** Amazon SES v2 client singleton. Returns null when unconfigured. */
export function getSes(): SESv2Client | null {
  if (!sesConfigured()) return null;
  if (instance) return instance;
  const e = env();
  instance = new SESv2Client({
    region: e.AWS_SES_REGION!,
    // Explicit keys win; otherwise fall back to the SDK default chain.
    ...(e.AWS_SES_ACCESS_KEY_ID && e.AWS_SES_SECRET_ACCESS_KEY
      ? {
          credentials: {
            accessKeyId: e.AWS_SES_ACCESS_KEY_ID,
            secretAccessKey: e.AWS_SES_SECRET_ACCESS_KEY,
          },
        }
      : {}),
  });
  return instance;
}
