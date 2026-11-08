import type { EmploymentType, Seniority, Track, Workplace } from "../types";

/* ----------------------------- Location ----------------------------- */
const CITY_ALIASES: [string, RegExp][] = [
  ["Bengaluru", /\b(bengaluru|bangalore|blr|bengalore)\b/i],
  ["Hyderabad", /\b(hyderabad|secunderabad|hyd)\b/i],
  ["Pune", /\bpune\b/i],
  ["Chennai", /\b(chennai|madras)\b/i],
  ["Mumbai", /\b(mumbai|bombay|navi mumbai|thane|powai)\b/i],
  ["Delhi NCR", /\b(new delhi|delhi|gurgaon|gurugram|noida|greater noida|faridabad|ghaziabad|ncr)\b/i],
  ["Kolkata", /\b(kolkata|calcutta)\b/i],
  ["Ahmedabad", /\b(ahmedabad|gandhinagar|gift city)\b/i],
  ["Kochi", /\b(kochi|cochin|ernakulam)\b/i],
  ["Thiruvananthapuram", /\b(thiruvananthapuram|trivandrum|technopark)\b/i],
  ["Coimbatore", /\bcoimbatore\b/i],
  ["Mysuru", /\b(mysuru|mysore)\b/i],
  ["Jaipur", /\bjaipur\b/i],
  ["Chandigarh", /\b(chandigarh|mohali|panchkula)\b/i],
  ["Indore", /\bindore\b/i],
  ["Bhubaneswar", /\bbhubaneswar\b/i],
  ["Vadodara", /\b(vadodara|baroda)\b/i],
  ["Nagpur", /\bnagpur\b/i],
  ["Visakhapatnam", /\b(visakhapatnam|vizag)\b/i],
  ["Mangaluru", /\b(mangaluru|mangalore)\b/i],
];

const INDIA = /\b(india|bharat|karnataka|telangana|maharashtra|tamil nadu|haryana|uttar pradesh|kerala|gujarat|west bengal)\b|,\s*(IN|IND)\b|\bIN-[A-Z]{2}\b/i;
const REMOTE = /\b(remote|work from home|wfh|anywhere|distributed|telecommute)\b/i;
const HYBRID = /\bhybrid\b/i;
const FOREIGN =
  /\b(united states|usa|u\.s\.|canada|united kingdom|uk|london|germany|berlin|france|paris|singapore|australia|sydney|netherlands|amsterdam|ireland|dublin|poland|spain|brazil|mexico|japan|tokyo|uae|dubai|philippines|vietnam|indonesia|israel|san francisco|new york|seattle|toronto|emea|apac|latam|americas|europe)\b/i;

export interface LocationResult {
  cities: string[];
  workplace: Workplace;
  remoteIndia: boolean;
  inIndia: boolean;
}

export function parseLocations(locations: string[], workplaceHint?: string, title = ""): LocationResult {
  const all = [...locations, title].join(" | ");
  const cities = CITY_ALIASES.filter(([, re]) => re.test(all)).map(([c]) => c);
  const hint = `${workplaceHint ?? ""} ${locations.join(" ")} ${title}`;
  const workplace: Workplace = REMOTE.test(hint) ? "remote" : HYBRID.test(hint) ? "hybrid" : locations.length ? "onsite" : "unknown";
  const mentionsIndia = cities.length > 0 || INDIA.test(all);
  const foreignOnly = !mentionsIndia && FOREIGN.test(all);
  const remoteIndia = workplace === "remote" && (mentionsIndia || (!foreignOnly && /^\s*(remote|anywhere)\s*$/i.test(locations[0] ?? "")));
  return { cities, workplace, remoteIndia, inIndia: mentionsIndia || remoteIndia };
}

