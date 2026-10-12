import { FEST, FAQS } from "@/lib/data";

interface JsonLdProps {
  data: Record<string, unknown>;
}

export function JsonLd({ data }: JsonLdProps) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

export function FestivalEventJsonLd({ baseUrl }: { baseUrl: string }) {
  const eventSchema = {
    "@context": "https://schema.org",
    "@type": "Festival",
    "name": `${FEST.name} ${FEST.year} — AIIMS New Delhi Cultural Fest`,
    "alternateName": ["TARANG AIIMS", "AIIMS Tarang 2026", "Tarang Festival AIIMS Delhi"],
    "description": "TARANG is the annual cultural, literary, and sports fest of AIIMS New Delhi — South Asia's largest medical college festival featuring 250+ events and 5 star pro shows.",
    "startDate": "2026-09-17T09:00:00+05:30",
    "endDate": "2026-09-21T23:59:59+05:30",
    "eventStatus": "https://schema.org/EventScheduled",
    "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
    "location": {
      "@type": "Place",
      "name": "AIIMS Quadrangle & Campus",
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "Sri Aurobindo Marg, Ansari Nagar",
        "addressLocality": "New Delhi",
        "addressRegion": "Delhi",
        "postalCode": "110029",
        "addressCountry": "IN"
      },
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": 28.5672,
        "longitude": 77.2100
      }
    },
    "image": [
      `${baseUrl}/pulse-logo.png`,
      `${baseUrl}/apple-icon.png`
    ],
    "organizer": {
      "@type": "Organization",
      "name": "AIIMS Student Association (ASA)",
      "url": baseUrl,
      "email": FEST.email,
      "telephone": FEST.phone
    },
    "offers": [
      {
        "@type": "Offer",
        "name": "Delegate Card (Prime Pro Nights + All Events)",
        "url": `${baseUrl}/delegate-card`,
        "priceCurrency": "INR",
        "availability": "https://schema.org/InStock",
        "validFrom": "2026-01-01T00:00:00+05:30"
      },
      {
        "@type": "Offer",
        "name": "BR Card (Basic Registration + Campus Entry)",
        "url": `${baseUrl}/basic-card`,
        "priceCurrency": "INR",
        "availability": "https://schema.org/InStock",
        "validFrom": "2026-01-01T00:00:00+05:30"
      }
    ]
  };

  return <JsonLd data={eventSchema} />;
}

export function OrganizationJsonLd({ baseUrl }: { baseUrl: string }) {
  const orgSchema = {
    "@context": "https://schema.org",
    "@type": "EducationalOrganization",
    "name": "AIIMS Student Association (ASA) — TARANG",
    "url": baseUrl,
    "logo": `${baseUrl}/pulse-logo.png`,
    "sameAs": [
      FEST.instagram
    ],
    "contactPoint": {
      "@type": "ContactPoint",
      "telephone": FEST.phone,
      "contactType": "customer service",
      "email": FEST.email,
      "areaServed": "IN",
      "availableLanguage": ["English", "Hindi"]
    },
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "All India Institute of Medical Sciences, Ansari Nagar",
      "addressLocality": "New Delhi",
      "addressRegion": "Delhi",
      "postalCode": "110029",
      "addressCountry": "IN"
    }
  };

  return <JsonLd data={orgSchema} />;
}

export function FaqJsonLd() {
  const faqSchema = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    "mainEntity": FAQS.map((faq) => ({
      "@type": "Question",
      "name": faq.q,
      "acceptedAnswer": {
        "@type": "Answer",
        "text": faq.a
      }
    }))
  };

  return <JsonLd data={faqSchema} />;
}
