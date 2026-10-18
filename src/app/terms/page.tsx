import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, ORGANISER, PolicySection, SupportEmail } from "@/components/layout/LegalPage";
import { FEST } from "@/lib/data";

export const metadata: Metadata = {
  title: "Terms & Conditions",
  description: `Terms for buying TARANG ${FEST.year} passes, event registrations and merchandise, and the rules of entry at ${FEST.college}.`,
};

export default function TermsPage() {
  return (
    <LegalPage
      title="Terms &"
      accent="Conditions"
      description={`The rules for buying passes, registering for events and entering TARANG ${FEST.year}.`}
    >
      <PolicySection title="1. About these terms">
        <p>
          This website is operated by {ORGANISER} (“TARANG”, “we”, “us”). By creating an account, buying a pass,
          registering for an event or ordering merchandise on this website, you agree to these terms, our{" "}
          <Link href="/privacy" className="t-link text-bone">Privacy Policy</Link> and our{" "}
          <Link href="/refund-policy" className="t-link text-bone">Refund &amp; Cancellation Policy</Link>.
        </p>
      </PolicySection>

      <PolicySection title="2. Accounts">
        <ul>
          <li>You must give your real name, a working email address and a valid phone number.</li>
          <li>You are responsible for keeping your login secure and for everything bought from your account.</li>
          <li>One person may hold one account. Duplicate or fake accounts may be suspended without refund.</li>
        </ul>
      </PolicySection>

      <PolicySection title="3. Passes and purchases">
        <ul>
          <li>
            Prices are shown in Indian Rupees (INR) and include applicable taxes unless stated otherwise. Payments are
            processed securely by Razorpay.
          </li>
          <li>
            A pass is confirmed only after the payment is successfully captured. You will receive a confirmation email
            and the pass will appear in your dashboard.
          </li>
          <li>
            Each pass is issued to one named person and is valid only for {FEST.name} {FEST.year} ({FEST.dates}).
          </li>
          <li>
            Passes are non-transferable and may not be resold. Passes found to be resold, duplicated or tampered with
            will be cancelled without refund.
          </li>
          <li>
            Discount codes are subject to their own conditions, cannot be combined unless stated, and may be withdrawn
            at any time.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="4. Event entry rules">
        <ul>
          <li>
            Show your pass QR code from your dashboard together with a valid photo ID (a college ID for students) at
            the gate. Entry without both may be refused.
          </li>
          <li>Each QR code admits its holder once per entry window. Screenshots shared with others will not work.</li>
          <li>
            Everyone entering is subject to security checks. Alcohol, drugs, weapons, fireworks and other dangerous
            items are strictly prohibited.
          </li>
          <li>
            You must follow the instructions of volunteers, security staff and institute authorities, and the code of
            conduct of {FEST.collegeFull}.
          </li>
          <li>
            Misconduct, harassment, damage to property or any breach of these rules will lead to removal from the venue
            and cancellation of your pass without refund.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="5. Right of admission reserved">
        <p>
          The right of admission is reserved. The organisers and institute authorities may refuse entry to, or remove,
          anyone for reasons of safety, security, crowd control or conduct. Entry to any area is subject to capacity.
        </p>
      </PolicySection>

      <PolicySection title="6. Competitions">
        <p>
          Each competition has its own rules, published on its event page. The judges’ decision is final. We may change
          the format, schedule or venue of an event, or merge or cancel events, when needed.
        </p>
      </PolicySection>

      <PolicySection title="7. Changes to the programme">
        <p>
          Line-ups, artists, timings and venues may change for reasons beyond our control. A change of artist or
          schedule does not entitle you to a refund. If the whole festival is cancelled, the{" "}
          <Link href="/refund-policy" className="t-link text-bone">Refund &amp; Cancellation Policy</Link> applies.
        </p>
      </PolicySection>

      <PolicySection title="8. Photography">
        <p>
          The festival is photographed and filmed. By attending, you agree that you may appear in photos and videos that
          we publish to promote TARANG.
        </p>
      </PolicySection>

      <PolicySection title="9. Liability">
        <p>
          You attend at your own risk. To the extent allowed by law, we are not responsible for loss of or damage to
          personal belongings, or for any indirect loss. Our total liability for any purchase is limited to the amount
          you paid for it.
        </p>
      </PolicySection>

      <PolicySection title="10. Governing law">
        <p>
          These terms are governed by the laws of India. Any dispute is subject to the exclusive jurisdiction of the
          courts at Patna, Bihar.
        </p>
      </PolicySection>

      <PolicySection title="11. Contact">
        <p>
          Questions about these terms? Write to <SupportEmail /> or see the{" "}
          <Link href="/contact" className="t-link text-bone">Contact Us</Link> page.
        </p>
      </PolicySection>
    </LegalPage>
  );
}
