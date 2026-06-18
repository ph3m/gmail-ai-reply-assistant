/**
 * Gmail AI Reply Assistant — content.js
 * Manifest V3 content script.
 * AI Provider: Google Gemini 2.5 Flash (direct API call, no backend needed)
 *
 * Flow:
 *  1. A MutationObserver watches the document for new Gmail compose toolbars.
 *  2. When a reply/compose window opens (.gU.Up toolbar), inject "✨ AI Reply" once.
 *  3. On click:
 *       a. Scrape the email thread context from the DOM.
 *       b. POST directly to the Gemini 2.5 Flash API.
 *       c. Insert the generated reply into Gmail's contenteditable editor.
 */

'use strict';

/* ─────────────────────────────────────────────
   1.  CONFIGURATION
   ───────────────────────────────────────────── */

/**
 * The Gemini API key is never hardcoded in source.
 * Users enter it once via the extension's Options page (options.html),
 * and it's persisted in chrome.storage.sync (synced across their devices,
 * never committed to source control, never visible in this file).
 *
 * getApiKey() is called lazily on each button click so a freshly-saved
 * key works immediately without reloading Gmail.
 */
async function getApiKey() {
  const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
  return geminiApiKey || '';
}

/**
 * Gemini 2.5 Flash — generateContent endpoint.
 * Model string: gemini-2.5-flash (stable alias for the latest Flash 2.5 release).
 */
function buildGeminiUrl(apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
}

/* ─────────────────────────────────────────────
   2.  GMAIL DOM SELECTORS
   ───────────────────────────────────────────── */

/** Gmail's formatting toolbar inside every compose / reply window. */
const TOOLBAR_SELECTOR = '.gU.Up';

/**
 * Each rendered email body in the thread.
 * .a3s.aiL wraps the visible message text (one element per message).
 */
const THREAD_BODY_SELECTOR = '.a3s.aiL';

/**
 * Gmail's contenteditable compose area.
 * .Am.Al.editable is stable across Gmail versions.
 */
const EDITOR_SELECTOR = '.Am.Al.editable';

/* ─────────────────────────────────────────────
   3.  DUPLICATE-INJECTION GUARD
   ───────────────────────────────────────────── */

/**
 * WeakSet keyed on toolbar DOM nodes.
 * Entries are GC'd automatically when Gmail removes compose windows,
 * preventing memory leaks across many open/close cycles.
 */
const injectedToolbars = new WeakSet();

/* ─────────────────────────────────────────────
   4.  BUTTON FACTORY
   ───────────────────────────────────────────── */

/**
 * createAiButton()
 * Builds a pill button styled to match Gmail's native toolbar aesthetic.
 * Uses Google's brand blue (#1a73e8) and Google Sans font to blend in.
 *
 * @returns {HTMLButtonElement}
 */
function createAiButton() {
  const btn = document.createElement('button');
  btn.type        = 'button';
  btn.textContent = '✨ AI Reply';
  btn.setAttribute('aria-label', 'Generate AI reply with Gemini');
  btn.setAttribute('data-ai-reply-btn', '1');

  Object.assign(btn.style, {
    display       : 'inline-flex',
    alignItems    : 'center',
    gap           : '4px',
    margin        : '0 6px',
    padding       : '5px 12px',
    border        : '1px solid #dadce0',
    borderRadius  : '16px',
    background    : '#fff',
    color         : '#1a73e8',
    fontSize      : '13px',
    fontFamily    : 'Google Sans, Roboto, sans-serif',
    fontWeight    : '500',
    cursor        : 'pointer',
    userSelect    : 'none',
    transition    : 'background 0.15s, box-shadow 0.15s',
    verticalAlign : 'middle',
    lineHeight    : '20px',
    whiteSpace    : 'nowrap',
    outline       : 'none',
  });

  btn.addEventListener('mouseenter', () => {
    if (!btn.disabled) {
      btn.style.background = '#e8f0fe';
      btn.style.boxShadow  = '0 1px 3px rgba(0,0,0,.15)';
    }
  });
  btn.addEventListener('mouseleave', () => {
    btn.style.background = '#fff';
    btn.style.boxShadow  = 'none';
  });
  btn.addEventListener('focus', () => {
    btn.style.boxShadow = '0 0 0 2px rgba(26,115,232,.4)';
  });
  btn.addEventListener('blur', () => {
    btn.style.boxShadow = 'none';
  });

  return btn;
}

/* ─────────────────────────────────────────────
   5.  EMAIL THREAD SCRAPER
   ───────────────────────────────────────────── */

