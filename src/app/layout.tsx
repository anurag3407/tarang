import type { Metadata } from "next";
import Script from "next/script";
import localFont from "next/font/local";
import { Yatra_One, Inter_Tight, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { FestivalEventJsonLd, OrganizationJsonLd } from "@/components/seo/JsonLd";

const baseUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.PUBLIC_SITE_URL ||
  process.env.APP_BASE_URL ||
  "http://localhost:3000";

// Noot — the face the poster lettering is set in (see src/fonts/README.md).
const display = localFont({
  src: "../fonts/Noot-Regular.ttf",
  variable: "--nf-display",
  display: "swap",
  weight: "400",
  // No metric fallback: missing glyphs (₹, curly quotes) should drop to the body face,
  // which `--font-display` lists next.
  adjustFontFallback: false,
  fallback: [],
});

// Devanagari accents (तरंग) on the landing page.
const deva = Yatra_One({
  subsets: ["devanagari"],
  weight: "400",
  variable: "--nf-deva",
  display: "swap",
});

const body = Inter_Tight({
  subsets: ["latin"],
  variable: "--nf-body",
  display: "swap",
});

const mono = Geist_Mono({
  subsets: ["latin"],
  variable: "--nf-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL(baseUrl),
  title: {
    default: "Tarang ’26 — Mute the Mundane | NIT Patna",
    template: "%s | Tarang ’26",
  },
  description:
    "Tarang ’26 is the cultural festival of NIT Patna — five pronites, every kind of competition and five days on the banks of the Ganga. 17–21 September 2026.",
  keywords: [
    "TARANG",
    "TARANG 2026",
    "Tarang 26",
    "Tarang NIT Patna",
    "NIT Patna fest",
    "NIT Patna cultural fest",
    "Patna college fest",
    "Bihar college fest",
    "TARANG pronite pass",
    "pronites Patna",
    "Mute the Mundane",
  ],
  alternates: {
    canonical: "./",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  icons: {
    icon: [
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    shortcut: "/favicon-32x32.png",
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: baseUrl,
    siteName: "Tarang ’26 — NIT Patna",
    title: "Tarang ’26 — Mute the Mundane | NIT Patna",
    description:
      "The cultural festival of NIT Patna — five pronites and five days of music, dance, theatre and competitions on the banks of the Ganga. 17–21 September 2026.",
    images: [
      {
        url: "/tarang/og.jpg",
        width: 1200,
        height: 630,
        alt: "Tarang ’26",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Tarang ’26 — Mute the Mundane | NIT Patna",
    description: "The cultural festival of NIT Patna. Five pronites, one pass. 17–21 September 2026.",
    images: ["/tarang/og.jpg"],
  },
  verification: {
    google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION || undefined,
  },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className={`dark ${display.variable} ${deva.variable} ${body.variable} ${mono.variable} h-full`}>
      <head>
        <FestivalEventJsonLd baseUrl={baseUrl} />
        <OrganizationJsonLd baseUrl={baseUrl} />
        <Script
          src="https://checkout.razorpay.com/v1/checkout.js"
          strategy="afterInteractive"
          id="razorpay-sdk"
        />
      </head>
      <body className="t-grain min-h-full flex flex-col antialiased">
        <ThemeProvider>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </ThemeProvider>
      </body>
    </html>
  );
}

