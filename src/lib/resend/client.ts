import "server-only";
import { Resend } from "resend";
import { env, resendConfigured } from "@/lib/env";

let instance: Resend | null = null;

/** Resend SDK singleton (plan §13). Returns null when unconfigured. */
export function getResend(): Resend | null {
  if (!resendConfigured()) return null;
  if (instance) return instance;
  instance = new Resend(env().RESEND_API_KEY!);
  return instance;
}