/* -------------------------- Employment type -------------------------- */
export function employmentType(hint: string | undefined, title: string, text = ""): EmploymentType {
  const t = `${title} ${hint ?? ""}`;
  if (/\bintern(ship)?s?\b/i.test(t)) return "intern";
  if (/\bapprentice(ship)?\b/i.test(t)) return "apprentice";
  if (/\btrainee\b/i.test(t)) return "apprentice";
  if (/\b(contract(or)?|c2h|contract[- ]to[- ]hire|fixed[- ]term|freelance)\b/i.test(t)) return "contract";
  if (/\b(temporary|temp|seasonal)\b/i.test(t)) return "temporary";
  if (/\bpart[- ]time\b/i.test(t)) return "part_time";
  if (/\b(full[- ]?time|permanent|regular|fulltime|full_time)\b/i.test(t)) return "full_time";
  // Body text is a weaker signal: only use explicit "this is a contract role" style phrasing.
  if (/\b(this is a|it is a)\s+(\d+[- ]month\s+)?(contract|contractual|temporary)\b/i.test(text)) return "contract";
  if (/\b(\d+)[- ]months?\s+internship\b/i.test(text)) return "intern";
  return "unknown";
}

export const REJECTED_EMPLOYMENT: EmploymentType[] = ["intern", "apprentice", "contract", "temporary"];

/* ----------------------------- Seniority ----------------------------- */
export interface SeniorityResult {
  seniority: Seniority;
  level?: number;
  reject?: string;
}

const SENIOR_WORDS =
  /\b(senior|sr\.?|staff|lead|principal|manager|director|architect|head|vp|vice president|chief|distinguished|fellow)\b/i;
const ENTRY_WORDS = /\b(associate|junior|jr\.?|entry[- ]level|graduate|grad|new grad|fresher|early career|campus)\b/i;

export function seniorityFromTitle(title: string): SeniorityResult {
  const t = title.replace(/[,()/|]/g, " ");
  const sw = t.match(SENIOR_WORDS);
  // "Associate Manager", "Lead" etc. are still rejected; "Associate" alone is entry.
  if (sw) return { seniority: "senior", reject: `title contains "${sw[0]}"` };
  const roman = t.match(/\b(I{1,3}|IV|V)\b/);
  const digit = t.match(/\b(?:SDE|SWE|engineer|developer|analyst|L|level|grade)[\s-]*([1-6])\b/i);
  const lvl = roman ? ({ I: 1, II: 2, III: 3, IV: 4, V: 5 } as Record<string, number>)[roman[1]!] : digit ? Number(digit[1]) : undefined;
  if (lvl !== undefined && lvl >= 3) return { seniority: "mid", level: lvl, reject: `level ${lvl}` };
  if (lvl === 2) return { seniority: "mid", level: 2 };
  if (lvl === 1 || ENTRY_WORDS.test(t)) return { seniority: "entry", level: lvl ?? 1 };
  return { seniority: "unknown" };
}

/* ----------------------------- Experience ----------------------------- */
export interface ExperienceResult {
  minYears?: number;
  maxYears?: number;
  expText?: string;
  fresher?: boolean;
}

const NUM = String.raw`(\d{1,2}(?:\.\d)?)`;
const UNIT = String.raw`(years?|yrs?|months?|mos?)`;
const DASH = String.raw`\s*(?:-|–|—|to)\s*`;
const CONTEXT = /(experience|exp\b|work(ing)?|industry|professional|relevant|hands[- ]on|background|in (software|development|the field))/i;
const NOT_EXP_AFTER = /^\s*(degree|program|course|b\.?tech|bachelor|old|warranty|anniversary|of (age|education|college))/i;

function toYears(n: number, unit: string): number {
  return /^m/i.test(unit) ? n / 12 : n;
}

