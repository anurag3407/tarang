import type { NextRequest } from "next/server";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation } from "@/lib/admin-route";

export const dynamic = "force-dynamic";

const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

type ImageFormat = "png" | "jpg" | "webp" | "gif";

/**
 * Detect the real image format from magic bytes — the client-declared
 * `file.type` is untrusted. SVG is intentionally not supported: it is an
 * XSS vector when served from the same origin.
 */
function detectImageFormat(bytes: Uint8Array): ImageFormat | null {
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "jpg";
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x46 && bytes[8] === 0x57 && bytes[9] === 0x45 &&
    bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return "webp";
  }
  if (
    bytes.length >= 6 &&
    bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 &&
    bytes[3] === 0x38
  ) {
    return "gif";
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    await guardAdminMutation(req, "content.sponsor.write");

    const formData = await req.formData();
    const file = formData.get("file");

    if (!file || typeof file === "string" || !(file instanceof Blob)) {
      return apiError(req, "VALIDATION_FAILED", "No valid image file uploaded");
    }

    if (file.size > MAX_FILE_SIZE) {
      return apiError(req, "VALIDATION_FAILED", "Image exceeds maximum allowed size of 5MB");
    }

    const arrayBuffer = await file.arrayBuffer();
    const bytes = new Uint8Array(arrayBuffer);
    const format = detectImageFormat(bytes);
    if (!format) {
      return apiError(
        req,
        "VALIDATION_FAILED",
        "Unsupported image. Please upload a PNG, JPEG, WEBP, or GIF file."
      );
    }
    if (file.type && !ALLOWED_MIME_TYPES.has(file.type)) {
      return apiError(req, "VALIDATION_FAILED", "File content does not match its declared type");
    }

    const fileName = `sponsor-${Date.now()}-${randomBytes(4).toString("hex")}.${format}`;
    const uploadDir = join(process.cwd(), "public", "uploads", "sponsors");
    await mkdir(uploadDir, { recursive: true });

    const filePath = join(uploadDir, fileName);
    await writeFile(filePath, Buffer.from(arrayBuffer));

    const publicUrl = `/uploads/sponsors/${fileName}`;
    return apiSuccess(req, { url: publicUrl, name: fileName, size: file.size });
  } catch (err) {
    return apiFromError(req, err);
  }
}
