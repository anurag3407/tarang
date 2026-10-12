import { ArrowRight } from "lucide-react";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ButtonLink } from "@/components/ui/Button";
import { NoticeCard } from "@/components/cards/NoticeCard";
import { loadPublicContent } from "@/lib/content-loader";

export default async function NoticesPreview() {
  const { notices } = await loadPublicContent();
  const latest = notices.slice(0, 4);

  if (latest.length === 0) return null;

  return (
    <section className="bg-neo-cream">
      <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6 md:py-28">
        <div className="flex flex-col justify-between gap-6 md:flex-row md:items-end">
          <SectionHeading
            kicker="Notice board"
            title="Latest"
            accent="notices"
            description="Registrations, venue changes and deadlines — everything official lands here first."
          />
          <div className="mb-12 shrink-0 md:mb-16">
            <ButtonLink href="/notices" variant="secondary">
              All notices <ArrowRight className="h-5 w-5" strokeWidth={3} />
            </ButtonLink>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {latest.map((notice) => (
            <NoticeCard key={notice.id} notice={notice} />
          ))}
        </div>
      </div>
    </section>
  );
}