export function parseExperience(text: string): ExperienceResult {
  const s = text.replace(/\s+/g, " ");
  type Hit = { min: number; max?: number; text: string; ctx: boolean };
  const hits: Hit[] = [];
  const ctxAround = (i: number, len: number) => CONTEXT.test(s.slice(Math.max(0, i - 80), i + len + 80));
  const push = (m: RegExpMatchArray, min: number, max?: number) => {
    const after = s.slice(m.index! + m[0].length, m.index! + m[0].length + 25);
    if (NOT_EXP_AFTER.test(after)) return;
    hits.push({ min, max, text: m[0].trim(), ctx: ctxAround(m.index!, m[0].length) });
  };

  for (const m of s.matchAll(new RegExp(`${NUM}${DASH}${NUM}\\s*\\+?\\s*${UNIT}`, "gi"))) {
    const u = m[3]!;
    push(m, toYears(Number(m[1]), u), toYears(Number(m[2]), u));
  }
  for (const m of s.matchAll(new RegExp(`(?:at least|minimum(?: of)?|min\\.?|not less than|over|more than)\\s*${NUM}\\s*\\+?\\s*${UNIT}`, "gi")))
    push(m, toYears(Number(m[1]), m[2]!));
  for (const m of s.matchAll(new RegExp(`${NUM}\\s*\\+\\s*${UNIT}`, "gi"))) push(m, toYears(Number(m[1]), m[2]!));
  for (const m of s.matchAll(new RegExp(`${NUM}\\s*${UNIT}\\s*(?:minimum|min\\.?|or more|and above|plus)`, "gi")))
    push(m, toYears(Number(m[1]), m[2]!));
  for (const m of s.matchAll(new RegExp(`${NUM}\\s*${UNIT}(?:'s)?\\s+(?:of\\s+)?(?:[a-z/+#.-]+\\s+){0,4}experience`, "gi")))
    push(m, toYears(Number(m[1]), m[2]!));

  const fresher = /\b(freshers?|fresh graduates?|new grads?|recent graduates?|0\s*years?|no (prior )?experience (is )?required|entry[- ]level)\b/i.test(s);

  const withCtx = hits.filter((h) => h.ctx);
  const use = withCtx.length ? withCtx : hits;
  if (!use.length) return fresher ? { minYears: 0, maxYears: 1, expText: "freshers", fresher } : { fresher };

  // The smallest stated requirement wins ("2+ years required; 5+ preferred" → 2).
  const best = use.reduce((a, b) => (b.min < a.min ? b : a));
  const floor = (n: number) => (n < 1 ? 0 : Math.round(n * 10) / 10);
  return {
    minYears: floor(best.min),
    maxYears: best.max !== undefined ? Math.round(best.max * 10) / 10 : undefined,
    expText: best.text,
    fresher,
  };
}

/* ------------------------------- Salary ------------------------------- */
export interface SalaryResult {
  salaryMinLpa?: number;
  salaryMaxLpa?: number;
  salaryText?: string;
}

const LAKH = String.raw`(?:lpa|l\.p\.a\.?|lakhs?|lacs?|lakh per annum|l\b)`;
const RUPEE = String.raw`(?:₹|inr|rs\.?|rupees)`;

function inrToLpa(n: number): number {
  return Math.round((n / 100000) * 10) / 10;
}

export function parseSalary(text: string): SalaryResult {
  const s = text.replace(/\s+/g, " ");
  const num = (x: string) => Number(x.replace(/,/g, ""));
  let m = s.match(new RegExp(`(?:${RUPEE}\\s*)?(\\d{1,3}(?:\\.\\d{1,2})?)\\s*${LAKH}?${DASH}(?:${RUPEE}\\s*)?(\\d{1,3}(?:\\.\\d{1,2})?)\\s*${LAKH}`, "i"));
  if (m) return { salaryMinLpa: num(m[1]!), salaryMaxLpa: num(m[2]!), salaryText: m[0].trim() };
  m = s.match(new RegExp(`(?:${RUPEE}\\s*)?(\\d{1,3}(?:\\.\\d{1,2})?)\\s*${LAKH}`, "i"));
  if (m && (new RegExp(RUPEE, "i").test(m[0]) || /ctc|salary|pay|compensation|package|stipend/i.test(s.slice(Math.max(0, m.index! - 60), m.index! + 60)))) {
    return { salaryMinLpa: num(m[1]!), salaryMaxLpa: num(m[1]!), salaryText: m[0].trim() };
  }
  // Absolute INR amounts: "INR 4,00,000 - 6,00,000", "₹600000 per annum"
  m = s.match(new RegExp(`${RUPEE}\\s*([\\d,]{6,})(?:\\s*(?:-|–|to)\\s*(?:${RUPEE}\\s*)?([\\d,]{6,}))?`, "i"));
  if (m) {
    const a = inrToLpa(num(m[1]!));
    const b = m[2] ? inrToLpa(num(m[2])) : a;
    if (a >= 1 && b <= 200) return { salaryMinLpa: a, salaryMaxLpa: b, salaryText: m[0].trim() };
  }
  return {};
}

