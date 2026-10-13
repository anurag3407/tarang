import "server-only";
import { env } from "@/lib/env";

/**
 * Redis key namespaces (plan §10.1). All keys include environment and
 * festival ids. No email, phone, raw IP, raw QR, webhook body, or access
 * token ever appears in a key — identifiers are hashed when needed.
 */

function prefix(): string {
  return `tarang:${env().APP_ENV}`;
}

export const redisKeys = {
  contentEvents: (festivalId: string, version: string | number) =>
    `${prefix()}:content:events:${festivalId}:${version}`,
  contentSchedule: (festivalId: string, version: string | number) =>
    `${prefix()}:content:schedule:${festivalId}:${version}`,
  contentNotices: (festivalId: string, version: string | number) =>
    `${prefix()}:content:notices:${festivalId}:${version}`,
  availability: (festivalId: string, eventId: string) =>
    `${prefix()}:availability:${festivalId}:${eventId}`,
  feature: (festivalId: string, key: string) =>
    `${prefix()}:feature:${festivalId}:${key}`,
  authz: (festivalId: string, userId: string, authzVersion: number) =>
    `${prefix()}:authz:${festivalId}:${userId}:${authzVersion}`,
  ratelimit: (cls: string, identifier: string) =>
    `${prefix()}:ratelimit:${cls}:${identifier}`,
  lock: (purpose: string, id: string) => `${prefix()}:lock:${purpose}:${id}`,
  nextCache: (key: string) => `${prefix()}:next-cache:${key}`,
  siteClicks: () => `${prefix()}:stats:site_clicks`,
  uniqueVisitors: () => `${prefix()}:stats:unique_visitors`,
} as const;
