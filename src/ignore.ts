function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function globToRegexSource(pattern: string): string {
  let out = "";
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]!;
    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        const next = pattern[i + 2];
        if (next === "/") {
          out += "(?:.*/)?";
          i += 2;
        } else {
          out += ".*";
          i += 1;
        }
        continue;
      }
      out += "[^/]*";
      continue;
    }
    if (ch === "?") {
      out += "[^/]";
      continue;
    }
    out += escapeRegExp(ch);
  }
  return out;
}

function globToRegExp(pattern: string): RegExp {
  let normalized = pattern.replace(/\\/g, "/").replace(/^\.\/+/, "");
  normalized = normalized.replace(/\/+$/, "");
  if (normalized.endsWith("/**")) {
    const base = normalized.slice(0, -3);
    return new RegExp(`^${globToRegexSource(base)}(?:/.*)?$`);
  }
  return new RegExp(`^${globToRegexSource(normalized)}$`);
}

export function buildIgnoreMatcher(
  patterns: string[],
): (relPath: string) => boolean {
  if (patterns.length === 0) return () => false;
  const regexes = patterns.map((pattern) => globToRegExp(pattern));
  return (relPath: string): boolean => {
    const normalized = relPath.replace(/\\/g, "/");
    return regexes.some((regex) => regex.test(normalized));
  };
}
