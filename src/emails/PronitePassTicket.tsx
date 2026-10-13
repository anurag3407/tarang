import type { CSSProperties, ReactNode } from "react";
import { FEST } from "@/lib/data";
import { formatPaise } from "@/lib/money";

/**
 * The Pronite Pass confirmation, printed as the same ticket the site shows:
 * the artwork (red print panel, the poster's hands, TARANG in Noot) is a
 * pre-rendered image — see scripts/email-ticket/build.py — and the stub below
 * the perforation is live HTML carrying this buyer's gate QR and pass code.
 *
 * Table-based, inline styles only: email clients ignore most modern CSS.
 */

const INK = "#141310";
const BONE = "#f4eac8";
const BLOOD = "#6e0001";
const DISPLAY = "Noot, Impact, 'Arial Black', Arial, sans-serif";
const BODY = "Arial, Helvetica, sans-serif";
const MONO = "'Courier New', Courier, monospace";

export interface PronitePassTicketProps {
  displayName: string;
  publicPassCode?: string;
  publicOrderCode?: string;
  amountPaise?: number;
  currency?: string;
  providerReference?: string;
  /** `cid:` reference (preferred) or a hosted URL for each image. */
  qrSrc?: string;
  artSrc: string;
  perfSrc: string;
  fontUrl?: string;
  dashboardUrl: string;
  supportEmail: string;
}

function Cell({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <tr>
      <td style={style}>{children}</td>
    </tr>
  );
}

