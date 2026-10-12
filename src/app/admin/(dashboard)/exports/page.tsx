import type { Metadata } from "next";
import ExportsManager from "./ExportsManager";

export const metadata: Metadata = { title: "Admin · Exports" };

export default function AdminExportsPage() {
  return <ExportsManager />;
}
