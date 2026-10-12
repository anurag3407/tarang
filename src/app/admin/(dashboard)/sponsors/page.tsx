import type { Metadata } from "next";
import SponsorsManager from "./SponsorsManager";

export const metadata: Metadata = { title: "Admin · Sponsors" };

export default function AdminSponsorsPage() {
  return <SponsorsManager />;
}
