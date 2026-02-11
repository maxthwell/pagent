// Seed demo data:
// - Ensure projects: 东湖村, 南铁牛庙
// - Create 3 groups per project
// - Ensure 东湖村 has 100 agents (already expected), 南铁牛庙 has 72 agents
// - Randomly assign agents to groups (东湖村 groups include some 南铁牛庙 agents to demonstrate cross-project membership)
//
// Usage:
//   source .env && node scripts/seed_dhc_ntm.mjs

import { prisma } from "../packages/db/dist/index.js";

function hash32(s) {
  return Array.from(String(s)).reduce((a, c) => (a * 16777619) ^ c.charCodeAt(0), 2166136261) >>> 0;
}

function makeRng(seed) {
  let x = hash32(seed) || 1;
  return () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
}

function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function pickN(arr, n, rnd) {
  const a = arr.slice();
  shuffle(a, rnd);
  return a.slice(0, n);
}

function slugify(s) {
  return String(s)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "")
    .slice(0, 40) || "agent";
}

function svgAvatar(seed) {
  let x = hash32(seed) || 1;
  const rnd = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) / 0xffffffff;
  };
  const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

  const initials =
    seed
      .replace(/https?:\/\/\S+/g, "")
      .split(/[\s_-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((t) => (t[0] ? t[0].toUpperCase() : ""))
      .join("")
      .slice(0, 2) || "A";

  const palettes = [
    ["#06b6d4", "#3b82f6", "#6366f1"],
    ["#22c55e", "#16a34a", "#84cc16"],
    ["#f97316", "#ef4444", "#fb7185"],
    ["#a855f7", "#ec4899", "#8b5cf6"],
    ["#f59e0b", "#eab308", "#14b8a6"],
    ["#0ea5e9", "#38bdf8", "#22c55e"],
    ["#111827", "#334155", "#0f172a"],
    ["#f43f5e", "#fb7185", "#f97316"]
  ];

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
            `<path d="M-10 ${20 + Math.floor(rnd() * 20)} C 10 10 20 70 70 ${40 + Math.floor(rnd() * 10)} L 70 70 L -10 70 Z" fill="${c3}" opacity="0.25"/>`,
            `<path d="M-10 ${42 + Math.floor(rnd() * 10)} C 18 16 30 78 74 44 L 74 74 L -10 74 Z" fill="#ffffff" opacity="0.08"/>`
          ]
        : pattern === 2
          ? [
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

const specialties = [
  "Full‑stack TypeScript (Next.js, Fastify, Prisma)",
  "Agent design (prompts, tool use, safety)",
  "Data analytics (SQL, metrics, dashboards)",
  "DevOps (CI/CD, observability, incident response)",
  "Product & technical writing (UX, docs)",
  "Algorithms & optimization (math, performance)",
  "Security engineering (threat modeling, hardening)",
  "Distributed systems (queues, caching, reliability)",
  "Frontend (UI systems, accessibility)",
  "Backend (APIs, architecture, scalability)"
];
const hobbies = [
  "reading, hiking, photography",
  "cooking, coffee, travel",
  "music, movies, journaling",
  "running, cycling, badminton",
  "chess, puzzles, math games",
  "open‑source, maker projects",
  "language learning, podcasts",
  "drawing, design, typography",
  "gardening, nature walks",
  "robotics, electronics, DIY"
];

const personas = [
  { nationality: "United States", ethnicities: ["Not specified", "White", "Black", "Latino", "Asian", "Mixed"], last: ["Johnson","Miller","Davis","Wilson","Brown","Taylor","Anderson","Thomas","Moore","Jackson"], male:["Ethan","Noah","Liam","Mason","Lucas","Logan","James","Benjamin","Henry","Owen"], female:["Olivia","Emma","Ava","Sophia","Mia","Amelia","Harper","Evelyn","Abigail","Ella"] },
  { nationality: "Canada", ethnicities: ["Not specified", "White", "Indigenous", "Black", "Asian", "Mixed"], last: ["Smith","Martin","Roy","Lee","Campbell","Young","Wright","Scott","Green","Baker"], male:["Jack","Leo","Caleb","Isaac","Hudson","Julian","Aiden","Sebastian","Wyatt","Nathan"], female:["Charlotte","Violet","Hannah","Grace","Chloe","Nora","Layla","Zoe","Scarlett","Lucy"] },
  { nationality: "Mexico", ethnicities: ["Not specified", "Mestizo", "Indigenous", "White", "Afro‑Mexican", "Mixed"], last: ["Hernández","García","Martínez","López","González","Pérez","Sánchez","Ramírez","Torres","Flores"], male:["Diego","Mateo","Santiago","Emiliano","Gael","Daniel","Luis","Javier","Carlos","Andrés"], female:["Sofía","Valentina","Camila","Renata","Mariana","Lucía","Paula","Daniela","Regina","Elena"] },
  { nationality: "Brazil", ethnicities: ["Not specified", "Pardo", "White", "Black", "Indigenous", "Mixed"], last: ["Silva","Santos","Oliveira","Souza","Lima","Pereira","Costa","Ferreira","Ribeiro","Almeida"], male:["Arthur","Gabriel","Heitor","Miguel","Davi","Pedro","Rafael","Lucas","Guilherme","Matheus"], female:["Helena","Alice","Laura","Manuela","Júlia","Valentina","Heloísa","Luísa","Sofia","Beatriz"] },
  { nationality: "United Kingdom", ethnicities: ["Not specified", "White", "Black", "South Asian", "East Asian", "Mixed"], last: ["Smith","Jones","Taylor","Brown","Williams","Davies","Evans","Thomas","Wilson","Johnson"], male:["Oliver","George","Harry","Charlie","Jack","Jacob","Alfie","Noah","Freddie","Theo"], female:["Isla","Emily","Amelia","Olivia","Ava","Jessica","Poppy","Sophia","Grace","Lily"] },
  { nationality: "France", ethnicities: ["Not specified", "White", "Black", "Arab", "Mixed"], last: ["Martin","Bernard","Dubois","Thomas","Robert","Richard","Petit","Durand","Leroy","Moreau"], male:["Louis","Gabriel","Jules","Arthur","Raphaël","Adam","Hugo","Lucas","Noah","Nathan"], female:["Emma","Jade","Louise","Alice","Chloé","Lina","Mila","Zoé","Inès","Manon"] },
  { nationality: "Germany", ethnicities: ["Not specified", "White", "Turkish‑German", "Black", "Mixed"], last: ["Müller","Schmidt","Schneider","Fischer","Weber","Meyer","Wagner","Becker","Hoffmann","Schulz"], male:["Ben","Noah","Leon","Paul","Elias","Finn","Jonas","Luis","Lukas","Felix"], female:["Mia","Emma","Hannah","Sophia","Emilia","Lina","Marie","Lea","Anna","Laura"] },
  { nationality: "Spain", ethnicities: ["Not specified", "White", "Latino", "North African", "Mixed"], last: ["García","Fernández","González","Rodríguez","López","Martínez","Sánchez","Pérez","Gómez","Díaz"], male:["Hugo","Mateo","Martín","Lucas","Leo","Daniel","Álvaro","Alejandro","Pablo","Adrián"], female:["Lucía","Sofía","Martina","María","Paula","Valeria","Julia","Emma","Daniela","Alba"] },
  { nationality: "Italy", ethnicities: ["Not specified", "White", "Mixed"], last: ["Rossi","Russo","Ferrari","Esposito","Bianchi","Romano","Gallo","Costa","Fontana","Marino"], male:["Luca","Marco","Matteo","Alessandro","Davide","Simone","Federico","Giuseppe","Andrea","Riccardo"], female:["Sofia","Giulia","Aurora","Alice","Ginevra","Martina","Emma","Beatrice","Chiara","Francesca"] },
  { nationality: "Nigeria", ethnicities: ["Not specified", "Yoruba", "Igbo", "Hausa", "Mixed"], last: ["Okafor","Adeyemi","Okoye","Ibrahim","Mohammed","Chukwu","Balogun","Eze","Nwankwo","Abubakar"], male:["Chinedu","Tunde","Emeka","Ifeanyi","Seyi","Kelechi","Musa","Uche","Samuel","David"], female:["Adaeze","Chioma","Zainab","Amina","Temilade","Amaka","Ifunanya","Maryam","Grace","Esther"] },
  { nationality: "South Africa", ethnicities: ["Not specified", "Black", "Coloured", "White", "Indian", "Mixed"], last: ["Nkosi","Dlamini","Van der Merwe","Naidoo","Botha","Mokoena","Khumalo","Jacobs","Sithole","Pillay"], male:["Thabo","Sipho","Lwazi","Mandla","Ethan","Aiden","Arjun","Kyle","Siyabonga","Johan"], female:["Nomsa","Zanele","Lerato","Ayanda","Amelia","Mia","Priya","Chloe","Naledi","Anika"] },
  { nationality: "Egypt", ethnicities: ["Not specified", "Arab", "Coptic", "Nubian", "Mixed"], last: ["Hassan","Ibrahim","Mohamed","Ali","Sayed","Abdelrahman","Mahmoud","Khalil","Farag","Youssef"], male:["Omar","Ahmed","Youssef","Mostafa","Mahmoud","Karim","Hassan","Amr","Tarek","Khaled"], female:["Mariam","Fatma","Aya","Nour","Hana","Salma","Yasmin","Sara","Reem","Hala"] },
  { nationality: "India", ethnicities: ["Not specified", "South Asian", "Mixed"], last: ["Sharma","Patel","Singh","Kumar","Gupta","Iyer","Reddy","Das","Mehta","Nair"], male:["Arjun","Rohan","Aditya","Rahul","Vikram","Karan","Aman","Sahil","Nikhil","Dev"], female:["Ananya","Priya","Aisha","Kavya","Isha","Riya","Neha","Diya","Meera","Sanya"] },
  { nationality: "Japan", ethnicities: ["Not specified", "East Asian", "Mixed"], last: ["Sato","Suzuki","Takahashi","Tanaka","Watanabe","Ito","Yamamoto","Nakamura","Kobayashi","Kato"], male:["Haruto","Ren","Sota","Yuto","Minato","Riku","Kaito","Sora","Ryota","Taiga"], female:["Yui","Sakura","Hina","Aoi","Rin","Mio","Yuna","Akari","Mei","Koharu"] },
  { nationality: "Australia", ethnicities: ["Not specified", "White", "Indigenous", "Asian", "Mixed"], last: ["Smith","Jones","Williams","Brown","Wilson","Taylor","Anderson","Thomas","Martin","Lee"], male:["Lachlan","Jack","Noah","William","Leo","Thomas","James","Ethan","Henry","Lucas"], female:["Charlotte","Olivia","Amelia","Isla","Ava","Mia","Grace","Sophie","Ruby","Zara"] }
];

async function ensureProject(userId, name) {
  const existing = await prisma.project.findFirst({ where: { userId, name } });
  return existing ?? prisma.project.create({ data: { userId, name } });
}

async function ensureGroups(projectId, baseName) {
  const names = [`${baseName}·群一`, `${baseName}·群二`, `${baseName}·群三`];
  const out = [];
  for (const n of names) {
    const g = await prisma.group.findFirst({ where: { projectId, name: n } });
    out.push(g ?? (await prisma.group.create({ data: { projectId, name: n } })));
  }
  return out;
}

async function ensureAgents(projectId, target, seedLabel) {
  const existing = await prisma.agent.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  const needed = Math.max(0, target - existing.length);
  if (needed === 0) return { created: 0, agents: existing };

  const existingNames = new Set(existing.map((a) => a.name));
  const created = [];
  for (let i = 0; i < needed; i++) {
    const idx = existing.length + created.length + 1;
    const persona = personas[idx % personas.length];
    const gender = idx % 2 === 0 ? "男" : "女";
    const first = gender === "男" ? persona.male[Math.floor(idx / 2) % persona.male.length] : persona.female[Math.floor(idx / 2) % persona.female.length];
    const last = persona.last[Math.floor(idx / (2 * persona.male.length)) % persona.last.length];
    let name = `${first} ${last}`;
    let suffix = 2;
    while (existingNames.has(name)) name = `${first} ${last} ${suffix++}`;
    existingNames.add(name);

    const ethnicity = persona.ethnicities[idx % persona.ethnicities.length];
    const specialty = specialties[idx % specialties.length];
    const hobby = hobbies[(idx * 3) % hobbies.length];
    const age = 22 + (idx % 35);

    const idxStr = String(idx).padStart(3, "0");
    const contactWechat = `${seedLabel}_${slugify(name)}_${idxStr}`;
    const contactPhone = `+1 555-02${String(idx % 100).padStart(2, "0")}`;
    const contactEmail = `${slugify(name)}.${idxStr}@example.invalid`;

    const work = [
      `- 2018–2021: ${specialty}`,
      `- 2021–2024: Worked on internal tooling and reliability improvements`,
      `- 2024–now: Focus on streaming chat UX, safety, and observability`
    ].join("\n");

    const systemPrompt = [
      `You are ${name}.`,
      `Nationality: ${persona.nationality}. Ethnicity: ${ethnicity}. Gender: ${gender}. Age: ${age}.`,
      `Specialties: ${specialty}.`,
      `Hobbies: ${hobby}.`,
      `Contact (demo): WeChat=${contactWechat}; Phone=${contactPhone}; Email=${contactEmail}.`,
      `Be accurate, concise, and helpful. Use Markdown when helpful.`
    ].join("\n");

    const avatarSvg = svgAvatar(`${name}:${contactWechat}:${contactPhone}:${contactEmail}`);

    created.push({
      projectId,
      name,
      systemPrompt,
      defaultModel: "deepseek-chat",
      providerAccountId: null,
      skillPaths: [],
      toolsJson: {},
      ragEnabled: false,

      fullName: name,
      nationality: persona.nationality,
      ethnicity,
      specialties: specialty,
      hobbies: hobby,
      gender,
      age,
      contact: null,
      contactWechat,
      contactPhone,
      contactEmail,
      workExperience: work,
      avatarSvg
    });
  }

  await prisma.agent.createMany({ data: created, skipDuplicates: true });
  const all = await prisma.agent.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
  return { created: created.length, agents: all };
}

function randomGroupSizes(total, rnd, min, max) {
  // 3 groups with each size within [min,max] and sum == total (best effort; adjusts).
  let a = min + Math.floor(rnd() * (max - min + 1));
  let b = min + Math.floor(rnd() * (max - min + 1));
  let c = total - a - b;
  if (c < min) {
    const deficit = min - c;
    const takeA = Math.min(deficit, a - min);
    a -= takeA;
    c += takeA;
    const takeB = Math.min(min - c, b - min);
    b -= takeB;
    c += takeB;
  }
  if (c > max) {
    const extra = c - max;
    const giveA = Math.min(extra, max - a);
    a += giveA;
    c -= giveA;
    const giveB = Math.min(c - max, max - b);
    b += giveB;
    c -= giveB;
  }
  // Clamp and final adjust.
  a = Math.max(min, Math.min(max, a));
  b = Math.max(min, Math.min(max, b));
  c = Math.max(min, Math.min(max, total - a - b));
  // Ensure sum.
  c = total - a - b;
  return [a, b, c];
}

async function assignGroups({ groups, localAgents, foreignAgents, seed, localOnlySumTarget }) {
  const rnd = makeRng(seed);
  const memberRows = [];

  // Base assignment: partition locals into 3 groups.
  const locals = shuffle(localAgents.slice(), rnd);
  const sizes = randomGroupSizes(localOnlySumTarget, rnd, 20, 50);
  let offset = 0;
  for (let gi = 0; gi < 3; gi++) {
    const g = groups[gi];
    const n = sizes[gi];
    const slice = locals.slice(offset, offset + n);
    offset += n;
    for (const a of slice) memberRows.push({ groupId: g.id, agentId: a.id });
  }

  // Add a small number of foreign agents to demonstrate cross-project membership (without exceeding 50).
  if (foreignAgents && foreignAgents.length > 0) {
    for (let gi = 0; gi < 3; gi++) {
      const extra = 4 + Math.floor(rnd() * 5); // 4..8
      const picks = pickN(foreignAgents, Math.min(extra, foreignAgents.length), rnd);
      for (const a of picks) memberRows.push({ groupId: groups[gi].id, agentId: a.id });
    }
  }

  await prisma.groupMember.createMany({ data: memberRows, skipDuplicates: true });
  return { sizes };
}

const userEmail = "1037959324@qq.com";
const user = await prisma.user.findUnique({ where: { email: userEmail } });
if (!user) throw new Error(`user_not_found:${userEmail}`);

const dhc = await ensureProject(user.id, "东湖村");
const ntm = await ensureProject(user.id, "南铁牛庙");

const dhcGroups = await ensureGroups(dhc.id, "东湖村");
const ntmGroups = await ensureGroups(ntm.id, "南铁牛庙");

// Ensure agent counts
const dhcAgents = await prisma.agent.findMany({ where: { projectId: dhc.id }, orderBy: { createdAt: "asc" } });
const ntmResult = await ensureAgents(ntm.id, 72, "demo_ntm");
const ntmAgents = ntmResult.agents;

if (dhcAgents.length < 60) {
  console.warn(
    `东湖村 has ${dhcAgents.length} agents; expected >= 60 to satisfy 3 groups 20-50 each. Consider running your 100-agent seed first.`
  );
}

// Clear existing memberships for these groups to make the seed idempotent-ish.
await prisma.groupMember.deleteMany({ where: { groupId: { in: [...dhcGroups.map((g) => g.id), ...ntmGroups.map((g) => g.id)] } } });

// Assign:
// - 东湖村：从东湖村 agents 中分配 20~50*3 (默认 90) + 额外混入少量南铁牛庙 agents
// - 南铁牛庙：72 个 agents 分配到 3 群（保证每群 20~50 且总和 72），不混入外部，避免超上限
const dhcAssign = await assignGroups({
  groups: dhcGroups,
  localAgents: dhcAgents,
  foreignAgents: ntmAgents,
  seed: "dhc_groups",
  localOnlySumTarget: Math.min(dhcAgents.length, 90)
});

const ntmAssign = await assignGroups({
  groups: ntmGroups,
  localAgents: ntmAgents,
  foreignAgents: [],
  seed: "ntm_groups",
  localOnlySumTarget: 72
});

const counts = async (groups) => {
  const rows = await prisma.group.findMany({ where: { id: { in: groups.map((g) => g.id) } }, include: { _count: { select: { members: true } } } });
  return rows.map((g) => ({ name: g.name, members: g._count.members }));
};

console.log(
  JSON.stringify(
    {
      ok: true,
      projects: [
        { id: dhc.id, name: dhc.name, agentCount: dhcAgents.length, groupCounts: await counts(dhcGroups), localPartitionSizes: dhcAssign.sizes },
        { id: ntm.id, name: ntm.name, agentCreated: ntmResult.created, agentCount: ntmAgents.length, groupCounts: await counts(ntmGroups), localPartitionSizes: ntmAssign.sizes }
      ]
    },
    null,
    2
  )
);

await prisma.$disconnect();
