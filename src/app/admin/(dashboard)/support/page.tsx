import type { Metadata } from "next";
import SupportDashboard from "./SupportDashboard";

export const metadata: Metadata = { title: "Admin · Support" };

export default function AdminSupportPage() {
  return <SupportDashboard />;
}
