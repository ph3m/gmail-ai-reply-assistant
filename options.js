/**
 * options.js
 * Handles saving and loading the user's Gemini API key.
 * Storage: chrome.storage.sync — synced across the user's signed-in Chrome
 * instances, never written to disk in plaintext source, never committed.
 */

'use strict';

const apiKeyInput = document.getElementById('apiKey');
const saveBtn      = document.getElementById('saveBtn');
const statusEl     = document.getElementById('status');

/** Pre-fill the input with any previously saved key on page load. */
async function loadSavedKey() {
  const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
  if (geminiApiKey) {
    apiKeyInput.value = geminiApiKey;
  }
}

/** Persist the entered key and show a brief confirmation message. */
async function saveKey() {
  const key = apiKeyInput.value.trim();

  if (!key) {
    showStatus('Please enter a valid API key.', 'error');
    return;
  }

  try {
    await chrome.storage.sync.set({ geminiApiKey: key });
    showStatus('Saved! You can close this tab.', 'success');
  } catch (err) {
    console.error('[Options] Failed to save key:', err);
    showStatus('Failed to save — please try again.', 'error');
  }
}

function showStatus(message, type) {
  statusEl.textContent = message;
  statusEl.className   = `status ${type}`;
  setTimeout(() => {
    statusEl.textContent = '';
    statusEl.className   = 'status';
  }, 3000);
}

saveBtn.addEventListener('click', saveKey);
document.addEventListener('DOMContentLoaded', loadSavedKey);
