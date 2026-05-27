# AI korektura — Stage 0 extension

Minimal Chrome/Edge (Manifest V3) extension whose only job is to **prove the
extension can read the CMS article editor**. It adds a floating "AI korektura"
button on `https://cms.echomedia.cz/*`; clicking it opens a right-side sidebar
that loads the current article's **title** and **body text** (read via the
CKEditor API, with an iframe-DOM fallback).

No backend, no auth, no write-back — those come in later stages.

## Load unpacked

**Chrome:** open `chrome://extensions` → toggle **Developer mode** (top right)
→ **Load unpacked** → select this `extension/` folder.

**Edge:** open `edge://extensions` → enable **Developer mode** (left) →
**Load unpacked** → select this `extension/` folder.

No build step is required.

## Try it

1. Open an article in the CMS, e.g.
   `https://cms.echomedia.cz/cmsAdmin/index.html#/editorial/articles/edit/echo24cz/<id>`.
2. Wait for the editor to finish loading; the **AI korektura** button appears
   top-right.
3. Click it. The sidebar shows the read source (CKEditor API or fallback), the
   CKEditor instance name, the article title, the body text, and the raw HTML
   (collapsible). Seeing real text confirms read access works.

## Files

- `manifest.json` — MV3 manifest; runs only on the CMS host.
- `content.js` — isolated-world content script: editor detection across the
  AngularJS hash-routed SPA, floating button + sidebar, title read, body read.
- `bridge.js` — injected into the page's JS world so it can reach
  `window.CKEDITOR`; answers read requests over `window.postMessage`.
- `content.css` — styles for the button and sidebar.

This folder is excluded from Vercel via the repo-root `.vercelignore`.
