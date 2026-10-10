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
  document.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.placeholder = i18n(element.dataset.i18nPlaceholder);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((element) => {
    element.setAttribute('aria-label', i18n(element.dataset.i18nAria));
  });
}

function setSettingsStatus(key, isError = false) {
  const status = document.querySelector('#settings-status');
  status.textContent = i18n(key);
  status.classList.toggle('is-error', isError);
}

async function initializeRewriteSettings() {
  const form = document.querySelector('#preferences-form');
  const editor = document.querySelector('#custom-instructions');
  const toggle = document.querySelector('#instructions-enabled');
  const save = document.querySelector('#save-preferences');
  const modes = [...document.querySelectorAll('[name="rewrite-mode"]')];
  let settings;
  let saving = false;
  const updateDraft = () => {
    document.querySelector('#instructions-count').textContent = `${editor.value.length} / ${PromptLabSettings.maxInstructionsLength}`;
    save.disabled = saving || editor.value.trim() === settings.instructions;
  };
  const updateMode = () => {
    modes.forEach((input) => { input.checked = input.value === settings.mode; });
    const key = `mode${settings.mode[0].toUpperCase()}${settings.mode.slice(1)}Description`;
    document.querySelector('#mode-description').textContent = i18n(key);
  };
  const persist = async (next) => {
    saving = true;
    toggle.disabled = true;
    modes.forEach((input) => { input.disabled = true; });
    updateDraft();
    try {
      await chrome.storage.local.set({ [PromptLabSettings.storageKey]: next });
      settings = next;
      setSettingsStatus(editor.value.trim() === settings.instructions ? 'settingsSaved' : 'unsavedPreferences');
    } finally {
      saving = false;
      toggle.disabled = false;
      modes.forEach((input) => { input.disabled = false; });
      updateDraft();
    }
  };
  try {
    const stored = await chrome.storage.local.get([PromptLabSettings.storageKey]);
    settings = PromptLabSettings.normalize(stored[PromptLabSettings.storageKey]);
    editor.value = settings.instructions;
    toggle.checked = settings.instructionsEnabled;
    updateMode();
    editor.disabled = false;
    toggle.disabled = false;
    modes.forEach((input) => { input.disabled = false; });
    updateDraft();
  } catch {
    setSettingsStatus('settingsSaveError', true);
    return;
  }
  modes.forEach((input) => input.addEventListener('change', async () => {
    modes.forEach((mode) => { mode.disabled = true; });
    try { await persist({ ...settings, mode: input.value }); }
    catch { setSettingsStatus('settingsSaveError', true); }
    updateMode();
    modes.forEach((mode) => { mode.disabled = false; });
  }));
  toggle.addEventListener('change', async () => {
    toggle.disabled = true;
    try { await persist({ ...settings, instructionsEnabled: toggle.checked }); }
    catch { setSettingsStatus('settingsSaveError', true); }
    toggle.checked = settings.instructionsEnabled;
    toggle.disabled = false;
  });
  editor.addEventListener('input', () => {
    updateDraft();
    setSettingsStatus(editor.value.trim() === settings.instructions ? 'settingsSaved' : 'unsavedPreferences');
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (saving || save.disabled) return;
    saving = true;
    editor.disabled = true;
    toggle.disabled = true;
    modes.forEach((mode) => { mode.disabled = true; });
    updateDraft();
    const instructions = editor.value.trim();
    try {
      await persist({ ...settings, instructions, instructionsEnabled: Boolean(instructions) });
      editor.value = settings.instructions;
      toggle.checked = settings.instructionsEnabled;
    } catch { setSettingsStatus('settingsSaveError', true); }
    finally {
      saving = false;
      editor.disabled = false;
      toggle.disabled = false;
      modes.forEach((mode) => { mode.disabled = false; });
      updateDraft();
    }
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
initializeRewriteSettings();
checkServerStatus();
