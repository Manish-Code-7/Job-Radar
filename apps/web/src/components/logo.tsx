export function Logo({ className = "size-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--primary)" />
      <circle cx="16" cy="16" r="9" fill="none" stroke="var(--primary-foreground)" strokeOpacity="0.45" strokeWidth="2" />
      <circle cx="16" cy="16" r="4.5" fill="none" stroke="var(--primary-foreground)" strokeWidth="2" />
      <path d="M16 16 23.5 8.5" stroke="var(--primary-foreground)" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="16" cy="16" r="1.8" fill="var(--primary-foreground)" />
    </svg>
  );
}

/** Deterministic company monogram (no external logos, no tracking). */
export function Monogram({ name, className = "size-11 text-base" }: { name: string; className?: string }) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) % 360;
  const letters = name.replace(/[^A-Za-z0-9 ]/g, "").split(" ").filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
  return (
    <span aria-hidden="true" className={`grid shrink-0 place-items-center rounded-lg font-semibold ${className}`} style={{ background: `oklch(0.93 0.05 ${h})`, color: `oklch(0.38 0.1 ${h})` }}>
      {letters}
    </span>
  );
}
