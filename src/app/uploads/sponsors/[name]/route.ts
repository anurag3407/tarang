import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const dynamic = "force-dynamic";

/**
 * GET /uploads/sponsors/:name — serve sponsor logos uploaded at runtime.
 *
 * `next start` indexes public/ once at boot, so a logo written to
 * public/uploads/sponsors after startup would 404 until the next restart.
 * Files present at boot are still served by Next's static handler first;
 * this route only answers for the rest. The name must match exactly what the
 * upload route generates, so no path can escape the directory.
 */

const NAME_RE = /^sponsor-\d{10,16}-[0-9a-f]{8}\.(png|jpg|webp|gif)$/;

const CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
};

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ name: string }> }
) {
  const { name } = await ctx.params;
  const match = NAME_RE.exec(name);
  if (!match) return new Response("Not found", { status: 404 });

  try {
    const bytes = await readFile(join(process.cwd(), "public", "uploads", "sponsors", name));
    return new Response(new Uint8Array(bytes), {
      headers: {
        "content-type": CONTENT_TYPES[match[1]],
        // Names are unique per upload, so the content never changes.
        "cache-control": "public, max-age=31536000, immutable",
        "x-content-type-options": "nosniff",
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
