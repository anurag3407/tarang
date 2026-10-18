import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, ORGANISER, PolicySection, SupportEmail } from "@/components/layout/LegalPage";
import { FEST } from "@/lib/data";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: `How TARANG ${FEST.year} collects, stores and protects your name, email address, phone number and payment details.`,
};

export default function PrivacyPage() {
  return (
    <LegalPage
      title="Privacy"
      accent="Policy"
      description="What we collect when you use this website, why we collect it, and how we keep it safe."
    >
      <PolicySection title="1. Who we are">
        <p>
          This website is operated by {ORGANISER}. This policy explains how we handle your personal information when
          you create an account, buy a pass, register for an event, order merchandise or contact us.
        </p>
      </PolicySection>

      <PolicySection title="2. What we collect">
        <ul>
          <li>
            <strong className="text-bone">Account details:</strong> your name, email address, phone number and college.
          </li>
          <li>
            <strong className="text-bone">Orders:</strong> the passes, event registrations and merchandise you buy,
            your team members’ names for team events, and payment status and reference numbers.
          </li>
          <li>
            <strong className="text-bone">Entry records:</strong> when your pass QR code is scanned at the gate.
          </li>
          <li>
            <strong className="text-bone">Messages:</strong> anything you send us through the help desk or forms.
          </li>
          <li>
            <strong className="text-bone">Technical data:</strong> your IP address, browser type and error logs, used
            for security, fraud and abuse prevention.
          </li>
        </ul>
      </PolicySection>

      <PolicySection title="3. Payment details">
        <p>
          All payments are processed by Razorpay. Your card, UPI and net-banking details are entered on Razorpay’s
          secure checkout and are never stored on our servers. We only receive the payment status and a transaction
          reference from Razorpay.
        </p>
      </PolicySection>

      <PolicySection title="4. How we use it">
        <ul>
          <li>To issue your passes and registrations and to email them to you.</li>
          <li>To verify your identity and pass at the gate.</li>
          <li>To send you messages about your orders and important festival updates.</li>
          <li>To answer your questions and handle refunds.</li>
          <li>To prevent fraud, ticket duplication and misuse of the website.</li>
        </ul>
        <p>We do not sell or rent your personal information to anyone, and we do not use it for third-party advertising.</p>
      </PolicySection>

      <PolicySection title="5. How we store and protect it">
        <ul>
          <li>Your data is stored in a secured database that only authorised organising-committee members can access.</li>
          <li>All traffic to this website is encrypted with HTTPS.</li>
          <li>Pass QR codes are digitally signed so that they cannot be forged.</li>
          <li>Staff access is role-based and logged.</li>
        </ul>
      </PolicySection>

      <PolicySection title="6. Who we share it with">
        <p>We share data only with the service providers we need to run the festival:</p>
        <ul>
          <li>Razorpay, to process payments and refunds.</li>
          <li>Our hosting, database and email-delivery providers, to run the website and send your confirmations.</li>
          <li>Security and error-monitoring services, to keep the website safe and working.</li>
          <li>Institute or law-enforcement authorities, when the law requires it.</li>
        </ul>
      </PolicySection>

      <PolicySection title="7. Cookies">
        <p>
          We use essential cookies to keep you signed in and to protect forms against misuse. We do not use advertising
          cookies.
        </p>
      </PolicySection>

      <PolicySection title="8. How long we keep it">
        <p>
          We keep your account and order records for as long as needed to run the festival, handle refunds and meet
          our legal and accounting obligations. After that, they are deleted or anonymised.
        </p>
      </PolicySection>

      <PolicySection title="9. Your rights">
        <p>
          You can ask us to see, correct or delete your personal information. Write to <SupportEmail /> from the email
          address on your account. We may need to keep some records, such as payment records, where the law requires
          it.
        </p>
      </PolicySection>

      <PolicySection title="10. Changes">
        <p>
          We may update this policy. The date at the top of this page shows when it last changed. For any questions,
          see the <Link href="/contact" className="t-link text-bone">Contact Us</Link> page.
        </p>
      </PolicySection>
    </LegalPage>
  );
}
