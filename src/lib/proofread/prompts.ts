import type { ProofreadUserPayload, Suggestion } from "./types";

const OUTPUT_CONTRACT = `Odpověď MUSÍ být POUZE JSON objekt s těmito poli (žádný jiný text před ani za):
- "suggestions": pole JSON objektů; KAŽDÁ chyba = JEDNA položka, žádné slučování. Použito vždy když je nalezena chyba nebo návrh.
  Každá položka: { "field": "title" nebo "body", "type": typ chyby (např. "pravopis", "interpunkce", "gramatika", "stylistika"), "original": KRÁTKÝ doslovný úryvek z původního textu (2–10 slov, znak po znaku totožný s textem), "replacement": stejný úryvek s opravou, "explanation": stručné vysvětlení česky, "confidence": 0..1 }
- "summary": stručné shrnutí kolik a jakých chyb (např. "3 chyby: 2 čárky, 1 překlep"). NEPOPISUJ konkrétní opravy ani neříkej "Opraveno X" – konkrétní opravy patří POUZE do "suggestions".
- "warnings": pole stringů s upozorněními, může být prázdné.

PRAVIDLA:
- "original" MUSÍ být doslovný úryvek z původního textu (žádná parafráze). Klient ho hledá přesnou shodou; jinak oprava propadne.
- Drž "original" krátký – pouze okolí chyby (typicky 2–10 slov).
- Opakující se chyba: každý výskyt jako samostatná JSON položka.
- U HTML neměň značky, atributy ani URL – opravuj jen textový obsah.
- Pokud opravdu není co opravit: "suggestions": [], "summary": "Bez chyb."
- Pokud jsi našel chyby, musí být použito pole "suggestions", nelze chybi vypsat pouze do summary nebo warnings.
- Pokud jsi u nějaké části zjistil, že je bez chyb tak ji nedávej do pole "suggestions"
- DŮLEŽITÉ: Jakákoliv dřívější instrukce typu "vrať opravený text" nebo "kompletní opravené HTML" se NEUPLATŇUJE – vrať POUZE výše popsaný JSON.

PŘÍKLAD JSON ODPOVĚDI:
{
  "suggestions": [
    {"field":"body","type":"interpunkce","original":"krásné ale studené","replacement":"krásné, ale studené","explanation":"Před spojkou 'ale' v souvětí patří čárka.","confidence":0.95},
    {"field":"body","type":"překlep","original":"jak je vidno","replacement":"jak je vidno,","explanation":"Chybějící čárka před vloženou větou.","confidence":0.85}
  ],
  "summary": "2 chyby v interpunkci.",
  "warnings": []
}`;

export function buildSystemMessage(promptBody: string): string {
  return `${promptBody.trim()}\n\n${OUTPUT_CONTRACT}`;
}

/** Sequential mode: tell the LLM which fixes Korektor already found so it can
 *  skip them and focus on punctuation / grammar / style. */
export function buildKorektorHint(korektor: Suggestion[]): string {
  if (korektor.length === 0) return "";
  const lines = korektor
    .slice(0, 100)
    .map((s) => `- "${s.original}" → "${s.replacement}"`)
    .join("\n");
  return `\n\nNástroj Korektor už našel tyto pravopisné opravy (NEopakuj je ve svých "suggestions", soustřeď se na interpunkci, gramatiku a styl):\n${lines}`;
}

export function buildUserMessage(payload: ProofreadUserPayload): string {
  return JSON.stringify({
    mode: payload.mode,
    title: payload.title,
    bodyHtml: payload.bodyHtml,
  });
}
