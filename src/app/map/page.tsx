import { redirect } from "next/navigation";

/** The interactive campus map returns once the NIT Patna venue plan is published. */
export default function MapRedirect() {
  redirect("/reach");
}
