/**
 * Minimal robots.txt parser (RFC 9309): groups by user-agent, longest-match
 * Allow/Disallow with `*` and `$` support. Allow wins ties.
 */
interface Rule {
  allow: boolean;
  pattern: string;
  re: RegExp;
}

export interface Robots {
  isAllowed(pathAndQuery: string): boolean;
  crawlDelaySec?: number;
}

function toRegExp(pattern: string): RegExp {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp("^" + body + (anchored ? "$" : ""));
}

export function parseRobots(txt: string, userAgent: string): Robots {
  const ua = userAgent.toLowerCase().split("/")[0]!.trim();
  type Group = { agents: string[]; rules: Rule[]; crawlDelay?: number };
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;

  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (key === "allow" || key === "disallow") {
      if (key === "disallow" && value === "") continue; // empty disallow = allow all
      current.rules.push({ allow: key === "allow", pattern: value, re: toRegExp(value) });
    } else if (key === "crawl-delay") {
      const n = Number(value);
      if (Number.isFinite(n)) current.crawlDelay = n;
    }
  }

  const specific = groups.filter((g) => g.agents.some((a) => a !== "*" && ua.includes(a)));
  const chosen = specific.length ? specific : groups.filter((g) => g.agents.includes("*"));
  const rules = chosen.flatMap((g) => g.rules);
  const crawlDelaySec = chosen.find((g) => g.crawlDelay !== undefined)?.crawlDelay;

  return {
    crawlDelaySec,
    isAllowed(pathAndQuery: string) {
      let best: Rule | null = null;
      for (const r of rules) {
        if (!r.re.test(pathAndQuery)) continue;
        if (
          !best ||
          r.pattern.length > best.pattern.length ||
          (r.pattern.length === best.pattern.length && r.allow && !best.allow)
        ) {
          best = r;
        }
      }
      return best ? best.allow : true;
    },
  };
}

export const ALLOW_ALL: Robots = { isAllowed: () => true };
