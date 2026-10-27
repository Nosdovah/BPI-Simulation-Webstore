function hash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) h = (h * 33 + input.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function initials(name: string): string {
  const clean = name.replace(/^Octarine\s*[—-]\s*/i, "");
  const words = clean.split(/[\s+]+/).filter(Boolean);
  return words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

export function ProductImage({
  imageKey,
  name,
  isBundle = false,
  className = "",
  size = "md",
}: {
  imageKey: string;
  name: string;
  isBundle?: boolean;
  className?: string;
  size?: "sm" | "md" | "lg";
}) {
  const h = hash(imageKey);
  const hue = 188 + (h % 96); // 188..284 — biru laut sampai ungu, seperti hero situs asli
  const hue2 = (hue + 28) % 360;
  const bg = `linear-gradient(160deg, hsl(${hue} 38% 92%) 0%, hsl(${hue2} 32% 76%) 100%)`;
  const capHue = (hue2 + 200) % 360;

  const bottleScale = size === "lg" ? 1.18 : size === "sm" ? 0.78 : 1;

  return (
    <div
      className={`bottle-shell relative flex items-center justify-center overflow-hidden ${className}`}
      style={{ background: bg }}
      aria-label={name}
      role="img"
    >
      <div
        className="relative flex flex-col items-center"
        style={{ transform: `scale(${bottleScale})` }}
      >
        <div
          className="bottle-cap h-3 w-6 rounded-[2px]"
          style={{ background: `hsl(${capHue} 45% 18%)` }}
        />
        <div
          className="mt-[2px] h-2 w-3"
          style={{ background: `hsl(${capHue} 20% 88%)` }}
        />
        <div
          className="flex h-[86px] w-[46px] flex-col items-center justify-center rounded-[6px] border border-white/50"
          style={{
            background:
              "linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.52) 60%, rgba(255,255,255,0.7) 100%)",
            boxShadow: "inset 0 0 12px rgba(0,0,0,0.08), 0 6px 18px rgba(0,0,0,0.10)",
          }}
        >
          <span className="font-display text-[15px] leading-none text-ink/80">
            {initials(name)}
          </span>
          <span className="mt-1 text-[5px] uppercase tracking-[0.18em] text-ink/45">
            Octarine
          </span>
        </div>
      </div>

      {isBundle && (
        <span className="absolute left-2 top-2 border border-white/70 bg-white/80 px-1.5 py-0.5 text-[8px] uppercase tracking-widest2 text-ink">
          Bundle
        </span>
      )}
    </div>
  );
}