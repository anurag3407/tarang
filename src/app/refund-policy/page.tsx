import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, PolicySection, SupportEmail } from "@/components/layout/LegalPage";
import { FEST } from "@/lib/data";

export const metadata: Metadata = {
  title: "Refund & Cancellation Policy",
  description: `Refund and cancellation terms for TARANG ${FEST.year} passes, event registrations and merchandise.`,
};

export default function RefundPolicyPage() {
  return (
    <LegalPage
      title="Refund &"
      accent="Cancellation"
      description="When you can get your money back, and how long it takes."
    >
      <PolicySection title="1. Passes and registrations are non-refundable">
        <p>
          Pronite Passes, event registrations and all other passes are{" "}
          <strong className="text-bone">non-refundable once confirmed</strong>, except when the event is postponed or
          cancelled (see section 3). This includes cases where you cannot
          attend, are refused entry or removed under our{" "}
          <Link href="/terms" className="t-link text-bone">Terms &amp; Conditions</Link>, or where an artist, timing or
          venue changes.
        </p>
      </PolicySection>

      <PolicySection title="2. You cannot cancel an order">
        <p>
          A confirmed order cannot be cancelled by the buyer. Passes cannot be transferred to another person.
        </p>
      </PolicySection>

      <PolicySection title="3. If the festival is postponed or cancelled">
        <p>
          If {FEST.name} {FEST.year} is postponed, your pass stays valid for the new dates. If you cannot attend on the
          new dates, write to <SupportEmail /> within 7 days of the announcement and we will refund you in full within{" "}
          <strong className="text-bone">5–7 working days</strong>.
        </p>
        <p>
          If {FEST.name} {FEST.year} is cancelled by the organisers, every buyer will receive a full refund of the amount
          paid. Refunds will be credited to the original payment method within{" "}
          <strong className="text-bone">5–7 working days</strong>. You do not need to apply. We will email you when the
          refund is started.
        </p>
        <p>
          If a single competition is cancelled, the registration fee paid for that competition will be refunded on the
          same timeline.
        </p>
      </PolicySection>

      <PolicySection title="4. Failed or duplicate payments">
        <p>
          If money was taken from your account but no pass was issued, or you were charged twice for the same order,
          we will refund the amount that was not used. It is credited to the original payment method within{" "}
          <strong className="text-bone">5–7 working days</strong>. If it has not arrived after that, write to{" "}
          <SupportEmail /> with your order code and payment reference.
        </p>
      </PolicySection>

      <PolicySection title="5. Merchandise">
        <ul>
          <li>Merchandise orders are non-refundable once placed, except as described below.</li>
          <li>
            If an item you collect is damaged or defective, or is not what you ordered, report it at the merch counter
            when you collect it, or write to <SupportEmail /> within 48 hours. We will replace it, or refund it if no
            replacement is available.
          </li>
          <li>
            If an item cannot be supplied, it will be refunded in full within{" "}
            <strong className="text-bone">5–7 working days</strong>.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="6. How refunds are paid">
        <p>
          All approved refunds go back to the original payment method through Razorpay. After we start a refund, your
          bank may take a few extra days to show it on your statement.
        </p>
      </PolicySection>
    </LegalPage>
  );
}
