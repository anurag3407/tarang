import type { Metadata } from "next";
import BulkImportManager from "./BulkImportManager";

export const metadata: Metadata = { title: "Admin · Bulk User Import & Pronite Pass Issuance" };

export default function AdminBulkImportPage() {
  return <BulkImportManager />;
}
