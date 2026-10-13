import "server-only";
import { SendEmailCommand } from "@aws-sdk/client-sesv2";
import MailComposer from "nodemailer/lib/mail-composer";
import { env, emailProvider, type EmailProvider } from "@/lib/env";
import { getResend } from "@/lib/resend/client";
import { getSes } from "@/lib/ses/client";

/**
 * Provider-neutral email sending.
 *
 * USE_SES=true routes every send through Amazon SES; unset or false keeps
 * Resend. Callers get one result shape either way, with an HTTP-like status
 * code so retry classification stays the same for both providers.
 */

export type OutgoingEmail = {
  from: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  replyTo?: string;
  /** Inline (CID) images referenced from the HTML as `cid:<contentId>`. */
  attachments?: {
    content: Buffer;
    filename: string;
    contentType: string;
    contentId: string;
  }[];
};

export type SendEmailResult =
  | { ok: true; id: string | null }
  | { ok: false; message: string; statusCode?: number };

export type EmailSender = {
  provider: EmailProvider;
  send(msg: OutgoingEmail, opts: { idempotencyKey: string }): Promise<SendEmailResult>;
};

/**
 * SES account-level states are environmental, not a property of the email,
 * so they retry instead of dead-lettering despite their 4xx status.
 */
const SES_RETRYABLE = new Set([
  "TooManyRequestsException",
  "LimitExceededException",
  "SendingPausedException",
  "AccountSuspendedException",
]);

/** Sender for the active provider, or null when it is not configured. */
export function getEmailSender(): EmailSender | null {
  const provider = emailProvider();
  if (provider === "ses") {
    const ses = getSes();
    if (!ses) return null;
    return {
      provider,
      async send(msg) {
        // SES has no idempotency key; the email_jobs lease is the guard
        // against double sends.
        const raw = await new MailComposer({
          from: msg.from,
          to: msg.to,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          ...(msg.replyTo ? { replyTo: msg.replyTo } : {}),
          attachments: msg.attachments?.map((a) => ({
            content: a.content,
            filename: a.filename,
            contentType: a.contentType,
            cid: a.contentId,
          })),
        })
          .compile()
          .build();

        const configurationSet = env().AWS_SES_CONFIGURATION_SET;
        try {
          const out = await ses.send(
            new SendEmailCommand({
              Content: { Raw: { Data: raw } },
              ...(configurationSet ? { ConfigurationSetName: configurationSet } : {}),
            })
          );
          return { ok: true, id: out.MessageId ?? null };
        } catch (err) {
          const e = err as {
            name?: string;
            message?: string;
            $metadata?: { httpStatusCode?: number };
          };
          const status = e.$metadata?.httpStatusCode;
          if (status === undefined) throw err; // network failure: caller retries
          return {
            ok: false,
            message: `${e.name ?? "SESError"}: ${e.message ?? "send failed"}`,
            statusCode: e.name && SES_RETRYABLE.has(e.name) ? 429 : status,
          };
        }
      },
    };
  }

  const resend = getResend();
  if (!resend) return null;
  return {
    provider,
    async send(msg, { idempotencyKey }) {
      const result = await resend.emails.send(
        {
          from: msg.from,
          to: msg.to,
          subject: msg.subject,
          html: msg.html,
          text: msg.text,
          ...(msg.replyTo ? { reply_to: msg.replyTo } : {}),
          ...(msg.attachments && msg.attachments.length > 0
            ? { attachments: msg.attachments }
            : {}),
        },
        { idempotencyKey }
      );
      if (result.error) {
        return {
          ok: false,
          message: result.error.message ?? "send failed",
          statusCode: (result.error as { statusCode?: number }).statusCode,
        };
      }
      return { ok: true, id: result.data?.id ?? null };
    },
  };
}
