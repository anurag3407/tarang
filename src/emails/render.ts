import "server-only";
import { isValidElement, type ReactNode } from "react";

function styleObjectToString(style: Record<string, unknown>): string {
  return Object.entries(style)
    .map(([k, v]) => {
      const cssKey = k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      const val =
        typeof v === "number" && !["opacity", "zIndex", "fontWeight", "lineHeight"].includes(k)
          ? `${v}px`
          : String(v);
      return `${cssKey}:${val}`;
    })
    .join(";");
}

/**
 * Universal JSX-to-HTML renderer for email templates.
 * Bypasses React 19 RSC `react-dom/server` restrictions safely.
 */
export function renderEmailHtml(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(renderEmailHtml).join("");

  if (isValidElement(node)) {
    const { type, props } = node as { type: unknown; props: Record<string, unknown> };
    if (typeof type === "function") {
      return renderEmailHtml((type as (p: Record<string, unknown>) => ReactNode)(props));
    }
    if (typeof type === "string") {
      const attrs: string[] = [];
      for (const [k, v] of Object.entries(props || {})) {
        if (k === "children" || v === null || v === undefined) continue;
        if (k === "style" && typeof v === "object") {
          attrs.push(`style="${styleObjectToString(v as Record<string, unknown>)}"`);
        } else if (k === "className") {
          attrs.push(`class="${String(v)}"`);
        } else if (k === "cellPadding") {
          attrs.push(`cellpadding="${String(v)}"`);
        } else if (k === "cellSpacing") {
          attrs.push(`cellspacing="${String(v)}"`);
        } else {
          attrs.push(`${k}="${String(v)}"`);
        }
      }
      const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";
      const isVoid = ["img", "br", "hr", "meta", "input"].includes(type.toLowerCase());
      if (isVoid) return `<${type}${attrStr} />`;
      const childrenHtml = renderEmailHtml(props.children as ReactNode);
      return `<${type}${attrStr}>${childrenHtml}</${type}>`;
    }
  }
  return "";
}

/** Convert HTML string to plain text for email fallback */
export function renderEmailText(html: string): string {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<\/tr>|<\/p>|<\/div>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n\s*\n\s*\n/g, "\n\n")
    .trim();
}
