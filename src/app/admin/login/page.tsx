import type { Metadata } from "next";
import { AuthStage } from "@/components/ui/AuthStage";
import AdminLoginForm from "./AdminLoginForm";

export const metadata: Metadata = {
  title: "Staff Sign In",
  robots: { index: false },
};

export default function AdminLoginPage() {
  return (
    <AuthStage>
      <AdminLoginForm />
    </AuthStage>
  );
}
