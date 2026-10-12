import type { ReactNode } from "react";

/**
 * Shared neo-brutal email layout (plan §13.3).
 *
 * Table-based, inline styles only, no web fonts / grid / JS. High-contrast
 * black borders and solid accent colors. Degrades gracefully when images
 * are blocked (all meaning is in text).
 */

export const EMAIL_COLORS = {
  cream: "#fffdf5",
  black: "#000000",
  accent: "#ff6b6b",
  secondary: "#ffd93d",
  muted: "#c4b5fd",
  white: "#ffffff",
} as const;

export function EmailLayout({
  title,
  children,
  accent = EMAIL_COLORS.accent,
}: {
  title: string;
  children: ReactNode;
  accent?: string;
}) {
  return (
    <div style={{ backgroundColor: EMAIL_COLORS.cream, padding: "24px 12px" }}>
      <table
        role="presentation"
        width="100%"
        cellPadding={0}
        cellSpacing={0}
        style={{ maxWidth: 560, margin: "0 auto" }}
      >
        {/* Header */}
        <tr>
          <td
            style={{
              backgroundColor: accent,
              border: `4px solid ${EMAIL_COLORS.black}`,
              padding: "16px 20px",
            }}
          >
            <span
              style={{
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: 24,
                fontWeight: 900,
                textTransform: "uppercase",
                letterSpacing: -1,
                color: EMAIL_COLORS.black,
              }}
            >
              TARANG 2026
            </span>
          </td>
        </tr>
        {/* Title */}
        <tr>
          <td
            style={{
              backgroundColor: EMAIL_COLORS.white,
              borderLeft: `4px solid ${EMAIL_COLORS.black}`,
              borderRight: `4px solid ${EMAIL_COLORS.black}`,
              padding: "20px 20px 8px",
            }}
          >
            <h1
              style={{
                fontFamily: "Arial, Helvetica, sans-serif",
                fontSize: 22,
                fontWeight: 900,
                textTransform: "uppercase",
                margin: 0,
                color: EMAIL_COLORS.black,
              }}
            >
              {title}
            </h1>
          </td>
        </tr>
        {/* Body */}
        <tr>
          <td
            style={{
              backgroundColor: EMAIL_COLORS.white,
              borderLeft: `4px solid ${EMAIL_COLORS.black}`,
              borderRight: `4px solid ${EMAIL_COLORS.black}`,
              borderBottom: `4px solid ${EMAIL_COLORS.black}`,
              padding: "12px 20px 24px",
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 15,
              lineHeight: "22px",
              color: EMAIL_COLORS.black,
            }}
          >
            {children}
          </td>
        </tr>
        {/* Footer */}
        <tr>
          <td
            style={{
              padding: "16px 4px",
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 12,
              color: "#444444",
              textAlign: "center",
            }}
          >
            TARANG 2026 · Student Centre, Campus · This is an automated
            transactional message. If you did not make this request, contact the
            help desk immediately.
          </td>
        </tr>
      </table>
    </div>
  );
}

/** A bordered key/value fact row. */
export function FactRow({ label, value }: { label: string; value: string }) {
  return (
    <table role="presentation" width="100%" cellPadding={0} cellSpacing={0}>
      <tr>
        <td
          style={{
            border: `2px solid ${EMAIL_COLORS.black}`,
            backgroundColor: EMAIL_COLORS.cream,
            padding: "8px 12px",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 13,
            fontWeight: 700,
            textTransform: "uppercase",
            width: "40%",
          }}
        >
          {label}
        </td>
        <td
          style={{
            border: `2px solid ${EMAIL_COLORS.black}`,
            borderLeft: "none",
            backgroundColor: EMAIL_COLORS.white,
            padding: "8px 12px",
            fontFamily: "Arial, Helvetica, sans-serif",
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          {value}
        </td>
      </tr>
    </table>
  );
}

/** A solid call-to-action button. */
export function CtaButton({ href, label }: { href: string; label: string }) {
  return (
    <table role="presentation" cellPadding={0} cellSpacing={0}>
      <tr>
        <td
          style={{
            backgroundColor: EMAIL_COLORS.secondary,
            border: `3px solid ${EMAIL_COLORS.black}`,
            padding: "10px 20px",
          }}
        >
          <a
            href={href}
            style={{
              fontFamily: "Arial, Helvetica, sans-serif",
              fontSize: 15,
              fontWeight: 900,
              textTransform: "uppercase",
              color: EMAIL_COLORS.black,
              textDecoration: "none",
            }}
          >
            {label}
          </a>
        </td>
      </tr>
    </table>
  );
}

export function Spacer({ height = 16 }: { height?: number }) {
  return <div style={{ height, lineHeight: `${height}px` }}>&nbsp;</div>;
}
