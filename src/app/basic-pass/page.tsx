import { redirect } from "next/navigation";

/** Legacy pass URL — TARANG now sells a single Pronite Pass. */
export default function LegacyPassRedirect() {
  redirect("/pronite-pass");
}
