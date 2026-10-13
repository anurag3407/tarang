import type { Metadata } from "next";
import DiscountCodesManager from "./DiscountCodesManager";

export const metadata: Metadata = { title: "Admin · Discount Codes" };

export default function AdminDiscountsPage() {
  return <DiscountCodesManager />;
}
