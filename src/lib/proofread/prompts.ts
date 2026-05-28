import type { ProofreadUserPayload } from "./types";

const OUTPUT_CONTRACT = `Vrať POUZE strukturovaná data:
- "suggestions": pole NEZÁVISLÝCH oprav; KAŽDÁ chyba je SAMOSTATNÁ položka { "field": "title" nebo "body", "type": typ chyby (např. "pravopis", "interpunkce", "gramatika"), "original": KRÁTKÝ úryvek doslova z původního textu obsahující chybu (typicky 2–10 slov, MUSÍ být znak po znaku totožný s textem, žádná parafráze), "replacement": stejný úryvek s opravou, "explanation": stručné vysvětlení česky, "confidence": 0..1 }
- "summary": jednovětné česky shrnutí (kolik chyb a jakého typu); NEPOPISUJ v něm jednotlivé opravy
- "warnings": pole varování (nejistá místa), může být prázdné

Pravidla:
- Každou JEDNOTLIVOU chybu uveď jako SAMOSTATNOU položku v "suggestions" — nikdy nesdružuj víc chyb do jedné položky ani do "summary".
- "original" MUSÍ být doslovný úryvek z původního textu. Klient ho vyhledá pomocí přesné shody řetězce, takže parafráze, přidaná interpunkce nebo přepis selžou.
- Drž "original" krátký — pouze okolí chyby, ne celá věta a už vůbec ne celý odstavec.
- Pokud se stejná chyba opakuje, vrať každý výskyt jako samostatnou položku (nebo přidej víc okolního kontextu, aby byla "original" jednoznačná).
- U HTML neměň značky ani atributy — opravuj jen textový obsah.
- Pokud není co opravit, vrať "suggestions": [].`;

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
