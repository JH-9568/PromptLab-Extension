const STORAGE_USER_ID_KEY = 'promptlab_user_id';
const SERVER_URL = 'https://promptlab-server.onrender.com';

function i18n(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions) || key;
}

function localizeDocument() {
  document.documentElement.lang = chrome.i18n.getUILanguage?.() || 'en';
  document.querySelectorAll('[data-i18n]').forEach((element) => {
    const message = i18n(element.dataset.i18n);
    if (message) element.textContent = message;
  });
}

function createId(prefix) {
  const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}_${id}`;
}

chrome.storage.local.get([STORAGE_USER_ID_KEY], (result) => {
  const existingUserId = result[STORAGE_USER_ID_KEY];
  const userId = existingUserId || createId('anon');

  if (!existingUserId) {
    chrome.storage.local.set({ [STORAGE_USER_ID_KEY]: userId });
  }

  document.querySelector('#user-id').textContent = userId;
});

async function checkServerStatus() {
  const status = document.querySelector('#server-status');
  if (!status) return;

  try {
    const response = await fetch(`${SERVER_URL}/health`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    status.textContent = i18n('connected');
    status.classList.add('is-ok');
    status.classList.remove('is-error');
  } catch (error) {
    status.textContent = i18n('disconnected');
    status.classList.add('is-error');
    status.classList.remove('is-ok');
  }
}

localizeDocument();
checkServerStatus();
