# Proofread: AI Czech proofreading + Chrome extension

AI-assisted Czech copy editing inside the CMS. A Chrome/Edge MV3 extension (`extension/`) reads the article from the CKEditor-based CMS, sends it to `POST /api/proofread`, and lets the editor apply suggestions one by one. Backend config (models, prompts, per-user overrides, usage) is managed at `/admin/proofread`.

## Request flow

1. Editor clicks the floating **AI korektura** button in the CMS (`extension/content.js`, injected on `cms.echomedia.cz`).
2. The content script reads the title input and the CKEditor body (via `bridge.js`, which runs in the page JS world to reach `window.CKEDITOR`), and posts `{mode, articleId, sourceUrl, fields: {title?, bodyHtml?}}` through the background service worker (which holds the bearer token) to `POST /api/proofread`.
3. The route (`src/app/api/proofread/route.ts`, `maxDuration=300`):
   - Authenticates the bearer token (`requireExtensionUser`) and **re-checks ACL sections on every request** — revoking a user's access kills their token immediately — then applies the per-user hourly rate limit and the input-size cap.
   - Resolves config via `src/lib/proofread/router.ts`: mode → prompt (requested mode if it exists, else default mode); model → per-user override → system default → first enabled model.
   - Optionally runs the **Korektor (ÚFAL) pre-filter** (`korektor.ts`) per `proofread_settings.korektor_mode`: `sequential` (Korektor first, its fixes passed to the LLM as "don't repeat these" via `buildKorektorHint`), `parallel`, or `off`. Korektor failures never block the LLM — they degrade to a warning.
   - Calls the provider: `anthropic.ts` (forced tool-use `submit_proofread` for structured output, `max_tokens 8192`) or `openai.ts` (Structured Outputs `json_schema strict`, falling back to `json_object` on 400; `max_completion_tokens`, **no temperature** — gpt-5/o-series reject it).
   - Merges suggestions (`mergeSuggestions` — Korektor wins on overlap), records usage, returns suggestions. **The corrected text is never echoed back** (avoids timeouts on long articles); the extension reconstructs it client-side.
4. The extension shows per-suggestion checkboxes. A suggestion is applicable only if its `original` snippet matches the source **verbatim** (exact `indexOf`) — mismatches are shown disabled ("nelze najít v textu"), never applied. Write-back goes through the bridge (`editor.setData` + AngularJS change events); the editor still saves manually in the CMS.

Response shape: `{suggestions[], summary, warnings[], mode, korektor: {mode, count, acknowledgements}, usage: {provider, model, inputTokens, outputTokens, costUsd, costCzk}}`.

## Prompt architecture (`prompts.ts`)

- Three seeded Czech modes (`proofread_prompts` table): `pravopis_gramatika`, `pravopis_gramatika_interpunkce` (default), `jemna_stylistika`. Bodies are editable at `/admin/proofread/prompts`.
- Every prompt gets `OUTPUT_CONTRACT` appended: JSON-only output, one suggestion per error, `original` must be a verbatim 2–10 word snippet (the client-side exact-match apply depends on this), never touch HTML tags/attributes/URLs.
- `buildUserMessage` wraps content in `<article_title>`/`<article_body>` tags with explicit anti-prompt-injection instructions (article text is never to be treated as instructions).

## Auth (`auth.ts`)

- `POST /api/extension/login` — validates the e-mail has any ACL sections (`resolveSections`), then issues a 30-day bearer token: 32 random bytes base64url, stored **only as SHA-256 hash** in `proofread_sessions`.
  - ⚠️ **Set `EXTENSION_LOGIN_SECRET`.** Without it this endpoint is e-mail-only: anyone on the internet who knows (or guesses) a granted address gets a 30-day token to a paid LLM API. With it, login also requires a shared enrolment code (constant-time compared), which editors type once into the **Přístupový kód** field in the extension sidebar. Unset = the old behaviour, so nothing breaks on deploy — but the hole stays open. The `proofread_users` password columns remain the eventual per-user answer.
  - Rate-limited regardless: 10 attempts / 15 min per IP, 5 / h per e-mail (`src/lib/rate-limit.ts`). When the secret is configured, a wrong code and an unknown e-mail return the same message, so the endpoint can't be used to enumerate addresses.
- `GET /api/extension/me` — bearer; returns `{email, sections}`.
- `POST /api/proofread` — bearer; capped at 60 requests/h per user and 200 000 input characters per request, so a leaked token has a bounded cost.
- CORS (`cors.ts`): wildcard origin is intentional — bearer auth, no cookies.
- The extension stores `{token, email, expiresAt}` in `chrome.storage.local` (the enrolment code is never stored); backend base URL defaults to `https://news-view.vercel.app`, overridable in the sidebar's **Nastavení serveru** (e.g. `http://localhost:3000`).

## Configuration & data

All proofread config lives in **Postgres** (not Redis); only the provider API keys come from the shared `config:apis` settings blob (Redis, env fallback `ANTHROPIC_API_KEY`/`OPENAI_API_KEY`).

| Table | Purpose |
| --- | --- |
| `proofread_models` | Model catalog: key (`provider:model`), label, enabled, USD-per-Mtok prices, sort order. Seeded with gpt-4o-mini/gpt-4o/haiku-4.5/sonnet-4.6. |
| `proofread_prompts` | One system prompt per mode; single default mode. |
| `proofread_user_config` | Per-user model and/or prompt override. |
| `proofread_settings` | Singleton: default model key + Korektor mode/endpoint/model. |
| `proofread_sessions` | Extension bearer sessions (hashed). |
| `proofread_usage` | Per-request accounting: tokens, cost USD (`estimateCost`) and CZK (`USD_TO_CZK` env, default 23), status, article id/URL, input chars. **Article text is never stored.** |

Admin UI (`/admin/proofread/*`, admin-only): Models, Prompts, Per-user config, Korektor (incl. a live test endpoint `POST /api/admin/proofread/korektor/test` with a fixed misspelled sample), Usage (by user / by model / per request).

## Korektor licensing note

The hosted ÚFAL endpoint (`lindat.mff.cuni.cz/services/korektor/api`) and its CC BY-NC-SA models require a written agreement with ÚFAL for commercial use — which is why `korektor_mode` defaults to `off`. The endpoint URL is configurable for self-hosting.

## Gotchas

- The whole apply-mechanism depends on verbatim `original` snippets; models that paraphrase get their suggestions silently disabled in the UI.
- Korektor works on plain text (`htmlToText`); tokens spanning HTML tag boundaries degrade gracefully (suggestion won't match, gets disabled).
- The content script only runs in the top frame but is injected `all_frames` (no-ops inside the CKEditor iframe).
- Extension folder is excluded from Vercel deploys via `.vercelignore`; it's loaded unpacked (no build step). See `extension/README.md`.
- If the model returns a summary mentioning errors but zero suggestions, the UI hints to try another model/prompt.
