import type { Metadata } from "next";
import MerchandiseManager from "./MerchandiseManager";

export const metadata: Metadata = { title: "Admin · Merchandise" };

export default function AdminMerchandisePage() {
  return <MerchandiseManager />;
}
