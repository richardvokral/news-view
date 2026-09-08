// Article URL parsing. Plausible gives us nothing but the path, so the slug is
// the only content signal we have:
//
//   /a/HWpj2/zpravy-domov-klaus-ostre-kritizuje-pavla-jeho-projev-...
//    │  │     │      │      └── headline words
//    │  │     └──────┴───────── editorial sections
//    │  └────────────────────── short id
//    └───────────────────────── article prefix

export const DEFAULT_ARTICLE_REGEX = "^/a/([^/]+)/([^/?#]+)";

/** Section tokens are matched against a vocabulary, never guessed. */
export const MAX_SECTION_TOKENS = 2;

export interface ParsedArticlePath {
  shortId: string;
  slug: string;
  sections: string[];
  headline: string;
}

export function buildArticleRegex(pattern: string | undefined): RegExp {
  if (!pattern || !pattern.trim()) return new RegExp(DEFAULT_ARTICLE_REGEX);
  try {
    return new RegExp(pattern);
  } catch {
    return new RegExp(DEFAULT_ARTICLE_REGEX);
  }
}

function stripQuery(pagePath: string): string {
  const cut = pagePath.search(/[?#]/);
  return cut >= 0 ? pagePath.slice(0, cut) : pagePath;
}

/** `klaus-ostre-kritizuje` -> `Klaus ostre kritizuje`. Diacritics are gone for good. */
export function deslugify(tokens: string[]): string {
  const text = tokens.join(" ").trim();
  if (!text) return "";
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * Consume leading slug tokens that are known sections, at most
 * `MAX_SECTION_TOKENS` of them.
 *
 * The vocabulary is what makes this safe. "The first one or two words are
 * sections" would eat real headline words — in `sport-hokej-...` only a
 * vocabulary can say whether `hokej` is a section or the start of the
 * headline. An unknown prefix yields no sections rather than a guess.
 */
export function splitSections(
  tokens: string[],
  vocabulary: Set<string>
): { sections: string[]; rest: string[] } {
  const sections: string[] = [];
  let i = 0;
  while (
    i < tokens.length &&
    sections.length < MAX_SECTION_TOKENS &&
    vocabulary.has(tokens[i])
  ) {
    sections.push(tokens[i]);
    i += 1;
  }
  // Never consume the whole slug: a headline is required.
  if (i >= tokens.length) return { sections: [], rest: tokens };
  return { sections, rest: tokens.slice(i) };
}

export function parseArticlePath(
  pagePath: string,
  vocabulary: Set<string>,
  regex: RegExp = new RegExp(DEFAULT_ARTICLE_REGEX)
): ParsedArticlePath | null {
  const match = regex.exec(stripQuery(pagePath));
  if (!match) return null;

  const shortId = match[1] ?? "";
  const slug = match[2] ?? "";
  if (!shortId || !slug) return null;

  const tokens = slug.split("-").filter(Boolean);
  const { sections, rest } = splitSections(tokens, vocabulary);

  return { shortId, slug, sections, headline: deslugify(rest) };
}

/**
 * Empirical section discovery for the admin page: count how often each token
 * appears in leading position across stored slugs, so real sections can be
 * promoted into the vocabulary instead of being guessed up front.
 */
export function countLeadingTokens(
  slugs: string[],
  positions = MAX_SECTION_TOKENS
): { token: string; count: number; share: number }[] {
  const counts = new Map<string, number>();
  for (const slug of slugs) {
    const tokens = slug.split("-").filter(Boolean);
    for (let i = 0; i < Math.min(positions, tokens.length); i += 1) {
      counts.set(tokens[i], (counts.get(tokens[i]) ?? 0) + 1);
    }
  }
  const total = slugs.length || 1;
  return [...counts.entries()]
    .map(([token, count]) => ({ token, count, share: count / total }))
    .sort((a, b) => b.count - a.count);
}
