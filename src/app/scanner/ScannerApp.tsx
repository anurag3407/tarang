"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import {
  QrCode,
  Search,
  ShieldCheck,
  CheckCircle2,
  XCircle,
  User,
  Building,
  Mail,
  Calendar,
  Sparkles,
  Ticket,
  Flashlight,
  Volume2,
  VolumeX,
  Camera,
  History,
  Clock,
  ArrowRight,
  Zap,
  AlertTriangle,
} from "lucide-react";
import {
  createScannerEngineState,
  scanFrame,
  getOptimizedCameraConstraints,
  enableContinuousAutofocus,
  type ScannerEngineState,
  type DetectedScan,
} from "@/lib/scanner-engine";
import {
  playScanSuccessSound,
  playScanWarningSound,
  playScanErrorSound,
} from "@/lib/scanner-audio";
import { formatDateTimeIST, formatDateIST, formatTimeIST } from "@/lib/dates";

type ScanOutcome =
  | "accepted"
  | "accepted_reentry"
  | "provisional_offline"
  | "duplicate"
  | "cooldown"
  | "revoked"
  | "refunded"
  | "expired"
  | "wrong_event"
  | "wrong_gate"
  | "not_yet_valid"
  | "invalid_signature"
  | "unknown_credential"
  | "manual_override";

interface ScanEntry {
  gateName: string;
  at: string;
  outcome: string;
}

interface ScanResult {
  outcome: ScanOutcome;
  reasonCode: string | null;
  display: { maskedName: string | null; passClass: string | null } | null;
  recentScans: ScanEntry[];
}

interface CardLookupResult {
  found: boolean;
  passId?: string;
  publicPassCode?: string;
  state?: string;
  productName?: string;
  productSlug?: string;
  isBasePass?: boolean;
  passType?: "BASIC_CARD" | "DELEGATE_PASS";
  displayName?: string | null;
  collegeName?: string | null;
  email?: string;
  activatedAt?: string;
  expiresAt?: string | null;
  message?: string;
  recentScans?: ScanEntry[];
}

interface ShiftLogItem {
  id: string;
  time: string;
  code: string;
  name: string;
  product: string;
  outcome: string;
  gateName: string;
  success: boolean;
}

const GOOD_OUTCOMES = new Set(["accepted", "accepted_reentry", "manual_override"]);
const WARN_OUTCOMES = new Set(["cooldown", "provisional_offline", "duplicate"]);

const DEFAULT_SCANNER_CREDENTIAL = "tarang-web-scanner-default-credential";
const DEFAULT_GATE = {
  gateId: "00000000-0000-0000-0000-000000000001",
  gateName: "Main Gate",
};

