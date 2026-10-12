import type { NextRequest } from "next/server";
import { z } from "zod";
import { apiError, apiFromError, apiSuccess } from "@/lib/api";
import { guardAdminMutation } from "@/lib/admin-route";
import { env } from "@/lib/env";
import { importPKCS8, SignJWT } from "jose";

export const dynamic = "force-dynamic";

const FetchSheetSchema = z.object({
  url: z.string().trim().min(1, "Google Sheets URL or ID is required"),
});

function extractSheetId(input: string): { sheetId: string; gid?: string } | null {
  const trimmed = input.trim();
  // Check if standard Google Sheets URL
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  const sheetId = match ? match[1] : trimmed.startsWith("http") ? null : trimmed;

  if (!sheetId || sheetId.length < 10) return null;

  // Extract GID if present
  let gid: string | undefined;
  const gidMatch = trimmed.match(/[#&?]gid=([0-9]+)/);
  if (gidMatch) {
    gid = gidMatch[1];
  }

  return { sheetId, gid };
}

/** Get Google API access token if service account is configured */
async function getGoogleAuthToken(): Promise<string | null> {
  const e = env();
  let jsonStr = e.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!jsonStr && e.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64) {
    try {
      jsonStr = Buffer.from(e.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64, "base64").toString("utf-8");
    } catch {
      return null;
    }
  }
  if (!jsonStr) return null;

  try {
    const creds = JSON.parse(jsonStr) as { client_email?: string; private_key?: string };
    if (!creds.client_email || !creds.private_key) return null;

    const privateKey = await importPKCS8(creds.private_key, "RS256");
    const now = Math.floor(Date.now() / 1000);
    const jwt = await new SignJWT({
      iss: creds.client_email,
      scope: "https://www.googleapis.com/auth/spreadsheets.readonly https://www.googleapis.com/auth/drive.readonly",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .sign(privateKey);

    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });

    if (!tokenRes.ok) return null;
    const tokenData = (await tokenRes.json()) as { access_token?: string };
    return tokenData.access_token ?? null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  try {
    await guardAdminMutation(req, "admin.access");

    const body = await req.json();
    const parsed = FetchSheetSchema.safeParse(body);
    if (!parsed.success) {
      return apiError(req, "VALIDATION_FAILED", "Please provide a valid Google Sheet URL or ID");
    }

    const extracted = extractSheetId(parsed.data.url);
    if (!extracted) {
      return apiError(
        req,
        "VALIDATION_FAILED",
        "Could not parse a valid Google Spreadsheet ID from the provided URL"
      );
    }

    const { sheetId, gid } = extracted;
    let csvText = "";

    // 1. Try fetching via Google Service Account (if configured)
    const token = await getGoogleAuthToken();
    if (token) {
      try {
        const sheetApiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/A1:Z500`;
        const apiRes = await fetch(sheetApiUrl, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (apiRes.ok) {
          const data = (await apiRes.json()) as { values?: string[][] };
          if (data.values && data.values.length > 0) {
            csvText = data.values
              .map((row) =>
                row
                  .map((cell) => {
                    const str = String(cell ?? "").trim();
                    if (str.includes(",") || str.includes('"') || str.includes("\n")) {
                      return `"${str.replace(/"/g, '""')}"`;
                    }
                    return str;
                  })
                  .join(",")
              )
              .join("\n");
          }
        }
      } catch {
        // Fallback to public export
      }
    }

    // 2. If not fetched via API, fetch via CSV export endpoint
    if (!csvText) {
      const exportUrl = gid
        ? `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=${gid}`
        : `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv`;

      const exportRes = await fetch(exportUrl, {
        headers: {
          "User-Agent": "Pulse-Admin-Importer/1.0",
        },
        redirect: "follow",
      });

      if (!exportRes.ok) {
        if (exportRes.status === 404) {
          return apiError(req, "NOT_FOUND", "Google Sheet not found. Please verify the URL.");
        }
        return apiError(
          req,
          "BAD_REQUEST",
          "Could not access Google Sheet. Please ensure the Google Sheet link sharing is set to 'Anyone with the link can view'."
        );
      }

      csvText = await exportRes.text();

      // Check if Google returned an HTML login page instead of CSV
      if (csvText.includes("<!DOCTYPE html") || csvText.includes("<html")) {
        return apiError(
          req,
          "FORBIDDEN",
          "Google Sheet is private. Please set General Access to 'Anyone with the link' (Viewer) in Google Sheets Share settings."
        );
      }
    }

    if (!csvText.trim()) {
      return apiError(req, "BAD_REQUEST", "The Google Sheet appears to be empty.");
    }

    return apiSuccess(req, {
      sheetId,
      gid,
      csvText,
    });
  } catch (err) {
    return apiFromError(req, err);
  }
}
