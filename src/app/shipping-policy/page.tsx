import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, PolicySection, SupportEmail } from "@/components/layout/LegalPage";
import { FEST } from "@/lib/data";

export const metadata: Metadata = {
  title: "Shipping & Delivery Policy",
  description: `How TARANG ${FEST.year} passes are delivered digitally and how merchandise is collected.`,
};

export default function ShippingPolicyPage() {
  return (
    <LegalPage
      title="Shipping &"
      accent="Delivery"
      description="Passes are digital and arrive instantly. Merchandise is collected on campus."
    >
      <PolicySection title="1. Passes and registrations: digital delivery">
        <p>
          Tickets and delegate passes, including the Pronite Pass and event registrations, are{" "}
          <strong className="text-bone">digital goods</strong>. They are delivered instantly to the buyer’s registered
          email address once the payment is confirmed.
        </p>
        <ul>
          <li>Your pass and its gate QR code also appear right away in your dashboard on this website.</li>
          <li>Nothing is shipped by post or courier, and there are no delivery charges.</li>
          <li>
            If your confirmation email has not arrived within 30 minutes, check your spam folder and your{" "}
            <Link href="/dashboard" className="t-link text-bone">dashboard</Link>. Then write to <SupportEmail /> with
            your order code.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="2. Merchandise: campus pickup">
        <p>
          Merchandise is not shipped. Collect it at the TARANG merch counter on campus during the festival (
          {FEST.dates}) at {FEST.venue}.
        </p>
        <ul>
          <li>Show the order code from your confirmation email or dashboard.</li>
          <li>We will announce the counter’s location and timings on the Notices page.</li>
          <li>There is no charge for pickup.</li>
        </ul>
      </PolicySection>

      <PolicySection title="3. Delivery area">
        <p>
          Digital passes can be bought and received from anywhere. They can only be used at the festival venue in
          Patna, Bihar, India.
        </p>
      </PolicySection>
    </LegalPage>
  );
}
