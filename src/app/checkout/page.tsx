import { redirect } from "next/navigation";

/** The old base-pass checkout now lives on the Pronite Pass page. */
export default function CheckoutRedirect() {
  redirect("/pronite-pass");
}