export function PronitePassTicket(p: PronitePassTicketProps) {
  return (
    <div style={{ backgroundColor: INK, padding: "28px 12px", fontFamily: BODY }}>
      {p.fontUrl && (
        <style>{`@font-face{font-family:Noot;src:url(${p.fontUrl}) format("truetype");font-display:swap}`}</style>
      )}
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{ maxWidth: 560, margin: "0 auto", borderCollapse: "collapse" }}
      >
        {/* Masthead */}
        <Cell style={{ padding: "0 4px 16px", color: BONE, fontFamily: BODY, fontSize: 12, letterSpacing: "3px", textTransform: "uppercase" }}>
          <span style={{ color: "#ff5a3c" }}>●</span>&nbsp; Payment confirmed · your pass is live
        </Cell>

        {/* Ticket artwork */}
        <Cell style={{ lineHeight: 0, fontSize: 0 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={p.artSrc}
            alt={`TARANG ’26 Pronite Pass — ${FEST.college}`}
            width={560}
            style={{ display: "block", width: "100%", maxWidth: 560, height: "auto", border: 0 }}
          />
        </Cell>

        {/* Perforation */}
        <Cell style={{ lineHeight: 0, fontSize: 0, backgroundColor: BONE }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={p.perfSrc} alt="" width={560} style={{ display: "block", width: "100%", maxWidth: 560, height: "auto", border: 0 }} />
        </Cell>

        {/* Stub — the part the gate scans */}
        <Cell style={{ backgroundColor: BONE, padding: "8px 28px 28px", borderRadius: "0 0 18px 18px", color: INK }}>
          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
            <tr>
              <td style={{ fontFamily: DISPLAY, fontSize: 16, letterSpacing: "1px" }}>#TARANG26</td>
              <td style={{ fontFamily: DISPLAY, fontSize: 16, textAlign: "right", letterSpacing: "1px" }}>ADMIT ONE</td>
            </tr>
          </table>

          {p.qrSrc ? (
            <div style={{ textAlign: "center", padding: "18px 0 6px" }}>
              <div style={{ display: "inline-block", backgroundColor: "#ffffff", padding: 12, border: `3px solid ${INK}`, borderRadius: 10 }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.qrSrc} alt="Gate QR code" width={240} height={240} style={{ display: "block", border: 0 }} />
              </div>
            </div>
          ) : (
            <p style={{ textAlign: "center", fontSize: 14, margin: "18px 0" }}>
              Your gate QR is ready in your dashboard.
            </p>
          )}

          {p.publicPassCode && (
            <p style={{ textAlign: "center", fontFamily: MONO, fontSize: 22, fontWeight: 700, letterSpacing: "4px", margin: "10px 0 2px" }}>
              {p.publicPassCode}
            </p>
          )}
          <p style={{ textAlign: "center", fontSize: 13, margin: "0 0 18px", color: "#4a463c" }}>
            Issued to <b style={{ color: INK }}>{p.displayName}</b>
          </p>

          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ borderTop: `2px dashed rgba(20,19,16,0.3)` }}>
            <tr>
              <td style={{ paddingTop: 14, fontFamily: DISPLAY, fontSize: 20 }}>
                <span style={{ color: BLOOD }}>DATE</span> {FEST.ticketDateShort}
              </td>
              <td style={{ paddingTop: 14, fontFamily: DISPLAY, fontSize: 20, textAlign: "right" }}>
                <span style={{ color: BLOOD }}>TIME</span> {FEST.proniteTime}
              </td>
            </tr>
          </table>
        </Cell>

        {/* Details */}
        <Cell style={{ padding: "28px 4px 0", color: BONE, fontSize: 15, lineHeight: "23px" }}>
          <p style={{ margin: "0 0 12px" }}>Hi {p.displayName},</p>
          <p style={{ margin: "0 0 12px" }}>
            Your <b>Pronite Pass</b> for TARANG ’26 is confirmed — every pronite, {FEST.dates}, at {FEST.college}. Show the QR
            above at the gate with a valid photo ID. It works straight from this email or from your dashboard.
          </p>
          <table role="presentation" width="100%" cellPadding={0} cellSpacing={0} style={{ margin: "16px 0", borderTop: "1px solid rgba(244,234,200,0.2)" }}>
            {[
              ["Pass", p.publicPassCode],
              ["Order", p.publicOrderCode],
              ["Amount", p.amountPaise !== undefined ? `${formatPaise(p.amountPaise)} ${p.currency ?? "INR"}` : undefined],
              ["Payment Ref", p.providerReference],
              ["Venue", FEST.venue],
            ]
              .filter((r): r is [string, string] => Boolean(r[1]))
              .map(([label, value]) => (
                <tr key={label}>
                  <td style={{ padding: "8px 0", borderBottom: "1px solid rgba(244,234,200,0.2)", fontSize: 12, letterSpacing: "2px", textTransform: "uppercase", color: "rgba(244,234,200,0.6)", width: 120 }}>
                    {label}
                  </td>
                  <td style={{ padding: "8px 0", borderBottom: "1px solid rgba(244,234,200,0.2)", fontSize: 14, color: BONE }}>{value}</td>
                </tr>
              ))}
          </table>
          <p style={{ margin: "22px 0", textAlign: "center" }}>
            <a
              href={p.dashboardUrl}
              style={{ display: "inline-block", backgroundColor: BONE, color: INK, padding: "13px 26px", borderRadius: 999, fontSize: 13, fontWeight: 700, letterSpacing: "2px", textTransform: "uppercase", textDecoration: "none", boxShadow: "4px 4px 0 #8f0c08" }}
            >
              Open my dashboard →
            </a>
          </p>
          <p style={{ margin: "0 0 10px", fontSize: 13, color: "#ff8a6a", fontWeight: 700 }}>
            Anyone holding this QR can walk in on it — please don’t forward this email or share a screenshot.
          </p>
          <p style={{ margin: 0, fontSize: 12, color: "rgba(244,234,200,0.55)" }}>
            Need help? Write to {p.supportEmail} and quote your pass code. We will never ask for your password or payment details.
          </p>
        </Cell>
        <Cell style={{ padding: "26px 4px 0", textAlign: "center", fontFamily: DISPLAY, fontSize: 14, letterSpacing: "2px", color: "rgba(244,234,200,0.4)" }}>
          MUTE THE MUNDANE · TARANG ’26
        </Cell>
      </table>
    </div>
  );
}
