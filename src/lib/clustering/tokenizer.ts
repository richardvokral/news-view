const STOP_WORDS = new Set([
  // English
  "the", "a", "an", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "could",
  "should", "may", "might", "can", "shall", "must", "need", "dare",
  "to", "of", "in", "for", "on", "with", "at", "by", "from", "as",
  "into", "through", "during", "before", "after", "above", "below",
  "between", "out", "off", "over", "under", "again", "further", "then",
  "once", "here", "there", "when", "where", "why", "how", "all", "each",
  "every", "both", "few", "more", "most", "other", "some", "such", "no",
  "nor", "not", "only", "own", "same", "so", "than", "too", "very",
  "just", "because", "but", "and", "or", "if", "while", "about", "up",
  "its", "it", "this", "that", "these", "those", "he", "she", "they",
  "we", "you", "i", "me", "him", "her", "us", "them", "my", "your",
  "his", "our", "their", "what", "which", "who", "whom", "whose",
  "also", "says", "said", "new", "get", "gets", "got",
  // German
  "der", "die", "das", "ein", "eine", "und", "ist", "sind", "war",
  "hat", "haben", "wird", "werden", "kann", "mit", "auf", "für",
  "von", "den", "dem", "des", "sich", "nicht", "als", "auch", "noch",
  "nach", "bei", "über", "vor", "aus", "wie", "aber", "oder", "wenn",
  "man", "ich", "wir", "sie", "es", "er", "mir", "uns", "ihr",
  // News filler
  "breaking", "update", "live", "report", "reports", "news", "latest",
]);

export function extractKeywords(text: string): string[] {
  const cleaned = text
    .toLowerCase()
    .replace(/['']/g, "'")
    .replace(/[^\w\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  const words = cleaned.split(" ").filter((w) => w.length > 1);
  const keywords: string[] = [];

  for (const word of words) {
    const stemmed = simpleStem(word);
    if (stemmed.length > 1 && !STOP_WORDS.has(stemmed) && !STOP_WORDS.has(word)) {
      keywords.push(stemmed);
    }
  }

  return [...new Set(keywords)];
}

function simpleStem(word: string): string {
  let w = word;
  if (w.endsWith("'s")) w = w.slice(0, -2);
  if (w.length > 5 && w.endsWith("ing")) w = w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) w = w.slice(0, -2);
  if (w.length > 4 && w.endsWith("tion")) w = w.slice(0, -4);
  if (w.length > 4 && w.endsWith("ment")) w = w.slice(0, -4);
  if (w.length > 3 && w.endsWith("ly")) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith("er")) w = w.slice(0, -2);
  if (w.length > 3 && w.endsWith("es")) w = w.slice(0, -2);
  else if (w.length > 3 && w.endsWith("s")) w = w.slice(0, -1);
  return w;
}

export function jaccardSimilarity(a: string[], b: string[]): number {
  const setA = new Set(a);
  const setB = new Set(b);
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}
