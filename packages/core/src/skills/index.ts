/**
 * Skills catalog for search-as-you-type in the UI and for resume parsing.
 * Grouped so users see what kind of thing each suggestion is (language vs framework vs tool).
 */
export const SKILL_CATALOG = {
  Languages: ["Python", "Java", "JavaScript", "TypeScript", "C", "C++", "C#", "Go", "Rust", "Kotlin", "Swift", "Scala", "Ruby", "PHP", "Dart", "R", "MATLAB", "SQL", "Bash", "HTML", "CSS"],
  "Web frameworks": ["React", "Next.js", "Angular", "Vue", "Svelte", "Redux", "Tailwind CSS", "Bootstrap", "jQuery", "Node.js", "Express", "NestJS", "Django", "Flask", "FastAPI", "Spring", "Spring Boot", "Hibernate", ".NET", "ASP.NET", "Laravel", "Ruby on Rails", "GraphQL", "REST APIs", "gRPC", "WebSockets"],
  Mobile: ["Android", "iOS", "Flutter", "React Native", "Jetpack Compose", "SwiftUI"],
  Databases: ["PostgreSQL", "MySQL", "MongoDB", "Redis", "SQLite", "Oracle Database", "SQL Server", "Cassandra", "DynamoDB", "Elasticsearch", "Firebase", "Supabase"],
  "Cloud & DevOps": ["AWS", "GCP", "Azure", "Docker", "Kubernetes", "Terraform", "Ansible", "Jenkins", "GitHub Actions", "CI/CD", "Linux", "Nginx", "Prometheus", "Grafana", "Helm", "Serverless"],
  "Data & AI": ["Machine Learning", "Deep Learning", "NLP", "Computer Vision", "LLMs", "Generative AI", "RAG", "LangChain", "PyTorch", "TensorFlow", "Keras", "scikit-learn", "Hugging Face", "Pandas", "NumPy", "Matplotlib", "Spark", "Kafka", "Airflow", "dbt", "Snowflake", "Databricks", "Tableau", "Power BI", "Excel", "Statistics"],
  "Testing & QA": ["Selenium", "Playwright", "Cypress", "JUnit", "PyTest", "Jest", "Postman", "Manual Testing", "Automation Testing"],
  "Tools & concepts": ["Git", "Jira", "Figma", "Data Structures", "Algorithms", "OOP", "System Design", "Microservices", "Agile", "Operating Systems", "Computer Networks", "DBMS"],
} as const;

export type SkillCategory = keyof typeof SKILL_CATALOG;

export const ALL_SKILLS: { name: string; category: SkillCategory }[] = Object.entries(SKILL_CATALOG).flatMap(([category, names]) =>
  (names as readonly string[]).map((name) => ({ name, category: category as SkillCategory })),
);

/** Extra spellings people type, mapped to the catalog name. */
export const SKILL_ALIASES: Record<string, string> = {
  js: "JavaScript", ts: "TypeScript", golang: "Go", reactjs: "React", "react.js": "React", nextjs: "Next.js", node: "Node.js", nodejs: "Node.js",
  "express.js": "Express", vuejs: "Vue", "vue.js": "Vue", postgres: "PostgreSQL", mongo: "MongoDB", k8s: "Kubernetes", ml: "Machine Learning",
  dl: "Deep Learning", genai: "Generative AI", "gen ai": "Generative AI", sklearn: "scikit-learn", "springboot": "Spring Boot", "dotnet": ".NET",
  "c sharp": "C#", cpp: "C++", "power bi": "Power BI", powerbi: "Power BI", dsa: "Data Structures", "rest api": "REST APIs", restful: "REST APIs",
  "amazon web services": "AWS", "google cloud": "GCP", "ci cd": "CI/CD", oops: "OOP", "ms excel": "Excel",
};

const norm = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();
const BY_NAME = new Map(ALL_SKILLS.map((s) => [norm(s.name), s.name]));

/** Canonical spelling for a typed skill, or the trimmed input if it isn't in the catalog. */
export function canonicalSkill(input: string): string {
  const n = norm(input);
  return BY_NAME.get(n) ?? SKILL_ALIASES[n] ?? input.trim().replace(/\s+/g, " ");
}

/** Ranked suggestions: prefix matches first, then word-start, then substring. */
export function searchSkills(query: string, exclude: string[] = [], limit = 8): { name: string; category: SkillCategory }[] {
  const q = norm(query);
  const taken = new Set(exclude.map(norm));
  if (!q) return [];
  const aliasHit = SKILL_ALIASES[q];
  const scored = ALL_SKILLS.filter((s) => !taken.has(norm(s.name)))
    .map((s) => {
      const n = norm(s.name);
      const score = n === q || s.name === aliasHit ? 0 : n.startsWith(q) ? 1 : n.split(/[\s./-]/).some((w) => w.startsWith(q)) ? 2 : n.includes(q) ? 3 : 9;
      return { s, score };
    })
    .filter((x) => x.score < 9)
    .sort((a, b) => a.score - b.score || a.s.name.length - b.s.name.length);
  return scored.slice(0, limit).map((x) => x.s);
}

/** Popular picks per role, shown as one-tap chips when the list is empty or short. */
export const POPULAR_BY_TRACK: Record<string, string[]> = {
  software: ["Java", "Python", "JavaScript", "React", "Node.js", "Spring Boot", "SQL", "Git", "Data Structures", "REST APIs"],
  ai_ml: ["Python", "Machine Learning", "Deep Learning", "PyTorch", "TensorFlow", "NLP", "LLMs", "Pandas", "scikit-learn", "SQL"],
  devops: ["Linux", "Docker", "Kubernetes", "AWS", "Terraform", "CI/CD", "Jenkins", "Bash", "Git", "Prometheus"],
  data: ["SQL", "Python", "Excel", "Power BI", "Tableau", "Pandas", "Spark", "Airflow", "Statistics", "Snowflake"],
  qa: ["Selenium", "Java", "Python", "Manual Testing", "Automation Testing", "Postman", "Cypress", "Playwright", "SQL", "Jira"],
};
