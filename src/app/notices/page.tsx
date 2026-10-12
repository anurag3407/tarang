import type { Metadata } from "next";
import { PageHeader } from "@/components/ui/PageHeader";
import { Marquee } from "@/components/ui/Marquee";
import { NoticeCard } from "@/components/cards/NoticeCard";
import { loadPublicContent } from "@/lib/content-loader";

// Mutable DB-backed content served through unstable_cache (plan §10.6).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Notices",
  description:
    "Official notices from the PULSE 2026 organizing committee — registrations, deadlines, venue changes and updates.",
};

export default async function NoticesPage() {
  const { notices } = await loadPublicContent();

  return (
    <>
      <PageHeader
        kicker="Official notice board"
        title="All"
        accent="notices"
        description="Everything the organizing committee publishes officially lands here. Check back before every event."
      />
      <section className="bg-neo-cream">
        <div className="mx-auto max-w-5xl px-4 py-16 sm:px-6 md:py-20">
          {notices.length === 0 ? (
            <div className="border-4 border-black bg-white p-12 text-center shadow-neo">
              <p className="text-3xl font-black uppercase tracking-tighter">
                No notices yet
              </p>
              <p className="mt-2 text-lg font-bold">
                Official announcements will appear here as they are published.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {notices.map((notice) => (
                <NoticeCard key={notice.id} notice={notice} />
              ))}
            </div>
          )}

          <div className="mt-12 border-8 border-black bg-black p-8 text-center text-white shadow-neo-lg">
            <p className="text-2xl font-black uppercase tracking-tighter text-neo-secondary">
              Missed a notice?
            </p>
            <p className="mx-auto mt-2 max-w-lg text-lg font-bold leading-snug">
              Notices are also announced on the main stage before every pro
              show and posted at the help desk near the Student Centre.
            </p>
          </div>
        </div>
      </section>
      <Marquee
        items={[
          "Check before every event",
          "Notices are final",
          "Help desk: Student Centre",
        ]}
        variant="accent"
      />
    </>
  );
}
