# ✨ Gmail AI Reply Assistant

A Chrome extension (Manifest V3) that adds a one-click **AI Reply** button directly inside Gmail's compose toolbar. It reads the current email thread, generates a context-aware reply using **Google Gemini 2.5 Flash**, and inserts it straight into the compose box — no copy-pasting, no separate app.

![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue) ![JavaScript](https://img.shields.io/badge/JavaScript-Vanilla-yellow) ![Gemini](https://img.shields.io/badge/AI-Gemini%202.5%20Flash-orange) ![License](https://img.shields.io/badge/license-MIT-green)

---

## Demo

> _Add a screenshot or short GIF here — e.g. `docs/demo.gif` showing the button appearing in a reply window and inserting generated text._

```
docs/
  demo.gif
  screenshot-button.png
```

## How it works

1. A `MutationObserver` watches the Gmail DOM for new compose/reply windows (detected by the formatting toolbar, `.gU.Up`).
2. When one opens, an **✨ AI Reply** button is injected once — a `WeakSet` guard prevents duplicate buttons across multiple open/close cycles.
3. On click, the extension scrapes the visible email thread (`.a3s.aiL` message bodies) for context.
4. That context is sent directly to the **Gemini 2.5 Flash** API (`generateContent` endpoint) with a prompt instructing the model to return a ready-to-send reply body.
5. The response is inserted into Gmail's `contenteditable` editor using `document.execCommand('insertText')`, which preserves Gmail's native undo stack and autosave behavior — unlike a raw `innerText` assignment.

No backend server is required. The API call goes straight from the browser to Google's API using a key stored in `chrome.storage.sync`.

## Features

- Zero-backend architecture — works entirely client-side
- Robust against Gmail's dynamic, SPA-style DOM (multiple compose windows, pop-outs, inline replies)
- Button states for loading (`Thinking…`) and failure (`Error — retry?`) with auto-reset
- API key managed through a proper Options page — never hardcoded in source
- Styled to match Gmail's native toolbar (Google Sans font, matching colors and spacing)

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Extension platform | Chrome Manifest V3 | Current standard; service-worker-based, stricter CSP |
| DOM integration | Vanilla JS content script + `MutationObserver` | No framework overhead; Gmail's DOM changes are observer-driven by nature |
| AI provider | Gemini 2.5 Flash | Fast, generous free tier, strong instruction-following for short-form text |
| Key storage | `chrome.storage.sync` | Synced across devices, isolated from source code, no plaintext config files |

## Setup

1. **Clone the repo**
   ```bash
   git clone https://github.com/<your-username>/gmail-ai-reply-assistant.git
   cd gmail-ai-reply-assistant
   ```

2. **Load it into Chrome**
   - Go to `chrome://extensions`
   - Enable **Developer mode** (top-right toggle)
   - Click **Load unpacked** → select this folder

3. **Add your Gemini API key**
   - Get a free key at [Google AI Studio](https://aistudio.google.com/app/apikey)
   - Click the extension icon in Chrome's toolbar → **Options** (or right-click the extension → Options)
   - Paste the key and click **Save**

4. **Use it**
   - Open [Gmail](https://mail.google.com), open any email, click **Reply**
   - Click **✨ AI Reply** in the formatting toolbar

## Project structure

```
gmail-ai-reply-assistant/
├── manifest.json      # MV3 manifest: permissions, content script registration
├── content.js         # MutationObserver, scraper, Gemini API call, text insertion
├── options.html        # Settings page UI for entering the API key
├── options.js          # Saves/loads the key via chrome.storage.sync
├── icons/               # Extension icons (16/48/128px)
├── LICENSE
└── README.md
```

## Known limitations

- Gmail's class names (`.gU.Up`, `.a3s.aiL`, `.Am.Al.editable`) are stable but undocumented and could change in a future Gmail redesign. The extension is built to fail gracefully (logs a warning, no crash) if a selector stops matching.
- `document.execCommand` is deprecated in the web standards spec, though still fully supported in Chrome. It remains the most reliable way to trigger Gmail's internal change-detection; a future version could migrate to the newer `Selection`/`Range` APIs combined with manual `InputEvent` dispatching if Chrome ever removes it.
- The Gemini API key is stored client-side. For a multi-user/production deployment, route requests through a backend proxy so the key is never exposed to the browser at all.

## Roadmap

- [ ] Tone/length selector (e.g. "Casual", "Formal", "Brief") before generating
- [ ] Inline streaming of the response as it's generated, instead of waiting for the full reply
- [ ] Support for Outlook Web / other webmail clients via a shared scraping interface

## License

MIT — see [LICENSE](LICENSE).
