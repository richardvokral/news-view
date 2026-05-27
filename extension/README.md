# AI korektura — extension (Stage 1)

Chrome/Edge (Manifest V3) extension that proofreads Czech CMS articles. It adds
a floating "AI korektura" button on `https://cms.echomedia.cz/*`; the sidebar
lets a logged-in redaktor run an AI check on the article title/body, review the
suggestions (per-suggestion accept/reject **and** a whole-text insert), and
write the approved text back into the CKEditor so the CMS can save it.

The backend lives in this same repo (Next.js). The extension authenticates by
**email only** (a password field will be added in a later stage) and stores a
bearer token; all network calls go through the background service worker.

## Load unpacked

**Chrome:** `chrome://extensions` → enable **Developer mode** → **Load
unpacked** → select this `extension/` folder.

**Edge:** `edge://extensions` → enable **Developer mode** → **Load unpacked** →
select this `extension/` folder.

No build step is required.

## Use it

1. Open an article in the CMS, e.g.
   `https://cms.echomedia.cz/cmsAdmin/index.html#/editorial/articles/edit/echo24cz/<id>`.
2. Click **AI korektura** (top-right) to open the sidebar.
3. **Log in** with an email that has access to the project (the same access as
   the news-view app). On success a token is stored.
4. Pick a **mode** and which **fields** (titulek / tělo) to check, then
   **Zkontrolovat**.
5. Review: a word-level **diff** and a **list of suggestions** with checkboxes.
   - **Vložit vybrané** — writes back only the accepted suggestions.
   - **Vložit celou opravenou verzi** — writes back the full corrected text.
6. The text is inserted via the CKEditor API; **save the article in the CMS** as
   usual.

The backend URL defaults to `https://news-view.vercel.app`. To test against a
local server, open **Nastavení serveru** at the bottom of the sidebar and set it
to `http://localhost:3000`.

## Files

- `manifest.json` — MV3 manifest; content script on the CMS host, background
  service worker, and backend hosts in `host_permissions`.
- `background.js` — service worker: holds the token and makes all backend calls
  (login, proofread) cross-origin, avoiding CORS.
- `content.js` — isolated-world content script: editor detection across the
  AngularJS hash-routed SPA, the sidebar UI (auth, controls, diff, suggestions),
  and write-back.
- `bridge.js` — injected into the page's JS world to reach `window.CKEDITOR`;
  handles read (`GET_CKEDITOR_DATA`) and write (`SET_CKEDITOR_DATA`) and notifies
  AngularJS via the backing textarea.
- `content.css` — styles for the button and sidebar.

This folder is excluded from Vercel via the repo-root `.vercelignore`.
