import type { Metadata } from "next";
import NoticesManager from "./NoticesManager";

export const metadata: Metadata = { title: "Admin · Notices" };

export default function AdminNoticesPage() {
  return <NoticesManager />;
}