/* -------------------------------- Track -------------------------------- */
const TRACK_RULES: [Track, RegExp, RegExp?][] = [
  ["ai_ml", /\b(machine learning|deep learning|data scien\w*|computer vision|nlp|natural language|llm|gen ?ai|generative ai|artificial intelligence|mlops|applied scientist|research scientist)\b/i, /\b(AI|ML)\b/],
  ["devops", /\b(devops|dev ops|site reliability|sre|platform engineer\w*|infrastructure|cloud engineer|cloud ops|devsecops|kubernetes|release engineer)\b/i],
  ["data", /\b(data engineer\w*|data analyst|analytics engineer|business intelligence|bi developer|etl|big data|data platform|data analytics)\b/i],
  ["qa", /\b(qa|quality assurance|quality engineer|test(ing)? engineer|sdet|automation test\w*|tester)\b/i],
  ["software", /\b(software|developer|sde|swe|engineer|programmer|frontend|front-end|backend|back-end|full[- ]?stack|mobile|android|ios|web|application)\b/i],
];

export function trackFromTitle(title: string): Track | undefined {
  for (const [track, ci, cs] of TRACK_RULES) {
    if (ci.test(title) || (cs && cs.test(title))) return track;
  }
  return undefined;
}

/* --------------------------- Staffing / services --------------------------- */
const STAFFING_PHRASES =
  /\b(hiring for (our|one of our|a leading)? ?clients?|on behalf of (our|a|one of our) clients?|for (one of )?our (esteemed |reputed )?clients?|our client,? (is )?a|client of ours|on (the )?payroll of|third[- ]party payroll|staffing partner)\b/i;

export const STAFFING_AGENCIES = [
  "teamlease", "randstad", "adecco", "manpowergroup", "manpower", "quess", "xpheno", "abc consultants", "kelly services",
  "michael page", "ciel hr", "careernet", "collabera", "allegis", "teksystems", "hays", "people prime", "peopleprime",
  "artech", "mafoi", "ma foi", "genius consultants", "ikya", "innovsource", "nlb services", "taggd", "antal", "spectrum talent",
  "scienstechnologies", "uplers", "turing", "crossover", "toptal", "andela",
];

export const IT_SERVICES_EMPLOYERS = [
  "tcs", "tata consultancy services", "infosys", "wipro", "hcl", "hcltech", "tech mahindra", "cognizant", "accenture",
  "capgemini", "ltimindtree", "lti", "mindtree", "mphasis", "hexaware", "persistent systems", "coforge", "birlasoft",
  "zensar", "cyient", "sonata software", "niit technologies", "mastek", "ust", "ust global", "virtusa", "ibm consulting",
  "deloitte", "kpmg", "ey", "pwc", "dxc technology", "ntt data", "atos", "unisys", "l&t technology services", "kpit",
];

export function staffingSignal(text: string, companyName: string): string | undefined {
  const m = text.match(STAFFING_PHRASES);
  if (m) return `staffing phrase: "${m[0]}"`;
  const lc = companyName.toLowerCase();
  const agency = STAFFING_AGENCIES.find((a) => lc === a || lc.startsWith(a + " "));
  return agency ? `known agency: ${agency}` : undefined;
}

