import type { ProofreadUserPayload } from "./types";

const OUTPUT_CONTRACT = `Vrať POUZE strukturovaná data s těmito poli:
- "title": opravený titulek (string), nebo vynech, pokud titulek nebyl zadán
- "bodyHtml": kompletní opravené HTML těla (string), nebo vynech, pokud tělo nebylo zadáno
- "suggestions": pole změn; každá { "field": "title" nebo "body", "type": krátký typ chyby, "original": původní úsek, "replacement": opravený úsek, "explanation": česky proč, "confidence": číslo 0..1 }
- "summary": jednovětné shrnutí česky
- "warnings": pole varování (nejistá místa), může být prázdné

PRAVIDLA PRO HTML (důležité):
- Nepřidávej, neodebírej ani nepřeskupuj HTML značky ani atributy.
- Uvnitř značek (atributy, URL, třídy, id) nic neměň.
- Oprav pouze textový obsah mezi značkami. Zachovej mezery a entity (např. &nbsp;).
- "bodyHtml" musí být kompletní opravené HTML, ne jen úryvek.`;

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
