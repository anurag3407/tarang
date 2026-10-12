import { Megaphone, Pin } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import type { NoticeRead } from "@/domain/content";

const TAG_VARIANT: Record<NoticeRead["tag"], "accent" | "secondary" | "muted" | "black"> = {
  URGENT: "accent",
  UPDATE: "muted",
  INFO: "secondary",
  REGISTRATION: "black",
};

export function NoticeCard({ notice }: { notice: NoticeRead }) {
  return (
    <article className="flex gap-4 border-4 border-black bg-white dark:bg-[#121214] text-black dark:text-white p-5 shadow-neo transition-all duration-200 hover:-translate-y-1 hover:shadow-neo-lg">
      <div className="flex h-14 w-14 shrink-0 items-center justify-center border-4 border-black bg-neo-secondary text-black shadow-neo-sm">
        <Megaphone className="h-7 w-7 text-black" strokeWidth={3} />
      </div>
      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <Badge variant={TAG_VARIANT[notice.tag]}>{notice.tag}</Badge>
          <span className="text-xs font-black uppercase tracking-widest text-black/70 dark:text-zinc-400">
            {notice.dateLabel}
          </span>
          {notice.pinned && (
            <Badge variant="accent">
              <Pin className="h-3 w-3" strokeWidth={3} /> Pinned
            </Badge>
          )}
        </div>
        <h3 className="text-xl font-black uppercase leading-tight tracking-tight text-black dark:text-white">
          {notice.title}
        </h3>
        <p className="mt-2 whitespace-pre-line text-base font-bold leading-snug text-black/80 dark:text-zinc-300">
          {notice.bodyMarkdown}
        </p>
      </div>
    </article>
  );
}
