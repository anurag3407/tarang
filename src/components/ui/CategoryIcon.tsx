import {
  Music,
  Drama,
  Megaphone,
  Palette,
  Brain,
  Dumbbell,
  Stethoscope,
  Gamepad2,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  Music,
  Drama,
  Megaphone,
  Palette,
  Brain,
  Dumbbell,
  Stethoscope,
  Gamepad2,
};

export function CategoryIcon({
  name,
  className = "h-8 w-8",
}: {
  name: string;
  className?: string;
}) {
  const Icon = ICONS[name] ?? Music;
  return <Icon className={className} strokeWidth={3} aria-hidden />;
}