export default function ScannerApp() {
  const [deviceCredential, setDeviceCredential] = useState(DEFAULT_SCANNER_CREDENTIAL);
  const [gate, setGate] = useState<{ gateId: string; gateName: string }>(DEFAULT_GATE);
  const [availableGates, setAvailableGates] = useState<{ gateId: string; gateName: string }[]>([DEFAULT_GATE]);
  const [loadingSession, setLoadingSession] = useState(true);
  const [activeTab, setActiveTab] = useState<"camera" | "manual" | "log">("camera");

  // Camera & Scanner State
  const [cameras, setCameras] = useState<MediaDeviceInfo[]>([]);
  const [cameraId, setCameraId] = useState<string>("");
  const [scanning, setScanning] = useState(false);
  const [startingCamera, setStartingCamera] = useState(false);
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [scanEngine, setScanEngine] = useState<string>("");

  // Visual Effects & Green Sides Glow
  const [greenSidesActive, setGreenSidesActive] = useState(false);
  const [redSidesActive, setRedSidesActive] = useState(false);

  // Active Scanned Modal / Sheet
  const [activeScanSheet, setActiveScanSheet] = useState<{
    open: boolean;
    success: boolean;
    outcomeTitle: string;
    outcomeSubtitle: string;
    displayName: string;
    productName: string;
    passCode: string;
    email?: string;
    collegeName?: string;
    expiresAt?: string | null;
    entries: ScanEntry[];
    rawToken?: string;
  } | null>(null);

  // Shift History Log (Stored in component state)
  const [shiftLog, setShiftLog] = useState<ShiftLogItem[]>([]);

  // Manual Tab State
  const [manualQuery, setManualQuery] = useState("");
  const [manualLoading, setManualLoading] = useState(false);
  const [manualResult, setManualResult] = useState<CardLookupResult | null>(null);
  const [manualError, setManualError] = useState("");

  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const engineStateRef = useRef<ScannerEngineState | null>(null);
  const lastTokenRef = useRef<string>("");
  const lastScanAtRef = useRef(0);
  const inFlightRef = useRef(false);
  const sequenceRef = useRef(0);
  const sidesTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Auto-init scanner session on mount
  useEffect(() => {
    let unmounted = false;
    const stored = typeof window !== "undefined" ? sessionStorage.getItem("tarang-scanner-credential") : null;
    const cred = stored || DEFAULT_SCANNER_CREDENTIAL;
    setDeviceCredential(cred);

    async function initSession() {
      try {
        setLoadingSession(true);
        const res = await fetch("/api/scanner/session", {
          headers: { "x-scanner-device-credential": cred },
        });
        const body = await res.json();
        if (!unmounted && body.ok && body.data) {
          if (body.data.gates && Array.isArray(body.data.gates) && body.data.gates.length > 0) {
            const mapped = body.data.gates.map((g: { gateId: string; gateName: string }) => ({
              gateId: g.gateId,
              gateName: g.gateName,
            }));
            setAvailableGates(mapped);
          }
          if (body.data.assignment) {
            setGate({
              gateId: body.data.assignment.gateId,
              gateName: body.data.assignment.gateName,
            });
          } else if (body.data.gates && body.data.gates.length > 0) {
            setGate({
              gateId: body.data.gates[0].gateId,
              gateName: body.data.gates[0].gateName,
            });
          }
        }
      } catch (err) {
        console.error("Scanner session init error:", err);
      } finally {
        if (!unmounted) setLoadingSession(false);
      }
    }

    void initSession();

    // Prepare scanner engine canvases
    void createScannerEngineState().then((state) => {
      if (!unmounted) engineStateRef.current = state;
    });

    return () => {
      unmounted = true;
    };
  }, []);

  const triggerGlow = useCallback((type: "green" | "red") => {
    if (sidesTimerRef.current) clearTimeout(sidesTimerRef.current);
    if (type === "green") {
      setGreenSidesActive(true);
      setRedSidesActive(false);
    } else {
      setRedSidesActive(true);
      setGreenSidesActive(false);
    }
    sidesTimerRef.current = setTimeout(() => {
      setGreenSidesActive(false);
      setRedSidesActive(false);
    }, 2500);
  }, []);

  const stopCamera = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setScanning(false);
    setStartingCamera(false);
    setTorchOn(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  // Submit and verify scanned token
  const submitScan = useCallback(
    async (rawCode: string) => {
      inFlightRef.current = true;
      const currentGate = gate || DEFAULT_GATE;

      // Haptic Vibration immediately upon capturing the code
      if (typeof navigator !== "undefined" && navigator.vibrate) {
        navigator.vibrate([120, 60, 120]);
      }

      // Extract candidate code or UUID if QR is a URL or formatted string (e.g. PP-XXXXXX or passId)
      let candidatePassCode = "";
      if (rawCode.includes("PP-")) {
        const match = rawCode.match(/PP-[A-Z0-9-]{4,20}/i);
        if (match) candidatePassCode = match[0].toUpperCase();
      } else {
        const uuidMatch = rawCode.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
        if (uuidMatch) candidatePassCode = uuidMatch[0];
      }

      const displayCode = candidatePassCode || (rawCode.length > 24 ? rawCode.substring(0, 20) + "…" : rawCode);

      // Helper to generate a valid UUID on all platforms
      const generateUUID = () => {
        if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
          try {
            return crypto.randomUUID();
          } catch {}
        }
        return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
          const r = (Math.random() * 16) | 0;
          const v = c === "x" ? r : (r & 0x3) | 0x8;
          return v.toString(16);
        });
      };

      // 1. If it is a signed VIP delegate QR token (P1.<kid>.<payload>.<sig>)
      const isSignedVipToken =
        rawCode.startsWith("P1.") &&
        rawCode.split(".").length === 4 &&
        rawCode.length >= 20;

      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      const gateIdToSend = uuidRegex.test(currentGate.gateId) ? currentGate.gateId : DEFAULT_GATE.gateId;

      if (isSignedVipToken) {
        const scanId = generateUUID();
        const capturedAtDevice = new Date().toISOString();

        try {
          const res = await fetch("/api/scanner/scan", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-scanner-device-credential": deviceCredential,
            },
            body: JSON.stringify({
              scanId,
              rawToken: rawCode.trim(),
              gateId: gateIdToSend,
              capturedAtDevice,
              sequenceNumber: sequenceRef.current++,
              offlineFlag: false,
            }),
          });
          const body = await res.json();
          if (!res.ok || !body.ok) {
            throw new Error(body.message ?? "Scan verification error");
          }

          const scanData = body.data as ScanResult;
          const isGood = GOOD_OUTCOMES.has(scanData.outcome);
          const isReentry = scanData.outcome === "accepted_reentry" || scanData.outcome === "duplicate";
          const isWarn = !isGood && WARN_OUTCOMES.has(scanData.outcome);

          if (isGood) {
            triggerGlow("green");
            if (soundEnabled) playScanSuccessSound();
            if (navigator.vibrate) navigator.vibrate([150, 60, 150]);
          } else if (isWarn) {
            triggerGlow("red");
            if (soundEnabled) playScanWarningSound();
            if (navigator.vibrate) navigator.vibrate(200);
          } else {
            triggerGlow("red");
            if (soundEnabled) playScanErrorSound();
            if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
          }

          // Build entry history combining current scan with recent scans
          const existingRecent = (scanData.recentScans || []).filter(
            (s) => Math.abs(new Date(s.at).getTime() - Date.now()) > 3000
          );
          const entryHistory: ScanEntry[] = [
            {
              gateName: currentGate.gateName,
              at: new Date().toISOString(),
              outcome: isReentry ? "accepted_reentry" : scanData.outcome,
            },
            ...existingRecent,
          ];

          // Add to Shift Log
          setShiftLog((prev) => [
            {
              id: scanId,
              time: formatTimeIST(new Date()),
              code: scanData.display?.passClass || "Pronite QR",
              name: scanData.display?.maskedName || "Pronite Pass holder",
              product: "Pronite Pass",
              outcome: isReentry
                ? "RE-ENTRY CLEARED"
                : scanData.outcome === "refunded"
                  ? "REFUNDED"
                  : scanData.outcome.replace(/_/g, " ").toUpperCase(),
              gateName: currentGate.gateName,
              success: isGood,
            },
            ...prev,
          ]);

          let outcomeTitle = "ENTRY CLEARED · ADMITTED";
          let outcomeSubtitle = "Valid Pronite Pass verified.";

          if (isReentry) {
            outcomeTitle = "VERIFIED · RE-ENTRY CLEARED";
            outcomeSubtitle = `Attendee re-entry cleared at ${currentGate.gateName}. Previous scans listed below.`;
          } else if (scanData.outcome === "accepted") {
            outcomeTitle = "VERIFIED · FIRST ENTRY CLEARED";
            outcomeSubtitle = `First scan of the day recorded at ${currentGate.gateName}.`;
          } else if (scanData.outcome === "refunded") {
            outcomeTitle = "PASS REFUNDED · ADMISSION DENIED";
            outcomeSubtitle = "This pass was cancelled and refunded by organizers. Entry is strictly prohibited.";
          } else if (!isGood) {
            outcomeTitle = scanData.outcome.replace(/_/g, " ").toUpperCase();
            outcomeSubtitle = scanData.reasonCode ?? "Scan rejected by gate policy.";
          }

          // Open Full Details Page & Previous Entries Modal
          setActiveScanSheet({
            open: true,
            success: isGood,
            outcomeTitle,
            outcomeSubtitle,
            displayName: scanData.display?.maskedName || "Pronite Pass holder",
            productName: "Pronite Pass",
            passCode: displayCode,
            entries: entryHistory,
            rawToken: rawCode,
          });
        } catch (err) {
          // Automatic recovery: If cryptographic scan endpoint fails, extract the pass code embedded in the token payload and verify via database lookup
          try {
            const parts = rawCode.split(".");
            if (parts.length === 4) {
              const b64 = parts[2].replace(/-/g, "+").replace(/_/g, "/");
              const jsonStr = atob(b64);
              const payload = JSON.parse(jsonStr);
              if (payload && payload.pass) {
                const fallbackRes = await fetch("/api/scanner/verify-card", {
                  method: "POST",
                  headers: {
                    "content-type": "application/json",
                    "x-scanner-device-credential": deviceCredential,
                  },
                  body: JSON.stringify({
                    query: payload.pass,
                    gateId: gateIdToSend,
                  }),
                });
                const fallbackBody = await fallbackRes.json();
                if (fallbackRes.ok && fallbackBody.ok && fallbackBody.data?.found) {
                  const cardData = fallbackBody.data as CardLookupResult;
                  const isGood = Boolean(cardData.found && cardData.state === "ACTIVE");
                  const isReentry = cardData.recentScans && cardData.recentScans.some(s => s.outcome === "accepted" || s.outcome === "accepted_reentry");

                  if (isGood) {
                    triggerGlow("green");
                    if (soundEnabled) playScanSuccessSound();
                    if (navigator.vibrate) navigator.vibrate([150, 60, 150]);
                  } else {
                    triggerGlow("red");
                    if (soundEnabled) playScanErrorSound();
                  }

                  const existingRecent = (cardData.recentScans || []).filter(
                    (s: ScanEntry) => Math.abs(new Date(s.at).getTime() - Date.now()) > 3000
                  );

                  const entryHistory: ScanEntry[] = [
                    {
                      gateName: currentGate.gateName,
                      at: new Date().toISOString(),
                      outcome: isGood ? (isReentry ? "accepted_reentry" : "accepted") : "rejected",
                    },
                    ...existingRecent,
                  ];

                  const isRefunded = cardData.state === "REFUNDED";
                  setShiftLog((prev) => [
                    {
                      id: generateUUID(),
                      time: formatTimeIST(new Date()),
                      code: cardData.publicPassCode || payload.pass,
                      name: cardData.displayName || "Participant",
                      product: cardData.productName || "Pronite Pass",
                      outcome: isGood
                        ? isReentry
                          ? "RE-ENTRY CLEARED"
                          : "ACCEPTED"
                        : isRefunded
                          ? "REFUNDED"
                          : "NOT FOUND",
                      gateName: currentGate.gateName,
                      success: isGood,
                    },
                    ...prev,
                  ]);

                  setActiveScanSheet({
                    open: true,
                    success: isGood,
                    outcomeTitle: isGood
                      ? isReentry
                        ? "VERIFIED · RE-ENTRY CLEARED"
                        : "VERIFIED · ENTRY CLEARED"
                      : isRefunded
                        ? "PASS REFUNDED · ADMISSION DENIED"
                        : "NO ACTIVE PASS FOUND",
                    outcomeSubtitle: isGood
                      ? `Pronite Pass verified and admission recorded at ${currentGate.gateName}.`
                      : isRefunded
                        ? "This pass was cancelled and refunded by organizers. Entry is strictly prohibited."
                        : cardData.message || "Pass is either expired, inactive, or not found.",
                    displayName: cardData.displayName || "Participant",
                    productName: cardData.productName || "Pronite Pass",
                    passCode: cardData.publicPassCode || payload.pass,
                    email: cardData.email,
                    collegeName: cardData.collegeName ?? undefined,
                    expiresAt: cardData.expiresAt,
                    entries: entryHistory,
                  });
                  return;
                }
              }
            }
          } catch {}

          triggerGlow("red");
          if (soundEnabled) playScanErrorSound();
          setActiveScanSheet({
            open: true,
            success: false,
            outcomeTitle: "INVALID PASS QR",
            outcomeSubtitle: err instanceof Error ? err.message : "QR code signature or format is invalid",
            displayName: "Unverified Attendee",
            productName: "Unrecognized QR Token",
            passCode: displayCode,
            entries: [],
          });
        } finally {
          inFlightRef.current = false;
        }
        return;
      }

      // 2. Basic Card / Pass Code Lookup (and URL fallback)
      const queryToVerify = candidatePassCode || rawCode;
      try {
        const res = await fetch("/api/scanner/verify-card", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-scanner-device-credential": deviceCredential,
          },
          body: JSON.stringify({
            query: queryToVerify,
            gateId: gateIdToSend,
          }),
        });
        const body = await res.json();
        if (!res.ok || !body.ok) {
          throw new Error(body.message ?? "Verification failed");
        }

        const cardData = body.data as CardLookupResult;
        const isGood = Boolean(cardData.found && cardData.state === "ACTIVE");
        const isRefunded = cardData.state === "REFUNDED";
        const isReentry = cardData.recentScans && cardData.recentScans.some(s => s.outcome === "accepted" || s.outcome === "accepted_reentry");

        if (isGood) {
          triggerGlow("green");
          if (soundEnabled) playScanSuccessSound();
          if (navigator.vibrate) navigator.vibrate([150, 60, 150]);
        } else {
          triggerGlow("red");
          if (soundEnabled) playScanErrorSound();
          if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        }

        const existingRecent = (cardData.recentScans || []).filter(
          (s: ScanEntry) => Math.abs(new Date(s.at).getTime() - Date.now()) > 3000
        );

        const entryHistory: ScanEntry[] = [
          {
            gateName: currentGate.gateName,
            at: new Date().toISOString(),
            outcome: isGood ? (isReentry ? "accepted_reentry" : "accepted") : isRefunded ? "refunded" : "rejected",
          },
          ...existingRecent,
        ];

        // Add to Shift Log
        setShiftLog((prev) => [
          {
            id: crypto.randomUUID(),
            time: formatTimeIST(new Date()),
            code: cardData.publicPassCode || displayCode,
            name: cardData.displayName || "Participant",
            product: cardData.productName || "Basic Pass",
            outcome: isGood
              ? isReentry
                ? "RE-ENTRY CLEARED"
                : "ACCEPTED"
              : isRefunded
                ? "REFUNDED"
                : "NOT FOUND",
            gateName: currentGate.gateName,
            success: isGood,
          },
          ...prev,
        ]);

        setActiveScanSheet({
          open: true,
          success: isGood,
          outcomeTitle: isGood
            ? isReentry
              ? "VERIFIED · RE-ENTRY CLEARED"
              : "VERIFIED · ENTRY CLEARED"
            : isRefunded
              ? "PASS REFUNDED · ADMISSION DENIED"
              : "NO ACTIVE PASS FOUND",
          outcomeSubtitle: isGood
            ? "Campus access granted for the event duration."
            : isRefunded
              ? "This pass was cancelled and refunded by organizers. Entry is strictly prohibited."
              : cardData.message || "Pass is either expired, inactive, or not found.",
          displayName: cardData.displayName || "Participant",
          productName: cardData.productName || "Festival Pass",
          passCode: cardData.publicPassCode || displayCode,
          email: cardData.email,
          collegeName: cardData.collegeName ?? undefined,
          expiresAt: cardData.expiresAt,
          entries: entryHistory,
        });
      } catch (err) {
        triggerGlow("red");
        if (soundEnabled) playScanErrorSound();
        setActiveScanSheet({
          open: true,
          success: false,
          outcomeTitle: "PASS NOT FOUND",
          outcomeSubtitle: err instanceof Error ? err.message : "Error verifying code",
          displayName: "Unknown Participant",
          productName: "Unrecognized QR",
          passCode: displayCode,
          entries: [],
        });
      } finally {
        inFlightRef.current = false;
      }
    },
    [gate, deviceCredential, soundEnabled, triggerGlow]
  );

  const processFrameRef = useRef<(() => Promise<void>) | null>(null);

  // High-Frequency Scanner Loop
  const processFrame = useCallback(async () => {
    const video = videoRef.current;
    const engineState = engineStateRef.current;

    if (!video || video.videoWidth === 0 || video.videoHeight === 0 || !engineState) {
      rafRef.current = requestAnimationFrame(() => void processFrameRef.current?.());
      return;
    }

    const now = Date.now();
    // Scan every 40ms (~25 checks per second for ultra-rapid lock)
    if (!inFlightRef.current && !activeScanSheet?.open && now - lastScanAtRef.current > 40) {
      try {
        const detected: DetectedScan | null = await scanFrame(video, engineState);
        if (detected && detected.rawValue) {
          const token = detected.rawValue;
          setScanEngine(detected.engine);

          if (token !== lastTokenRef.current) {
            lastTokenRef.current = token;
            lastScanAtRef.current = now;
            void submitScan(token);
          } else if (now - lastScanAtRef.current > 1800) {
            lastScanAtRef.current = now;
            void submitScan(token);
          }
        }
      } catch {
        // Frame exception ignored
      }
    }

    rafRef.current = requestAnimationFrame(() => void processFrameRef.current?.());
  }, [submitScan, activeScanSheet?.open]);

  useEffect(() => {
    processFrameRef.current = processFrame;
  }, [processFrame]);

  // Start Camera
  const startCamera = useCallback(
    async (deviceId?: string) => {
      stopCamera();
      setStartingCamera(true);

      try {
        if (!engineStateRef.current) {
          engineStateRef.current = await createScannerEngineState();
        }

        const constraints = getOptimizedCameraConstraints(deviceId);
        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: "environment" },
            audio: false,
          });
        }

        streamRef.current = stream;

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.setAttribute("playsinline", "true");
          videoRef.current.setAttribute("muted", "true");
          videoRef.current.setAttribute("autoplay", "true");
          try {
            await videoRef.current.play();
          } catch {
            // Autoplay permitted via button
          }
        }

        void enableContinuousAutofocus(stream);

        const track = stream.getVideoTracks()[0];
        const capabilities = track?.getCapabilities?.() as { torch?: boolean } | undefined;
        setTorchSupported(Boolean(capabilities?.torch));
        setTorchOn(false);

        const devices = await navigator.mediaDevices.enumerateDevices();
        const videoDevices = devices.filter((d) => d.kind === "videoinput");
        setCameras(videoDevices);

        setScanning(true);
        rafRef.current = requestAnimationFrame(() => void processFrame());
      } catch (err) {
        console.error("Camera access error:", err);
      } finally {
        setStartingCamera(false);
      }
    },
    [stopCamera, processFrame]
  );

  useEffect(() => {
    if (activeTab === "camera" && !scanning && !startingCamera) {
      void startCamera(cameraId || undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  async function toggleTorch() {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    try {
      await track.applyConstraints({
        // @ts-expect-error Torch constraint
        advanced: [{ torch: !torchOn }],
      });
      setTorchOn((v) => !v);
    } catch {
      setTorchSupported(false);
    }
  }

  function handleSelectGate(gateId: string) {
    const selected = availableGates.find((g) => g.gateId === gateId);
    if (selected) {
      setGate(selected);
    }
  }

  // Resume camera for next attendee
  function handleNextAttendee() {
    setActiveScanSheet(null);
    lastTokenRef.current = "";
    lastScanAtRef.current = Date.now();
  }

  // Handle Manual String Search
  async function handleManualVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!manualQuery.trim()) return;
    setManualLoading(true);
    setManualError("");
    setManualResult(null);
    try {
      const res = await fetch("/api/scanner/verify-card", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-scanner-device-credential": deviceCredential,
        },
        body: JSON.stringify({
          query: manualQuery.trim(),
          gateId: gate.gateId,
        }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.message ?? "Verification failed");
      }
      setManualResult(body.data as CardLookupResult);
      if (body.data?.found && soundEnabled) {
        playScanSuccessSound();
        triggerGlow("green");
      } else if (soundEnabled) {
        playScanErrorSound();
        triggerGlow("red");
      }
    } catch (err) {
      setManualError(err instanceof Error ? err.message : "Verification failed");
      if (soundEnabled) playScanErrorSound();
      triggerGlow("red");
    } finally {
      setManualLoading(false);
    }
  }

  return (
    <div className="relative mx-auto max-w-lg min-h-[90vh]">
      {/* -------------------------------------------------------------
          GREEN SIDES GLOW OVERLAY (When scan is captured & admitted)
          ------------------------------------------------------------- */}
      {greenSidesActive && (
        <>
          <div className="fixed inset-y-0 left-0 w-4 bg-green-500 shadow-[0_0_35px_#22c55e] z-50 animate-pulse pointer-events-none" />
          <div className="fixed inset-y-0 right-0 w-4 bg-green-500 shadow-[0_0_35px_#22c55e] z-50 animate-pulse pointer-events-none" />
          <div className="fixed inset-x-0 top-0 h-4 bg-green-500 shadow-[0_0_35px_#22c55e] z-50 animate-pulse pointer-events-none" />
          <div className="fixed inset-x-0 bottom-0 h-4 bg-green-500 shadow-[0_0_35px_#22c55e] z-50 animate-pulse pointer-events-none" />
        </>
      )}

      {/* RED SIDES GLOW OVERLAY (When scan rejected) */}
      {redSidesActive && (
        <>
          <div className="fixed inset-y-0 left-0 w-4 bg-red-500 shadow-[0_0_35px_#ef4444] z-50 animate-pulse pointer-events-none" />
          <div className="fixed inset-y-0 right-0 w-4 bg-red-500 shadow-[0_0_35px_#ef4444] z-50 animate-pulse pointer-events-none" />
        </>
      )}

      {/* Header bar */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b-2 border-white/20 pb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-black uppercase text-white/60">Gate:</span>
            {availableGates.length > 1 ? (
              <select
                value={gate.gateId}
                onChange={(e) => handleSelectGate(e.target.value)}
                className="border-2 border-neo-secondary bg-black px-2 py-0.5 text-xs font-black uppercase text-neo-secondary focus:outline-none"
              >
                {availableGates.map((g) => (
                  <option key={g.gateId} value={g.gateId}>
                    {g.gateName}
                  </option>
                ))}
              </select>
            ) : (
              <span className="font-black uppercase text-neo-secondary">
                {gate.gateName || (loadingSession ? "Connecting…" : "Main Gate")}
              </span>
            )}
          </div>
          <p className="text-[10px] font-bold text-white/60">
            NIT Patna Gate Control
          </p>
        </div>

        {/* Action icons */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSoundEnabled((s) => !s)}
            className={`flex items-center gap-1 border-2 p-1.5 text-xs font-black uppercase transition-colors ${
              soundEnabled
                ? "border-neo-secondary text-neo-secondary bg-black"
                : "border-white/40 text-white/40 bg-zinc-900"
            }`}
            title={soundEnabled ? "Sound enabled" : "Sound muted"}
          >
            {soundEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}
          </button>

          {torchSupported && activeTab === "camera" && scanning && (
            <button
              type="button"
              onClick={toggleTorch}
              className={`flex items-center gap-1 border-2 px-2.5 py-1 text-xs font-black uppercase transition-colors ${
                torchOn
                  ? "border-yellow-400 bg-yellow-400 text-black shadow-neo-sm"
                  : "border-white/60 bg-black text-white hover:border-white"
              }`}
            >
              <Flashlight className="h-3.5 w-3.5" />
              <span>{torchOn ? "Torch ON" : "Torch"}</span>
            </button>
          )}

          {activeTab === "camera" && scanning && (
            <button
              type="button"
              onClick={() => stopCamera()}
              className="border-2 border-white/40 px-2.5 py-1 text-xs font-black uppercase text-white/80 hover:bg-zinc-800"
            >
              Pause
            </button>
          )}
        </div>
      </div>

      {/* Navigation Tabs (3 Tabs) */}
      <div className="mt-4 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={() => {
            setActiveTab("camera");
            setManualResult(null);
            setManualError("");
          }}
          className={`flex items-center justify-center gap-1.5 border-4 border-black py-2 px-2 text-[11px] font-black uppercase shadow-neo-sm transition-all ${
            activeTab === "camera"
              ? "bg-neo-secondary text-black"
              : "bg-black text-white hover:bg-zinc-800"
          }`}
        >
          <QrCode className="h-3.5 w-3.5" />
          <span>Scanner</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab("manual");
            stopCamera();
          }}
          className={`flex items-center justify-center gap-1.5 border-4 border-black py-2 px-2 text-[11px] font-black uppercase shadow-neo-sm transition-all ${
            activeTab === "manual"
              ? "bg-neo-accent text-black"
              : "bg-black text-white hover:bg-zinc-800"
          }`}
        >
          <Search className="h-3.5 w-3.5" />
          <span>Manual</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab("log");
            stopCamera();
          }}
          className={`flex items-center justify-center gap-1.5 border-4 border-black py-2 px-2 text-[11px] font-black uppercase shadow-neo-sm transition-all ${
            activeTab === "log"
              ? "bg-white text-black"
              : "bg-black text-white hover:bg-zinc-800"
          }`}
        >
          <History className="h-3.5 w-3.5" />
          <span>Gate Log ({shiftLog.length})</span>
        </button>
      </div>

      {/* -------------------------------------------------------------
          TAB 1: RAPID QR CAMERA SCANNER
          ------------------------------------------------------------- */}
      {activeTab === "camera" && (
        <div className="mt-4">
          {/* Main Viewfinder Frame with Dynamic Glowing Edges */}
          <div
            className={`relative h-[390px] w-full overflow-hidden border-8 bg-black transition-all ${
              greenSidesActive
                ? "border-green-400 shadow-[0_0_40px_rgba(34,197,94,0.8)] ring-4 ring-green-400"
                : redSidesActive
                  ? "border-red-500 shadow-[0_0_40px_rgba(239,68,68,0.8)] ring-4 ring-red-500"
                  : "border-neo-secondary"
            }`}
          >
            <video
              ref={videoRef}
              className="h-full w-full object-cover"
              muted
              playsInline
              autoPlay
            />

            {/* Camera Offline / Click to Start */}
            {!scanning && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/90 p-6 text-center space-y-4">
                <div className="rounded-full bg-neo-secondary/10 p-4 border-2 border-neo-secondary">
                  <Zap className="h-8 w-8 text-neo-secondary animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-black uppercase text-white tracking-tight">
                    Instant Camera Scanner
                  </h3>
                  <p className="mt-1 text-xs font-bold text-white/70 max-w-xs">
                    Point camera at attendee pass QR code or show code for rapid entry scan.
                  </p>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => void startCamera(cameraId || undefined)}
                  disabled={startingCamera}
                >
                  {startingCamera ? "Initializing Camera…" : "Start Camera"}
                </Button>
              </div>
            )}

            {/* Aiming Reticle Box */}
            {scanning && !activeScanSheet?.open && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                <div className="relative h-60 w-60">
                  {/* Glowing Corners */}
                  <div
                    className={`absolute top-0 left-0 h-8 w-8 border-t-4 border-l-4 transition-colors ${
                      greenSidesActive
                        ? "border-green-400"
                        : redSidesActive
                          ? "border-red-400"
                          : "border-neo-secondary"
                    }`}
                  />
                  <div
                    className={`absolute top-0 right-0 h-8 w-8 border-t-4 border-r-4 transition-colors ${
                      greenSidesActive
                        ? "border-green-400"
                        : redSidesActive
                          ? "border-red-400"
                          : "border-neo-secondary"
                    }`}
                  />
                  <div
                    className={`absolute bottom-0 left-0 h-8 w-8 border-b-4 border-l-4 transition-colors ${
                      greenSidesActive
                        ? "border-green-400"
                        : redSidesActive
                          ? "border-red-400"
                          : "border-neo-secondary"
                    }`}
                  />
                  <div
                    className={`absolute bottom-0 right-0 h-8 w-8 border-b-4 border-r-4 transition-colors ${
                      greenSidesActive
                        ? "border-green-400"
                        : redSidesActive
                          ? "border-red-400"
                          : "border-neo-secondary"
                    }`}
                  />

                  {/* Sweeping Laser Line Animation */}
                  <div className="absolute inset-x-2 h-0.5 bg-gradient-to-r from-transparent via-cyan-400 to-transparent shadow-[0_0_12px_#38bdf8] animate-scan-sweep" />

                  {/* Engine Indicator */}
                  <div className="absolute -top-7 inset-x-0 flex justify-center">
                    <span className="bg-black/90 px-2.5 py-0.5 text-[10px] font-black uppercase tracking-wider text-neo-secondary border border-neo-secondary/50 rounded">
                      {scanEngine ? `Rapid ${scanEngine.replace("_", " ").toUpperCase()}` : "Ready to Scan"}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Camera Selection Dropdown */}
          {cameras.length > 1 && (
            <div className="mt-3 flex items-center gap-2">
              <Camera className="h-4 w-4 text-white/60" />
              <select
                value={cameraId}
                onChange={(e) => {
                  setCameraId(e.target.value);
                  void startCamera(e.target.value);
                }}
                className="w-full border-2 border-white/40 bg-black px-3 py-1.5 text-xs font-bold text-white focus:outline-none"
              >
                <option value="">Default Rear Camera (High-Res)</option>
                {cameras.map((c, i) => (
                  <option key={c.deviceId} value={c.deviceId}>
                    {c.label || `Camera Device ${i + 1}`}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------
          FULL-SCREEN SCANNED PASS DETAILS & PREVIOUS ENTRIES SHEET
          (Opens automatically when a QR code is captured)
          ------------------------------------------------------------- */}
      {activeScanSheet && activeScanSheet.open && (
        <div className="mt-4 border-8 border-black bg-white text-black shadow-neo-xl overflow-hidden animate-in fade-in zoom-in-95 duration-200">
          {/* Header Banner */}
          <div
            className={`p-5 flex items-center justify-between border-b-4 border-black ${
              activeScanSheet.success
                ? "bg-green-400 text-black"
                : activeScanSheet.outcomeTitle.includes("REFUNDED")
                  ? "bg-red-600 text-white"
                  : "bg-neo-accent text-black"
            }`}
          >
            <div className="flex items-center gap-3">
              {activeScanSheet.success ? (
                <CheckCircle2 className="h-8 w-8 text-black shrink-0" strokeWidth={3} />
              ) : (
                <XCircle
                  className={`h-8 w-8 shrink-0 ${
                    activeScanSheet.outcomeTitle.includes("REFUNDED") ? "text-white" : "text-black"
                  }`}
                  strokeWidth={3}
                />
              )}
              <div>
                <h2 className="text-xl font-black uppercase tracking-tight leading-none">
                  {activeScanSheet.outcomeTitle}
                </h2>
                <p
                  className={`mt-1 text-xs font-bold ${
                    activeScanSheet.outcomeTitle.includes("REFUNDED") ? "text-white/90" : "text-black/80"
                  }`}
                >
                  {activeScanSheet.outcomeSubtitle}
                </p>
              </div>
            </div>
          </div>

          {/* Attendee Info Card */}
          <div className="p-5 space-y-4 text-xs font-bold bg-neo-cream">
            {activeScanSheet.outcomeTitle.includes("REFUNDED") && (
              <div className="border-2 border-red-600 bg-red-100 p-3 text-red-900 font-black text-xs uppercase flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                <span>⛔ CANCELLED PASS: This pass was refunded by organizers. Admission is strictly prohibited.</span>
              </div>
            )}
            <div className="flex items-center justify-between border-b-2 border-black/10 pb-3">
              <div>
                <span className="text-[10px] font-black uppercase tracking-wider text-black/60 block">
                  Pass Product
                </span>
                <p className="text-base font-black uppercase text-black flex items-center gap-1.5">
                  {activeScanSheet.productName.toLowerCase().includes("vip") ? (
                    <Sparkles className="h-4 w-4 fill-black" />
                  ) : (
                    <Ticket className="h-4 w-4" />
                  )}
                  {activeScanSheet.productName}
                </p>
              </div>
              <div className="text-right">
                <span className="text-[10px] font-black uppercase tracking-wider text-black/60 block">
                  Pass Code
                </span>
                <p className="font-mono text-base font-black tracking-widest text-black">
                  {activeScanSheet.passCode}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <User className="h-4 w-4 text-black/60 shrink-0" />
                <span>
                  Participant: <strong className="text-sm font-black">{activeScanSheet.displayName}</strong>
                </span>
              </div>

              {activeScanSheet.collegeName && (
                <div className="flex items-center gap-2">
                  <Building className="h-4 w-4 text-black/60 shrink-0" />
                  <span>
                    College: <strong className="font-black">{activeScanSheet.collegeName}</strong>
                  </span>
                </div>
              )}

              {activeScanSheet.email && (
                <div className="flex items-center gap-2">
                  <Mail className="h-4 w-4 text-black/60 shrink-0" />
                  <span>
                    Email: <strong className="font-mono">{activeScanSheet.email}</strong>
                  </span>
                </div>
              )}

              {activeScanSheet.expiresAt && (
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-black/60 shrink-0" />
                  <span>
                    Valid Through:{" "}
                    <strong>{formatDateIST(activeScanSheet.expiresAt)}</strong>
                  </span>
                </div>
              )}
            </div>

            {/* PREVIOUS ENTRIES & CHECK-IN HISTORY SECTION */}
            <div className="mt-4 pt-3 border-t-2 border-black/10">
              <div className="flex items-center justify-between mb-2">
                <span className="text-[11px] font-black uppercase tracking-wider text-black flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Previous Gate Entries ({activeScanSheet.entries.length})
                </span>
                <span className="text-[10px] font-bold text-black/60">
                  Gate: {gate.gateName}
                </span>
              </div>

              {activeScanSheet.entries.length > 0 ? (
                <div className="border-2 border-black bg-white divide-y-2 divide-black/10 max-h-48 overflow-y-auto">
                  {activeScanSheet.entries.map((entry, idx) => {
                    const isEntryGood = GOOD_OUTCOMES.has(entry.outcome);
                    const isReentryOutcome = entry.outcome === "accepted_reentry" || entry.outcome === "duplicate";
                    return (
                      <div key={idx} className="p-2.5 flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-2">
                          <span className="font-mono text-[10px] px-1.5 py-0.5 bg-zinc-100 border border-black font-black">
                            #{activeScanSheet.entries.length - idx}
                          </span>
                          <div>
                            <span className="font-black text-black">{entry.gateName || "Main Gate"}</span>
                            <p className="text-[10px] text-black/60">
                              {formatDateTimeIST(entry.at)}
                            </p>
                          </div>
                        </div>
                        <span
                          className={`px-2 py-0.5 text-[10px] font-black uppercase border border-black ${
                            isEntryGood
                              ? isReentryOutcome
                                ? "bg-green-200 text-green-950"
                                : "bg-green-400 text-black"
                              : "bg-neo-accent text-black"
                          }`}
                        >
                          {isReentryOutcome
                            ? "RE-ENTRY CLEARED"
                            : entry.outcome === "accepted"
                              ? "FIRST ENTRY"
                              : entry.outcome.replace(/_/g, " ")}
                        </span>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="border-2 border-black bg-white p-3 text-center text-xs font-bold text-green-800">
                  🎉 First Check-in Recorded for this Pass!
                </div>
              )}
            </div>

            {/* Scan Next Action Button */}
            <div className="mt-4 pt-2">
              <Button
                variant="primary"
                className="w-full py-3.5 text-sm font-black flex items-center justify-center gap-2 bg-black text-white shadow-neo hover:bg-zinc-800"
                onClick={handleNextAttendee}
              >
                <span>Scan Next Attendee</span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* -------------------------------------------------------------
          TAB 2: MANUAL STRING / EMAIL SEARCH
          ------------------------------------------------------------- */}
      {activeTab === "manual" && (
        <div className="mt-4 space-y-4">
          <form onSubmit={handleManualVerify} className="border-4 border-black bg-white p-5 text-black shadow-neo">
            <h3 className="text-base font-black uppercase tracking-tight flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-black" />
              Basic Pass &amp; String Lookup
            </h3>
            <p className="mt-1 text-xs font-bold text-black/70">
              Enter attendee&apos;s unique verification code (e.g. PP-...) or registered email:
            </p>

            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={manualQuery}
                onChange={(e) => setManualQuery(e.target.value)}
                placeholder="e.g. PP-A1B2C3 or student@college.edu"
                className="flex-1 border-2 border-black bg-neo-cream px-3 py-2 text-sm font-bold uppercase placeholder:normal-case focus:outline-none"
                required
              />
              <Button type="submit" variant="primary" disabled={manualLoading}>
                {manualLoading ? "Searching…" : "Verify"}
              </Button>
            </div>
          </form>

          {manualError && (
            <div className="border-4 border-black bg-neo-accent p-4 text-black font-bold text-xs shadow-neo">
              {manualError}
            </div>
          )}

          {manualResult && (
            <div className="border-8 border-black bg-white text-black shadow-neo-xl overflow-hidden">
              {manualResult.found ? (
                <>
                  <div
                    className={`flex items-center justify-between border-b-4 border-black p-4 ${
                      manualResult.state === "REFUNDED"
                        ? "bg-red-600 text-white"
                        : manualResult.state === "ACTIVE"
                          ? "bg-green-400 text-black"
                          : "bg-neo-accent text-black"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {manualResult.state === "ACTIVE" ? (
                        <CheckCircle2 className="h-6 w-6 text-black" strokeWidth={3} />
                      ) : (
                        <XCircle
                          className={`h-6 w-6 ${manualResult.state === "REFUNDED" ? "text-white" : "text-black"}`}
                          strokeWidth={3}
                        />
                      )}
                      <span className="text-lg font-black uppercase tracking-tight">
                        {manualResult.state === "REFUNDED"
                          ? "PASS REFUNDED · ADMISSION DENIED"
                          : manualResult.recentScans && manualResult.recentScans.some((s) => s.outcome === "accepted" || s.outcome === "accepted_reentry")
                            ? "VERIFIED · RE-ENTRY CLEARED"
                            : "VERIFIED · ENTRY CLEARED"}
                      </span>
                    </div>
                    <span
                      className={`border-2 border-black px-2 py-0.5 text-xs font-black uppercase ${
                        manualResult.state === "REFUNDED"
                          ? "bg-black text-red-400 font-bold"
                          : "bg-black text-green-300"
                      }`}
                    >
                      {manualResult.state}
                    </span>
                  </div>

                  <div className="p-5 space-y-3 text-xs font-bold">
                    {manualResult.state === "REFUNDED" && (
                      <div className="border-2 border-red-600 bg-red-100 p-3 text-red-900 font-black text-xs uppercase flex items-center gap-2">
                        <AlertTriangle className="h-5 w-5 text-red-600 shrink-0" />
                        <span>⛔ WARNING: This pass was cancelled and refunded by organizers. Do NOT admit attendee.</span>
                      </div>
                    )}
                    <div className="flex items-center justify-between border-b-2 border-black/10 pb-2">
                      <div>
                        <span className="text-[10px] text-black/60 uppercase">Tier</span>
                        <p className="text-base font-black">{manualResult.productName}</p>
                      </div>
                      <div className="text-right">
                        <span className="text-[10px] text-black/60 uppercase">Pass Code</span>
                        <p className="font-mono text-base font-black">{manualResult.publicPassCode}</p>
                      </div>
                    </div>

                    <p>Participant: <strong>{manualResult.displayName}</strong></p>
                    {manualResult.collegeName && <p>College: <strong>{manualResult.collegeName}</strong></p>}
                    {manualResult.email && <p>Email: <strong className="font-mono">{manualResult.email}</strong></p>}

                    {/* Previous entries */}
                    {manualResult.recentScans && manualResult.recentScans.length > 0 && (
                      <div className="mt-3 pt-2 border-t-2 border-black/10">
                        <p className="text-[11px] font-black uppercase mb-1">Previous Check-Ins:</p>
                        <div className="border-2 border-black bg-white divide-y-2 divide-black/10">
                          {manualResult.recentScans.map((s, i) => (
                            <div key={i} className="p-1.5 flex justify-between text-[10px]">
                              <span>{s.gateName}</span>
                              <span>{formatTimeIST(s.at)}</span>
                              <span className="font-black uppercase">{s.outcome}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <Button
                      variant="secondary"
                      className="w-full mt-3 text-xs py-2"
                      onClick={() => {
                        setManualResult(null);
                        setManualQuery("");
                      }}
                    >
                      Next Attendee →
                    </Button>
                  </div>
                </>
              ) : (
                <div className="p-6 text-center bg-neo-accent text-black space-y-3">
                  <XCircle className="mx-auto h-10 w-10 text-black" strokeWidth={3} />
                  <p className="text-xl font-black uppercase">No Matching Card Found</p>
                  <p className="text-xs font-bold">{manualResult.message}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------
          TAB 3: GATE LOG (ALL ENTRIES SCANNED DURING THIS SHIFT)
          ------------------------------------------------------------- */}
      {activeTab === "log" && (
        <div className="mt-4 border-4 border-black bg-white p-5 text-black shadow-neo space-y-3">
          <div className="flex items-center justify-between border-b-2 border-black pb-2">
            <div>
              <h3 className="text-base font-black uppercase">Gate Shift Log</h3>
              <p className="text-[11px] font-bold text-black/60">
                Gate: {gate.gateName} · Total Entries Scanned: {shiftLog.length}
              </p>
            </div>
            {shiftLog.length > 0 && (
              <button
                type="button"
                onClick={() => setShiftLog([])}
                className="text-[10px] font-black uppercase underline text-black/60 hover:text-black"
              >
                Clear Log
              </button>
            )}
          </div>

          {shiftLog.length > 0 ? (
            <div className="divide-y-2 divide-black/10 max-h-[500px] overflow-y-auto">
              {shiftLog.map((item) => (
                <div key={item.id} className="py-2.5 flex items-center justify-between text-xs">
                  <div>
                    <div className="flex items-center gap-1.5">
                      <span className="font-black text-black">{item.name}</span>
                      <span className="text-[10px] px-1.5 py-0.2 border border-black bg-zinc-100 font-mono">
                        {item.code}
                      </span>
                    </div>
                    <p className="text-[10px] text-black/60">
                      {item.product} · {item.time} at {item.gateName}
                    </p>
                  </div>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-black uppercase border border-black ${
                      item.success ? "bg-green-400 text-black" : "bg-neo-accent text-black"
                    }`}
                  >
                    {item.outcome}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-black/60 font-bold text-xs space-y-2">
              <Clock className="h-8 w-8 mx-auto text-black/40" />
              <p>No scans recorded yet during this active gate session.</p>
              <Button
                variant="outline"
                className="text-xs bg-black text-white mt-2"
                onClick={() => setActiveTab("camera")}
              >
                Open Camera Scanner
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
