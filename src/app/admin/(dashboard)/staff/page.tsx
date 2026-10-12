import type { Metadata } from "next";
import StaffManager from "./StaffManager";

export const metadata: Metadata = { title: "Admin · Staff" };

export default function AdminStaffPage() {
  return <StaffManager />;
}
