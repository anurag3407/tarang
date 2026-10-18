import type { Metadata } from "next";
import Link from "next/link";
import { LegalPage, ORGANISER, PolicySection } from "@/components/layout/LegalPage";
import { FEST, HAS_CONTACT } from "@/lib/data";

export const metadata: Metadata = {
  title: "Contact Us",
  description: `Contact the TARANG ${FEST.year} organising committee — support email, phone and address at ${FEST.collegeFull}.`,
};

export default function ContactPage() {
  return (
    <LegalPage
      kicker="Get in touch"
      title="Contact"
      accent="Us"
      description="For help with passes, payments, refunds, registrations or anything else about the festival."
    >
      <PolicySection title="Support">
        <dl className="grid gap-6 sm:grid-cols-2">
          {FEST.email && (
            <div>
              <dt className="t-label text-bone/45">Email</dt>
              <dd className="mt-2 text-lg">
                <a href={`mailto:${FEST.email}`} className="t-link text-bone hover:text-signal">
                  {FEST.email}
                </a>
              </dd>
            </div>
          )}
          {FEST.phones.length > 0 && (
            <div>
              <dt className="t-label text-bone/45">Phone</dt>
              {FEST.phones.map((phone) => (
                <dd key={phone} className="mt-2 text-lg">
                  <a href={`tel:${phone.replace(/\s+/g, "")}`} className="t-link text-bone hover:text-signal">
                    {phone}
                  </a>
                </dd>
              ))}
            </div>
          )}
          <div>
            <dt className="t-label text-bone/45">Help desk</dt>
            <dd className="mt-2 text-lg">
              <Link href="/ask" className="t-link text-bone hover:text-signal">
                Ask a question online
              </Link>
            </dd>
          </div>
        </dl>
        {!HAS_CONTACT && (
          <p className="text-bone/55">
            We will publish our support email and phone numbers here soon. Until then, the online help desk is the
            fastest way to reach us.
          </p>
        )}
        <p>We reply within 24–48 hours, Monday to Saturday, 10 AM – 6 PM IST, and every day during the fest week.</p>
      </PolicySection>

      <PolicySection title="Address">
        <address className="not-italic">
          {ORGANISER.replace(/^the /, "The ")}
          <br />
          {FEST.venue}
          <br />
          India
        </address>
        <p>
          <a href={FEST.mapsUrl} target="_blank" rel="noopener noreferrer" className="t-link text-bone hover:text-signal">
            Open in Google Maps ↗
          </a>
          {" · "}
          <Link href="/reach" className="t-link text-bone hover:text-signal">
            How to reach
          </Link>
        </p>
      </PolicySection>

      <PolicySection title="Payments and refunds">
        <p>
          For a payment problem, include your order code and the Razorpay payment ID in your message so we can trace it
          quickly. See our <Link href="/refund-policy" className="t-link text-bone">Refund &amp; Cancellation Policy</Link>{" "}
          for timelines.
        </p>
      </PolicySection>
    </LegalPage>
  );
}
