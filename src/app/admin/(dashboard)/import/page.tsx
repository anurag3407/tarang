import type { Metadata } from "next";
import BulkImportManager from "./BulkImportManager";

export const metadata: Metadata = { title: "Admin · Bulk User Import & Delegate Card Seeder" };

export default function AdminBulkImportPage() {
  return <BulkImportManager />;
}
