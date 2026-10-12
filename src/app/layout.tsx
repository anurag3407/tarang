import type { Metadata } from "next";
import Script from "next/script";
import { Bungee, Yatra_One, Inter_Tight, Geist_Mono } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/layout/Navbar";
import Footer from "@/components/layout/Footer";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import { FestivalEventJsonLd, OrganizationJsonLd } from "@/components/seo/JsonLd";

const baseUrl =
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.PUBLIC_SITE_URL ||
  process.env.APP_BASE_URL ||
  "https://pulseasa.org";

// Blocky cut-out display face — closest match to the poster lettering.
const display = Bungee({
  subsets: ["latin"],
  weight: "400",
  variable: "--nf-display",
  display: "swap",
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
    default: "Tarang ’26 — Annual Cultural Fest | AIIMS New Delhi",
    template: "%s | Tarang ’26",
  },
  description:
    "Tarang ’26 is South Asia's largest medical college cultural, literary, and sports fest at AIIMS New Delhi. Five days of star pro shows, 250+ events, and campus glory from 17–21 September 2026.",
  keywords: [
    "TARANG",
    "TARANG 2026",
    "Tarang 26",
    "AIIMS Delhi",
    "AIIMS Tarang 2026",
    "AIIMS cultural fest",
    "college fest New Delhi",
    "medical college fest",
    "TARANG delegate card",
    "TARANG BR card",
    "pro shows AIIMS",
    "AIIMS Student Association",
    "Delhi collegiate fest",
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
    siteName: "Tarang ’26 — AIIMS New Delhi",
    title: "Tarang ’26 — Annual Cultural Fest | AIIMS New Delhi",
    description:
      "South Asia's largest medical college cultural, literary, and sports festival — five days of pro shows, 250+ competitions, and 10k+ footfall at AIIMS New Delhi. 17–21 September 2026.",
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
    title: "Tarang ’26 — Annual Cultural Fest | AIIMS New Delhi",
    description:
      "South Asia's largest medical college cultural, literary, and sports fest at AIIMS New Delhi. 17–21 September 2026.",
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

