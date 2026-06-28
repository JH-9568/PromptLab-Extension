const STORAGE_USER_ID_KEY = 'promptlab_user_id';
const STORAGE_BORDER_COLOR_KEY = 'promptlab_border_color';
const DEFAULT_BORDER_COLOR = 'purple';
const BORDER_COLORS = new Set([
  'purple', 'blue', 'green', 'orange', 'pink',
  'red', 'teal', 'yellow', 'indigo', 'gray'
]);
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

function setSelectedBorderColor(color) {
  const selectedColor = BORDER_COLORS.has(color) ? color : DEFAULT_BORDER_COLOR;
  const selectedLabel = i18n(`color${selectedColor[0].toUpperCase()}${selectedColor.slice(1)}`);
  const selectedColorOutput = document.querySelector('#selected-color');
  if (selectedColorOutput) selectedColorOutput.textContent = selectedLabel;
  document.querySelectorAll('.color-swatch').forEach((button) => {
    const isSelected = button.dataset.color === selectedColor;
    button.classList.toggle('is-selected', isSelected);
    button.setAttribute('aria-pressed', String(isSelected));
  });
}

function initializeBorderColorSetting() {
  document.querySelectorAll('.color-swatch').forEach((button) => {
    const label = i18n(button.dataset.colorI18n);
    button.setAttribute('aria-label', label);
    button.title = label;
    button.addEventListener('click', () => {
      const color = BORDER_COLORS.has(button.dataset.color) ? button.dataset.color : DEFAULT_BORDER_COLOR;
      setSelectedBorderColor(color);
      chrome.storage.local.set({ [STORAGE_BORDER_COLOR_KEY]: color });
    });
  });

  chrome.storage.local.get([STORAGE_BORDER_COLOR_KEY], (result) => {
    setSelectedBorderColor(result[STORAGE_BORDER_COLOR_KEY] || DEFAULT_BORDER_COLOR);
  });
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
initializeBorderColorSetting();
checkServerStatus();