/**
 * scrapeThreadContext()
 * Collects the visible text of every email in the current thread.
 * Returns '' for standalone compose windows (no prior thread).
 *
 * @returns {string}
 */
function scrapeThreadContext() {
  // .a3s.aiL — one element per message bubble in the thread.
  // innerText gives clean text: respects <br> line breaks, strips HTML tags.
  const messageBodies = document.querySelectorAll(THREAD_BODY_SELECTOR);
  if (messageBodies.length === 0) return '';

  return Array.from(messageBodies)
    .map((el, i) => {
      const text = el.innerText.trim();
      return text ? `[Message ${i + 1}]\n${text}` : '';
    })
    .filter(Boolean)
    .join('\n\n---\n\n');
}

/* ─────────────────────────────────────────────
   6.  GEMINI 2.5 FLASH API CALL
   ───────────────────────────────────────────── */

/**
 * fetchGeminiReply(threadContext)
 * Calls the Gemini 2.5 Flash generateContent endpoint directly from the
 * browser (no backend proxy required for development/personal use).
 *
 * Request shape (Gemini REST API v1beta):
 *   POST /v1beta/models/gemini-2.5-flash:generateContent
 *   { contents: [{ parts: [{ text: "<prompt>" }] }] }
 *
 * Response shape:
 *   { candidates: [{ content: { parts: [{ text: "<reply>" }] } }] }
 *
 * @param  {string} threadContext  Scraped email thread text.
 * @returns {Promise<string>}      The generated reply text.
 */
async function fetchGeminiReply(threadContext) {
  const apiKey = await getApiKey();

  if (!apiKey) {
    throw new Error(
      'No Gemini API key set. Click the extension icon → Options to add your key.'
    );
  }

  // Build the prompt — give Gemini clear instructions plus the thread context.
  const prompt = threadContext
    ? `You are a professional email assistant. Read the email thread below and write a concise, polite, and helpful reply. Output the reply text only — no subject line, no "Here is a reply:" preamble, just the body text ready to send.\n\nEmail thread:\n\n${threadContext}`
    : `You are a professional email assistant. Write a polite, concise email body that the user can customise. Output only the body text, ready to send.`;

  const response = await fetch(buildGeminiUrl(apiKey), {
    method  : 'POST',
    headers : { 'Content-Type': 'application/json' },
    body    : JSON.stringify({
      contents: [
        {
          parts: [{ text: prompt }]
        }
      ],
      // Optional generation config — tune as needed.
      generationConfig: {
        temperature    : 0.7,   // balanced creativity vs. consistency
        maxOutputTokens: 1024,  // enough for a full email reply
      }
    }),
  });

  if (!response.ok) {
    const errBody = await response.text().catch(() => '');
    throw new Error(`Gemini API error ${response.status}: ${errBody}`);
  }

  const data = await response.json();

  // Navigate the Gemini response structure to extract the reply text.
  // candidates[0].content.parts[0].text is the primary output path.
  const replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!replyText) {
    // Surface finish reason if the model was blocked or hit a safety filter.
    const finishReason = data?.candidates?.[0]?.finishReason ?? 'unknown';
    throw new Error(`Gemini returned no text. finishReason: ${finishReason}`);
  }

  return replyText.trim();
}

/* ─────────────────────────────────────────────
   7.  TEXT INSERTION INTO GMAIL EDITOR
   ───────────────────────────────────────────── */

/**
 * insertTextIntoEditor(text)
 * Locates the active Gmail contenteditable div and inserts text at the caret.
 *
 * Why execCommand('insertText')?
 *   Gmail hooks into browser input events to power its Undo stack, send-button
 *   state, and autosave. A raw `innerText =` assignment bypasses all of that.
 *   execCommand fires the correct InputEvent chain, keeping Gmail's internals
 *   happy. It is deprecated in the spec but universally supported in Chrome.
 *
 * @param {string} text
 * @returns {boolean} true if insertion succeeded
 */
