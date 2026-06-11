import { rankLabel, suitLabel, isRed, type Card } from "@/lib/game/types";

interface PlayingCardProps {
  card: Card | null | "hidden";
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  selected?: boolean;
  highlight?: boolean;
  disabled?: boolean;
  label?: string;
}

const sizes = {
  sm: "w-10 h-14 text-sm",
  md: "w-14 h-20 text-base",
  lg: "w-20 h-28 text-xl",
};

export function PlayingCard({
  card,
  size = "md",
  onClick,
  selected,
  highlight,
  disabled,
  label,
}: PlayingCardProps) {
  const sz = sizes[size];
  const base = `card-base ${sz} flex flex-col items-center justify-center font-bold relative`;
  const ringCls = selected
    ? "ring-2 ring-accent ring-offset-2 ring-offset-felt"
    : highlight
      ? "ring-2 ring-primary"
      : "";
  const clickable = onClick && !disabled ? "cursor-pointer" : "cursor-default";

  let inner;
  if (card === null) {
    inner = (
      <div className={`card-base card-empty ${sz} ${clickable} ${ringCls}`} onClick={onClick}>
        {label && (
          <span className="text-[10px] text-muted-foreground uppercase tracking-wider">
            {label}
          </span>
        )}
      </div>
    );
  } else if (card === "hidden") {
    inner = (
      <div className={`${base} card-back ${clickable} ${ringCls}`} onClick={onClick}>
        {label && (
          <span className="absolute bottom-1 text-[9px] text-accent uppercase">{label}</span>
        )}
      </div>
    );
  } else {
    const r = rankLabel(card);
    const s = suitLabel(card);
    const colorCls = isRed(card) ? "suit-red" : "suit-black";
    inner = (
      <div className={`${base} card-face ${colorCls} ${clickable} ${ringCls}`} onClick={onClick}>
        <span className="absolute top-1 left-1.5 text-xs leading-none">{r}</span>
        <span className="absolute top-3.5 left-1.5 text-xs leading-none">{s}</span>
        <span className="text-2xl">{s}</span>
        <span className="absolute bottom-1 right-1.5 text-xs leading-none rotate-180">{r}</span>
        <span className="absolute bottom-3.5 right-1.5 text-xs leading-none rotate-180">{s}</span>
        {label && (
          <span className="absolute -bottom-5 text-[10px] text-muted-foreground uppercase tracking-wider">
            {label}
          </span>
        )}
      </div>
    );
  }
  return inner;
}
