"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/Button";

/**
 * Pass QR display (plan §14.4).
 *
 * Fetches the signed token from the owner-authorized endpoint and renders it
 * as a QR image via the PNG endpoint. Includes a high-brightness full-screen
 * mode and a bearer-access warning. Revoked/refunded passes show the QR as
 * unavailable.
 */
export default function PassQr({ passId }: { passId: string }) {
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [message, setMessage] = useState("");
  const [passCode, setPassCode] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  // Cache-buster for the PNG endpoint; bumped on each (re)load. Kept in state
  // (not Date.now() in render) so renders stay pure/idempotent.
  const [nonce, setNonce] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);

  const qrSrc = `/api/me/passes/${passId}/qr?format=png&t=${nonce}`;

  const load = useCallback(async () => {
    setState("loading");
    try {
      const res = await fetch(`/api/me/passes/${passId}/qr`);
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.message ?? "Could not load QR");
      }
      setPassCode(body.data.passCode ?? "");
      setNonce((n) => n + 1);
      setState("ready");
    } catch (err) {
      setState("error");
      setMessage(err instanceof Error ? err.message : "Could not load QR");
    }
  }, [passId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleFullscreen() {
    if (!document.fullscreenElement) {
      await containerRef.current?.requestFullscreen();
      setFullscreen(true);
    } else {
      await document.exitFullscreen();
      setFullscreen(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-12">
      <div
        ref={containerRef}
        className={`border-8 border-black p-6 shadow-neo-lg ${
          fullscreen ? "flex min-h-screen flex-col items-center justify-center bg-neo-cream" : "bg-white"
        }`}
      >
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-black uppercase tracking-tighter">My Card</h1>
          <Link href="/dashboard" className="text-sm font-black uppercase underline">
            Back
          </Link>
        </div>

        {state === "loading" && (
          <p className="mt-8 text-center font-bold text-black/60">Loading QR…</p>
        )}

        {state === "error" && (
          <div className="mt-8 border-4 border-black bg-neo-accent p-6 text-center space-y-4 shadow-neo">
            <p className="font-bold text-sm text-black">{message}</p>
            <div className="flex flex-col gap-2 pt-2">
              <Link
                href="/pronite-pass"
                className="inline-block border-2 border-black bg-black py-2.5 px-4 text-xs font-black uppercase text-white shadow-neo-sm hover:bg-zinc-800"
              >
                Get your Pronite Pass →
              </Link>
              <Button variant="outline" className="w-full text-xs" onClick={load}>
                Retry
              </Button>
            </div>
          </div>
        )}

        {state === "ready" && (
          <>
            <p className="mt-2 text-center text-xl font-black tracking-widest">
              {passCode}
            </p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={qrSrc}
              alt="Pronite Pass gate QR code"
              width={320}
              height={320}
              className="mx-auto mt-4 border-4 border-black bg-white p-3"
            />
            <div className="mt-6 flex gap-3">
              <Button variant="secondary" className="flex-1" onClick={toggleFullscreen}>
                {fullscreen ? "Exit full screen" : "Full screen"}
              </Button>
              <Button variant="outline" className="flex-1" onClick={load}>
                Refresh
              </Button>
            </div>
            <p className="mt-4 border-4 border-black bg-neo-secondary p-3 text-center text-xs font-bold text-black">
              ⚠ This QR grants bearer access. Do not share screenshots or
              forward this code.
            </p>
          </>
        )}
      </div>
    </div>
  );
}