function insertTextIntoEditor(text) {
  // .Am.Al.editable — Gmail's compose editor contenteditable div.
  const editors = document.querySelectorAll(EDITOR_SELECTOR);
  if (editors.length === 0) {
    console.warn('[AI Reply] No compose editor found on page.');
    return false;
  }

  // Prefer the editor inside the focused compose pane (.I5 = active pane).
  // Falls back to the last editor in DOM order (most recently opened compose).
  let target = null;
  for (const ed of editors) {
    if (ed.closest('.I5')) { target = ed; break; }
  }
  if (!target) target = editors[editors.length - 1];

  // Focus the editor so execCommand operates in the right browsing context.
  target.focus();

  // Collapse selection to end of content so the reply is appended cleanly.
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0 && sel.getRangeAt(0).collapsed) {
    const range = document.createRange();
    range.selectNodeContents(target);
    range.collapse(false); // false = end of content
    sel.removeAllRanges();
    sel.addRange(range);
  }

  // Primary insertion path: triggers Gmail's native event listeners.
  const success = document.execCommand('insertText', false, text);

  if (!success) {
    // Fallback: direct DOM write + synthetic InputEvent.
    // Gmail's undo history won't include this edit, but the text appears.
    console.warn('[AI Reply] execCommand failed — using direct insertion fallback.');
    target.textContent += text;
    target.dispatchEvent(new InputEvent('input', { bubbles: true }));
  }

  return true;
}

/* ─────────────────────────────────────────────
   8.  BUTTON CLICK HANDLER
   ───────────────────────────────────────────── */

/**
 * handleAiReplyClick(btn)
 * Full async flow: scrape → Gemini → insert.
 * Manages button UI states throughout (loading, error, reset).
 *
 * @param {HTMLButtonElement} btn
 */
async function handleAiReplyClick(btn) {
  // Disable immediately to block double-clicks during the async fetch.
  btn.disabled         = true;
  btn.textContent      = '⏳ Thinking…';
  btn.style.color      = '#80868b';
  btn.style.cursor     = 'not-allowed';
  btn.style.background = '#f1f3f4';

  try {
    const context = scrapeThreadContext();
    const reply   = await fetchGeminiReply(context);
    insertTextIntoEditor(reply);
  } catch (err) {
    console.error('[AI Reply] Gemini request failed:', err);
    btn.textContent = '⚠️ Error — retry?';
    btn.style.color = '#d93025';
  } finally {
    // Re-enable button after a short pause so the user can see the result.
    setTimeout(() => {
      btn.disabled         = false;
      btn.textContent      = '✨ AI Reply';
      btn.style.color      = '#1a73e8';
      btn.style.cursor     = 'pointer';
      btn.style.background = '#fff';
    }, 2500);
  }
}

/* ─────────────────────────────────────────────
   9.  TOOLBAR INJECTION
   ───────────────────────────────────────────── */

/**
 * tryInjectButton(toolbar)
 * Appends the AI Reply button to a toolbar element.
 * The WeakSet guard ensures each toolbar receives exactly one button,
 * even if the MutationObserver fires multiple times for the same node.
 *
 * @param {Element} toolbar
 */
function tryInjectButton(toolbar) {
  if (injectedToolbars.has(toolbar)) return;
  injectedToolbars.add(toolbar);

  const btn = createAiButton();
  btn.addEventListener('click', () => handleAiReplyClick(btn));

  toolbar.appendChild(btn);
  console.debug('[AI Reply] Button injected into toolbar:', toolbar);
}

/* ─────────────────────────────────────────────
   10.  MUTATION OBSERVER
   ───────────────────────────────────────────── */

/**
 * startObserver()
 * Watches document.body for newly inserted Gmail compose toolbars.
 *
 * We must observe the whole body (not a specific container) because Gmail
 * mounts compose windows at different DOM positions depending on context:
 * inline reply, pop-out window, or new-message dialog.
 */
function startObserver() {
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;

        // The added node itself might be the toolbar.
        if (node.matches?.(TOOLBAR_SELECTOR)) {
          tryInjectButton(node);
        }

        // Or the toolbar might be deeper inside a larger subtree insertion.
        for (const toolbar of node.querySelectorAll?.(TOOLBAR_SELECTOR) ?? []) {
          tryInjectButton(toolbar);
        }
      }
    }
  });

  observer.observe(document.body, {
    childList : true, // detect direct children being added
    subtree   : true, // …and all descendants (Gmail's DOM is deeply nested)
  });

  console.debug('[AI Reply] MutationObserver active — watching for compose windows.');

  // Catch toolbars that already existed before the observer attached
  // (handles extension reload with a compose window already open).
  for (const toolbar of document.querySelectorAll(TOOLBAR_SELECTOR)) {
    tryInjectButton(toolbar);
  }
}

/* ─────────────────────────────────────────────
   11.  ENTRY POINT
   ───────────────────────────────────────────── */

// manifest.json sets run_at: "document_idle", so the DOM is parsed.
// Gmail's compose UI is rendered later via JS — the observer handles that.
startObserver();
