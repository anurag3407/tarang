import Hero from "@/components/home/Hero";
import CategoriesSection from "@/components/home/CategoriesSection";
import FeaturedEvents from "@/components/home/FeaturedEvents";
import FlowSection from "@/components/home/FlowSection";
import ProShowsSection from "@/components/home/ProShowsSection";
import NoticesPreview from "@/components/home/NoticesPreview";
// import VerifySection from "@/components/home/VerifySection";
import { Marquee } from "@/components/ui/Marquee";
import { FEST } from "@/lib/data";

// DB-backed sections (events/notices/categories) are mutable content served
// through unstable_cache; render dynamically so cache revalidation never
// collides with static-page rules. Cloudflare caches the HTML at the edge.
export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <>
      <Marquee
        items={[
          `${FEST.name} ${FEST.year}`,
          FEST.dates,
          "AIIMS New Delhi",
          "250+ Events",
          "5 Pro Shows",
          "Registrations Open",
        ]}
        variant="black"
        fast
      />
      <Hero />
      <Marquee
        items={[
          "Socio cultural",
          "aQuSiS",
          "Workshop",
          "Fine Arts",
          "Literary",
          "Sports",
          "Scientific society",
          "Informal",
        ]}
        variant="secondary"
      />
      <CategoriesSection />
      <FeaturedEvents />
      <FlowSection />
      <ProShowsSection />
      <Marquee
        items={[
          "Feel The Beat",
          "Live The Pulse",
          FEST.datesShort,
          "See You There",
        ]}
        variant="accent"
      />
      <NoticesPreview />
      {/* <VerifySection /> */}
    </>
  );
}
