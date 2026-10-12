import type { Metadata } from "next";
import ScannerApp from "./ScannerApp";

export const metadata: Metadata = { title: "Scan" };

export default function ScannerPage() {
  return <ScannerApp />;
}