export function isItServicesEmployer(name: string): boolean {
  const lc = name.toLowerCase().replace(/[^a-z0-9& ]/g, " ").replace(/\s+/g, " ").trim();
  return IT_SERVICES_EMPLOYERS.some((e) => lc === e || lc.startsWith(e + " ") || lc.endsWith(" " + e));
}

/* --------------------------------- Skills --------------------------------- */
export const SKILL_DICT: [string, RegExp][] = [
  ["Python", /\bpython\b/i], ["Java", /\bjava\b(?!script)/i], ["JavaScript", /\b(javascript|js)\b/i],
  ["TypeScript", /\btypescript\b/i], ["Go", /\b(golang|go lang)\b|\bGo\b/], ["C++", /\bc\+\+/i], ["C#", /\bc#/i],
  ["Rust", /\brust\b/i], ["Kotlin", /\bkotlin\b/i], ["Swift", /\bswift\b/i], ["Scala", /\bscala\b/i], ["Ruby", /\bruby\b/i],
  ["PHP", /\bphp\b/i], ["SQL", /\bsql\b/i], ["React", /\breact(\.js|js)?\b/i], ["Angular", /\bangular\b/i],
  ["Vue", /\bvue(\.js)?\b/i], ["Node.js", /\bnode(\.js|js)?\b/i], ["Next.js", /\bnext\.js\b/i], ["Spring", /\bspring( boot)?\b/i],
  ["Django", /\bdjango\b/i], ["Flask", /\bflask\b/i], ["FastAPI", /\bfastapi\b/i], ["AWS", /\b(aws|amazon web services)\b/i],
  ["GCP", /\b(gcp|google cloud)\b/i], ["Azure", /\bazure\b/i], ["Docker", /\bdocker\b/i], ["Kubernetes", /\b(kubernetes|k8s)\b/i],
  ["Terraform", /\bterraform\b/i], ["Linux", /\blinux\b/i], ["Git", /\bgit\b/i], ["CI/CD", /\b(ci\/cd|jenkins|github actions|gitlab ci)\b/i],
  ["PostgreSQL", /\b(postgres|postgresql)\b/i], ["MySQL", /\bmysql\b/i], ["MongoDB", /\bmongo(db)?\b/i], ["Redis", /\bredis\b/i],
  ["Kafka", /\bkafka\b/i], ["Spark", /\b(apache )?spark\b/i], ["Airflow", /\bairflow\b/i], ["Pandas", /\bpandas\b/i],
  ["PyTorch", /\bpytorch\b/i], ["TensorFlow", /\btensorflow\b/i], ["scikit-learn", /\b(scikit-learn|sklearn)\b/i],
  ["LLMs", /\b(llms?|large language models?)\b/i], ["Machine Learning", /\bmachine learning\b/i], ["Deep Learning", /\bdeep learning\b/i],
  ["NLP", /\b(nlp|natural language processing)\b/i], ["Computer Vision", /\bcomputer vision\b/i], ["Data Structures", /\bdata structures\b/i],
  ["Algorithms", /\balgorithms\b/i], ["REST APIs", /\b(rest(ful)?( apis?)?)\b/i], ["GraphQL", /\bgraphql\b/i], ["Microservices", /\bmicro-?services\b/i],
  ["Selenium", /\bselenium\b/i], ["Playwright", /\bplaywright\b/i], ["Cypress", /\bcypress\b/i], ["Android", /\bandroid\b/i],
  ["iOS", /\bios\b/i], ["Flutter", /\bflutter\b/i], ["React Native", /\breact native\b/i], ["Tableau", /\btableau\b/i],
  ["Power BI", /\bpower ?bi\b/i], ["Excel", /\bexcel\b/i], ["Snowflake", /\bsnowflake\b/i], ["dbt", /\bdbt\b/i],
];

export function skillsFromText(text: string, limit = 12): string[] {
  return SKILL_DICT.filter(([, re]) => re.test(text)).map(([s]) => s).slice(0, limit);
}
