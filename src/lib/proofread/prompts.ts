import type { ProofreadUserPayload } from "./types";

const OUTPUT_CONTRACT = `Vrať POUZE strukturovaná data s těmito poli:
- "suggestions": pole konkrétních změn; každá { "field": "title" nebo "body", "type": krátký typ chyby, "original": přesný úsek z původního textu (musí se v něm doslovně vyskytovat), "replacement": opravený úsek, "explanation": česky proč, "confidence": číslo 0..1 }
- "summary": jednovětné shrnutí česky
- "warnings": pole varování (nejistá místa), může být prázdné

DŮLEŽITÉ:
- Klient sám provede náhrady v původním textu; NEVRACEJ celý opravený text.
- "original" MUSÍ být doslovný úsek z původního textu (bez parafráze), aby ho šlo přesně najít. Když je třeba, přidej do něj okolní slova, aby byl jednoznačný.
- U HTML neměň značky, atributy ani URL — opravuj jen textový obsah mezi značkami.
- Když není co opravit, vrať prázdné suggestions: [].`;

export function buildSystemMessage(promptBody: string): string {
  return `${promptBody.trim()}\n\n${OUTPUT_CONTRACT}`;
}

export function buildUserMessage(payload: ProofreadUserPayload): string {
  return JSON.stringify({
    mode: payload.mode,
    title: payload.title,
    bodyHtml: payload.bodyHtml,
  });
}
