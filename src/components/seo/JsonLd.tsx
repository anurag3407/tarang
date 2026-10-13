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
    "name": `${FEST.name} ${FEST.year} — ${FEST.college} Cultural Fest`,
    "alternateName": ["TARANG NIT Patna", "Tarang 2026", "Tarang ’26"],
    "description": `TARANG is the cultural festival of ${FEST.collegeFull} — two pronites and two days of music, dance, theatre and competitions. ${FEST.tagline}`,
    "startDate": "2026-11-21T09:00:00+05:30",
    "endDate": "2026-11-22T23:59:59+05:30",
    "eventStatus": "https://schema.org/EventScheduled",
    "eventAttendanceMode": "https://schema.org/OfflineEventAttendanceMode",
    "location": {
      "@type": "Place",
      "name": FEST.collegeFull,
      "address": {
        "@type": "PostalAddress",
        "streetAddress": "Ashok Rajpath, Mahendru",
        "addressLocality": "Patna",
        "addressRegion": "Bihar",
        "postalCode": "800005",
        "addressCountry": "IN"
      },
      "geo": {
        "@type": "GeoCoordinates",
        "latitude": FEST.geo.lat,
        "longitude": FEST.geo.lng
      }
    },
    "image": [
      `${baseUrl}/tarang/og.jpg`,
      `${baseUrl}/icon-512.png`
    ],
    "organizer": {
      "@type": "Organization",
      "name": `${FEST.name} — ${FEST.collegeFull}`,
      "url": baseUrl,
      ...(FEST.email && { "email": FEST.email }),
      ...(FEST.phone && { "telephone": FEST.phone })
    },
    "offers": [
      {
        "@type": "Offer",
        "name": "Pronite Pass (all pronites, campus access, competitions)",
        "url": `${baseUrl}/pronite-pass`,
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
    "name": `${FEST.name} — ${FEST.collegeFull}`,
    "url": baseUrl,
    "logo": `${baseUrl}/icon-512.png`,
    ...(FEST.instagram && { "sameAs": [FEST.instagram] }),
    ...((FEST.email || FEST.phone) && {
      "contactPoint": {
        "@type": "ContactPoint",
        ...(FEST.phone && { "telephone": FEST.phone }),
        ...(FEST.email && { "email": FEST.email }),
        "contactType": "customer service",
        "areaServed": "IN",
        "availableLanguage": ["English", "Hindi"]
      }
    }),
    "address": {
      "@type": "PostalAddress",
      "streetAddress": "Ashok Rajpath, Mahendru",
      "addressLocality": "Patna",
      "addressRegion": "Bihar",
      "postalCode": "800005",
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
