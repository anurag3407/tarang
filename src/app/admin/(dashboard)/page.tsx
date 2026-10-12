import type { Metadata } from "next";
import AdminMissionControl from "./AdminMissionControl";

export const metadata: Metadata = {
  title: "Fest Mission Control | Tech Admin",
  robots: { index: false, follow: false },
};

export default function AdminOverviewPage() {
  return <AdminMissionControl />;
}
