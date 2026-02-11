export function svgAvatar(seed: string) {
  // Deterministic but visually varied avatar (palette + pattern + initials).
  const hash32 = (s: string) => Array.from(s).reduce((a, c) => (a * 16777619) ^ c.charCodeAt(0), 2166136261) >>> 0;
  let x = hash32(seed) || 1;
  const rnd = () => {
    // xorshift32
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rnd() * arr.length)]!;

  const initials = seed
    .replace(/https?:\/\/\S+/g, "")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((t) => (t[0] ? t[0].toUpperCase() : ""))
    .join("")
    .slice(0, 2) || "A";

  const palettes = [
    ["#06b6d4", "#3b82f6", "#6366f1"], // cyan/blue/indigo
    ["#22c55e", "#16a34a", "#84cc16"], // green/lime
    ["#f97316", "#ef4444", "#fb7185"], // orange/red/pink
    ["#a855f7", "#ec4899", "#8b5cf6"], // purple/pink
    ["#f59e0b", "#eab308", "#14b8a6"], // amber/yellow/teal
    ["#0ea5e9", "#38bdf8", "#22c55e"], // sky/green
    ["#111827", "#334155", "#0f172a"], // dark slate (rare)
    ["#f43f5e", "#fb7185", "#f97316"] // rose/orange
  ] as const;

  const palette = pick(palettes);
  const c1 = pick(palette);
  const c2 = pick(palette);
  const c3 = pick(palette);

  const angle = Math.floor(rnd() * 360);
  const pattern = Math.floor(rnd() * 4);

  const blobs =
    pattern === 0
      ? [
          `<circle cx="${10 + Math.floor(rnd() * 18)}" cy="${14 + Math.floor(rnd() * 20)}" r="${18 + Math.floor(rnd() * 14)}" fill="${c3}" opacity="0.35"/>`,
          `<circle cx="${34 + Math.floor(rnd() * 22)}" cy="${34 + Math.floor(rnd() * 22)}" r="${16 + Math.floor(rnd() * 18)}" fill="#ffffff" opacity="0.10"/>`
        ]
      : pattern === 1
        ? [
            `<path d="M${-10} ${20 + Math.floor(rnd() * 20)} C ${10} ${10} ${20} ${70} ${70} ${40 + Math.floor(rnd() * 10)} L 70 70 L -10 70 Z" fill="${c3}" opacity="0.25"/>`,
            `<path d="M${-10} ${42 + Math.floor(rnd() * 10)} C ${18} ${16} ${30} ${78} ${74} ${44} L 74 74 L -10 74 Z" fill="#ffffff" opacity="0.08"/>`
          ]
        : pattern === 2
          ? [
              `<rect x="${-8}" y="${-8}" width="80" height="80" fill="none"/>`,
              `<g opacity="0.16">` +
                Array.from({ length: 6 })
                  .map((_v, i) => {
                    const y = 10 + i * 9 + Math.floor(rnd() * 3);
                    return `<rect x="${-4 + Math.floor(rnd() * 6)}" y="${y}" width="${72 - Math.floor(rnd() * 12)}" height="5" rx="2.5" fill="${pick([c1, c2, c3])}"/>`;
                  })
                  .join("") +
                `</g>`
            ]
          : [
              `<g opacity="0.20">` +
                Array.from({ length: 9 })
                  .map(() => {
                    const cx = Math.floor(rnd() * 64);
                    const cy = Math.floor(rnd() * 64);
                    const r = 2 + Math.floor(rnd() * 6);
                    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${pick([c1, c2, c3, "#ffffff"])}" />`;
                  })
                  .join("") +
                `</g>`
            ];

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64" role="img" aria-label="avatar">`,
    `<defs>`,
    `<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="64" y2="64" gradientTransform="rotate(${angle} 32 32)">`,
    `<stop offset="0" stop-color="${c1}"/><stop offset="0.55" stop-color="${c2}"/><stop offset="1" stop-color="${c3}"/>`,
    `</linearGradient>`,
    `</defs>`,
    `<rect width="64" height="64" rx="14" fill="url(#g)"/>`,
    ...blobs,
    `<rect width="64" height="64" rx="14" fill="#0b1220" opacity="${0.04 + rnd() * 0.06}"/>`,
    `<text x="32" y="39" text-anchor="middle" font-family="ui-sans-serif,system-ui" font-size="22" font-weight="800" fill="white">`,
    `${initials}`,
    `</text>`,
    `</svg>`
  ].join("");
}
