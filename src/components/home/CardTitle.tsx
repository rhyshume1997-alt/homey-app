import { GlassIcon, type IconName, type Tint } from "@/components/ui/GlassIcon";

/** Card heading with its area's glass icon. The icon is decorative; the text names the card. */
export function CardTitle({ icon, tint, children }: { icon: IconName; tint: Tint; children: string }) {
  return (
    <h2 className="flex items-center gap-2.5 text-base font-semibold">
      <GlassIcon name={icon} tint={tint} size="sm" />
      {children}
    </h2>
  );
}
