(() => {
  const SERVER_URL = 'https://promptlab-server.onrender.com';
  const STORAGE_USER_ID_KEY = 'promptlab_user_id';
  const STORAGE_BORDER_COLOR_KEY = 'promptlab_border_color';
  const DEFAULT_BORDER_COLOR = 'purple';
  const BORDER_COLOR_PALETTE = {
    purple: { accent: '168, 85, 247', light: '216, 180, 254', dark: '88, 28, 135' },
    blue: { accent: '59, 130, 246', light: '147, 197, 253', dark: '30, 64, 175' },
    green: { accent: '16, 185, 129', light: '110, 231, 183', dark: '4, 120, 87' },
    orange: { accent: '249, 115, 22', light: '253, 186, 116', dark: '194, 65, 12' },
    pink: { accent: '236, 72, 153', light: '249, 168, 212', dark: '157, 23, 77' },
    red: { accent: '239, 68, 68', light: '252, 165, 165', dark: '185, 28, 28' },
    teal: { accent: '20, 184, 166', light: '94, 234, 212', dark: '15, 118, 110' },
    yellow: { accent: '234, 179, 8', light: '253, 224, 71', dark: '161, 98, 7' },
    indigo: { accent: '99, 102, 241', light: '165, 180, 252', dark: '67, 56, 202' },
    gray: { accent: '113, 113, 122', light: '212, 212, 216', dark: '63, 63, 70' }
  };
  const PLATFORM_CONFIG = {
    chatgpt: {
      hosts: ['chatgpt.com', 'chat.openai.com'],
      inputSelectors: [
        '#prompt-textarea',
        '[data-testid="prompt-textarea"]',
        'textarea',
        'div[contenteditable="true"]',
        '[role="textbox"]',
        '.ProseMirror'
      ],
      assistantSelectors: ['[data-message-author-role="assistant"]']
    },
    gemini: {
      hosts: ['gemini.google.com'],
      inputSelectors: [
        'rich-textarea [contenteditable="true"]',
        'rich-textarea',
        '[aria-label*="prompt" i]',
        '[aria-label*="message" i]',
        '[aria-label*="Ask" i]',
        'div[contenteditable="true"]',
        '[role="textbox"]',
        'textarea'
      ],
      assistantSelectors: [
        'message-content',
        '[data-response-index]',
        '.model-response-text',
        '.response-container'
      ]
    },
    claude: {
      hosts: ['claude.ai'],
      inputSelectors: [
        '[contenteditable="true"].ProseMirror',
        '.ProseMirror',
        '[data-testid*="chat" i] [contenteditable="true"]',
        'div[contenteditable="true"]',
        '[role="textbox"]',
        'textarea'
      ],
      assistantSelectors: [
        '[data-testid="message-content"]',
        '[data-testid*="message" i]',
        '.font-claude-message',
        '.prose'
      ]
    }
  };
  const DEFAULT_PLATFORM_CONFIG = {
    inputSelectors: [
      'textarea',
      'div[contenteditable="true"]',
      '[role="textbox"]',
      '.ProseMirror'
    ],
    assistantSelectors: [
      '[data-message-author-role="assistant"]',
      'message-content',
      '[data-testid="message-content"]',
      '.prose'
    ]
  };
  const DEFAULT_TASK_CATEGORY = 'etc';
  const TARGET_PLATFORM = detectTargetPlatform();
  const CLIENT_LANGUAGE = navigator.languages?.[0] || navigator.language || 'en';
  const IS_MAC = /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent || '');
  const i18n = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;
  const UI_TEXT = {
    inputNotFound: i18n('inputNotFound'),
    noImprovedPrompt: i18n('noImprovedPrompt'),
    emptyResult: i18n('emptyResult'),
    improvedPromptLabel: i18n('improvedPromptLabel'),
    busy: i18n('busy'),
    improveButton: i18n('improveButton'),
    improveAvailable: i18n('improveAvailable'),
    openPromptLab: i18n('openPromptLab'),
    noPrompt: i18n('noPrompt'),
    improving: i18n('improving'),
    ready: i18n('ready'),
    serverError: i18n('serverError'),
    analyzeFirst: i18n('analyzeFirst'),
    logError: i18n('logError'),
    subtitle: i18n('subtitle'),
    currentPrompt: i18n('currentPrompt'),
    reloadCurrentPrompt: i18n('reloadCurrentPrompt'),
    insertImproved: i18n('insertImproved'),
    keepOriginal: i18n('keepOriginal'),
    shortcutHint: i18n('shortcutHint', [getShortcutLabel()]),
    undoImprovement: i18n('undoImprovement'),
    improvedApplied: i18n('improvedApplied')
  };

  function detectTargetPlatform() {
    const host = window.location.hostname;
    const entry = Object.entries(PLATFORM_CONFIG).find(([, config]) => (
      config.hosts.some((allowedHost) => host === allowedHost || host.endsWith(`.${allowedHost}`))
    ));

    return entry?.[0] || 'unknown';
  }

  function getPlatformConfig() {
    return PLATFORM_CONFIG[TARGET_PLATFORM] || DEFAULT_PLATFORM_CONFIG;
  }

  let state = {
    isOpen: false,
    userId: null,
    sessionId: null,
    originalPrompt: '',
    improvedPrompt: '',
    taskCategory: DEFAULT_TASK_CATEGORY,
    response: null,
    usedImproved: null,
    assistantMessageBaseline: 0,
    assistantTextBaseline: '',
    answerLastSnapshot: '',
    answerStableSince: 0,
    activePrompt: '',
    answerCheckTimer: null,
    answerCheckStartedAt: 0,
    promptWatchTimer: null,
    answerObserver: null,
    inlineImproving: false,
    overlayVisible: false,
    undoTimer: null,
    promptUpdateRaf: null,
    promptActivityListenersBound: false,
    borderColor: DEFAULT_BORDER_COLOR,
    overlayTarget: null,
    overlayObservedTarget: null,
    overlayResizeObserver: null,
    overlaySettleRaf: null
  };

  function getShortcutLabel() {
    return IS_MAC ? 'Command+Shift+.' : 'Ctrl+Shift+.';
  }

  function createId(prefix) {
    const id = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    return `${prefix}_${id}`;
  }

  function getStoredUserId() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_USER_ID_KEY], (result) => {
        if (result[STORAGE_USER_ID_KEY]) {
          resolve(result[STORAGE_USER_ID_KEY]);
          return;
        }

        const userId = createId('anon');
        chrome.storage.local.set({ [STORAGE_USER_ID_KEY]: userId }, () => resolve(userId));
      });
    });
  }

  function getStoredBorderColor() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_BORDER_COLOR_KEY], (result) => {
        const color = result[STORAGE_BORDER_COLOR_KEY];
        resolve(BORDER_COLOR_PALETTE[color] ? color : DEFAULT_BORDER_COLOR);
      });
    });
  }

  function applyBorderColor(color) {
    const selectedColor = BORDER_COLOR_PALETTE[color] ? color : DEFAULT_BORDER_COLOR;
    const palette = BORDER_COLOR_PALETTE[selectedColor];
    state.borderColor = selectedColor;

    const root = document.querySelector('#promptlab-root');
    if (!root) return;
    root.style.setProperty('--promptlab-accent-rgb', palette.accent);
    root.style.setProperty('--promptlab-accent-light-rgb', palette.light);
    root.style.setProperty('--promptlab-accent-dark-rgb', palette.dark);
  }

  async function sha256(text) {
    const data = new TextEncoder().encode(text || '');
    const digest = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('');
  }

  function findPromptInput() {
    for (const selector of getPlatformConfig().inputSelectors) {
      const candidates = Array.from(document.querySelectorAll(selector)).filter((element) => {
        if (element.closest('#promptlab-root')) return false;
        if (element.disabled || element.readOnly || element.getAttribute('aria-disabled') === 'true') return false;

        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 40 && rect.height > 20 && style.visibility !== 'hidden' && style.display !== 'none';
      });

      if (candidates.length > 0) {
        return candidates[candidates.length - 1];
      }
    }

    return null;
  }

  function getAssistantMessages() {
    const seen = new Set();
    const messages = [];

    for (const selector of getPlatformConfig().assistantSelectors) {
      document.querySelectorAll(selector).forEach((element) => {
        if (seen.has(element)) return;
        if (element.closest('#promptlab-root')) return;
        const text = (element.innerText || element.textContent || '').trim();
        if (!text) return;

        seen.add(element);
        messages.push(element);
      });
    }

    return messages;
  }

  function getAssistantMessageCount() {
    return getAssistantMessages().length;
  }

  function getAssistantTextSnapshot() {
    return getAssistantMessages()
      .map((element) => (element.innerText || element.textContent || '').trim())
      .join('\n---promptlab-message---\n');
  }

  function hasNewAssistantAnswer() {
    return (
      getAssistantMessageCount() > state.assistantMessageBaseline
      || getAssistantTextSnapshot() !== state.assistantTextBaseline
    );
  }

  function getEditableTarget(input) {
    if (!input) return null;
    if ('value' in input) return input;
    if (input.isContentEditable) return input;
    return input.querySelector('[contenteditable="true"], .ProseMirror, [role="textbox"]') || input;
  }

  function getPromptText(input) {
    if (!input) return '';
    if ('value' in input) return input.value.trim();
    return (input.innerText || input.textContent || '').trim();
  }

  function getPromptComposer(input) {
    if (!input) return document.body;
    return input.closest('form, [role="form"], main, [data-testid*="composer" i], [class*="composer" i]')
      || input.parentElement
      || document.body;
  }

  function getPromptOverlayTarget(input) {
    if (!input) return null;

    const editable = getEditableTarget(input);
    const editableRect = (editable || input).getBoundingClientRect();
    const namedFrame = input.closest('form, [role="form"], [data-testid*="composer" i], [class*="composer" i], rich-textarea');
    const candidates = [];

    if (namedFrame) candidates.push(namedFrame);
    if (editable) candidates.push(editable);
    candidates.push(input);

    let ancestor = editable || input;
    for (let depth = 0; ancestor && ancestor !== document.body && depth < 9; depth += 1) {
      candidates.push(ancestor);
      ancestor = ancestor.parentElement;
    }

    const uniqueCandidates = Array.from(new Set(candidates)).filter(Boolean);
    const maxHeight = Math.max(170, editableRect.height * 1.85);
    let bestTarget = editable || input;
    let bestScore = 0;

    for (const candidate of uniqueCandidates) {
      const rect = candidate.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      if (rect.height > maxHeight || rect.height < editableRect.height * 0.55) continue;
      if (rect.width < editableRect.width * 0.92) continue;
      if (rect.width > window.innerWidth - 8) continue;
      if (rect.top > editableRect.top + 28 || rect.bottom < editableRect.bottom - 18) continue;
      if (Math.abs(rect.bottom - editableRect.bottom) > 92) continue;

      const style = window.getComputedStyle(candidate);
      if (style.visibility === 'hidden' || style.display === 'none') continue;

      const widthGain = rect.width - editableRect.width;
      const heightPenalty = Math.max(0, rect.height - editableRect.height) * 0.5;
      const semanticBonus = /form|composer|rich-textarea/i.test(`${candidate.tagName} ${candidate.className} ${candidate.getAttribute('data-testid') || ''}`) ? 160 : 0;
      const score = rect.width + widthGain + semanticBonus - heightPenalty;

      if (score > bestScore) {
        bestScore = score;
        bestTarget = candidate;
      }
    }

    return bestTarget;
  }

  function isVisibleElement(element) {
    if (!element || element.closest('#promptlab-root')) return false;
    const rect = element.getBoundingClientRect();
    const style = window.getComputedStyle(element);
    return rect.width > 0 && rect.height > 0 && style.visibility !== 'hidden' && style.display !== 'none';
  }

  function looksLikeAttachmentElement(element) {
    const signature = [
      element.getAttribute('data-testid'),
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.className,
      element.innerText || element.textContent
    ].join(' ').toLowerCase();

    if (/attach( file|ment)?|파일 첨부|첨부하기|upload/.test(signature)
      && !/remove|delete|삭제|uploaded|thumbnail|preview/.test(signature)) {
      return false;
    }

    return /file-thumbnail|file-preview|attachment-preview|uploaded-file|data-file-id/.test(signature)
      || /(remove|delete|삭제).*(file|attachment|첨부|파일)/.test(signature)
      || /\.(pdf|docx?|xlsx?|pptx?|csv|txt|md|json|png|jpe?g|webp)\b/i.test(signature)
      || element.matches('img[src^="blob:"], [data-file-id], [data-testid*="file-thumbnail" i], [data-testid*="attachment" i]');
  }

  function detectAttachmentMetadata() {
    const input = findPromptInput();
    const composer = getPromptComposer(input);
    const selectors = [
      '[data-testid*="file-thumbnail" i]',
      '[data-testid*="file-preview" i]',
      '[data-testid*="attachment" i]',
      '[data-file-id]',
      '[aria-label*="remove file" i]',
      '[aria-label*="delete file" i]',
      '[aria-label*="첨부" i]',
      '[class*="attachment" i]',
      '[class*="file-preview" i]',
      'img[src^="blob:"]'
    ];
    const elements = selectors.flatMap((selector) => Array.from(composer.querySelectorAll(selector)));
    const uniqueElements = Array.from(new Set(elements))
      .filter(isVisibleElement)
      .filter(looksLikeAttachmentElement);

    return {
      has_attachment: uniqueElements.length > 0,
      attachment_count: Math.min(uniqueElements.length, 10)
    };
  }

  function setNativeValue(input, value) {
    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
    if (descriptor?.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }
  }

  function replacePromptInput(value) {
    const nextValue = String(value || '').trim();
    const input = getEditableTarget(findPromptInput());
    if (!input) {
      setStatus(UI_TEXT.inputNotFound, true);
      return false;
    }

    if (!nextValue) {
      setStatus(UI_TEXT.noImprovedPrompt, true);
      return false;
    }

    input.focus();

    if ('value' in input) {
      setNativeValue(input, nextValue);
      input.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        inputType: 'insertReplacementText',
        data: nextValue
      }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
      return true;
    }

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand('delete', false);
    const inserted = document.execCommand('insertText', false, nextValue);

    if (!inserted || getPromptText(input) !== nextValue) {
      input.textContent = nextValue;
    }

    input.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertReplacementText',
      data: nextValue
    }));
    input.dispatchEvent(new Event('change', { bubbles: true }));

    return true;
  }

  function escapeHtml(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function renderResult() {
    const result = document.querySelector('#promptlab-result');
    const actions = document.querySelector('#promptlab-actions');
    if (!result || !actions) return;

    if (!state.response) {
      result.innerHTML = `<div class="promptlab-empty">${escapeHtml(UI_TEXT.emptyResult)}</div>`;
      actions.hidden = true;
      return;
    }

    const guidelineFiles = state.response.retrieved_guidelines?.files || state.response.guideline_files || [];

    result.innerHTML = `
      <div class="promptlab-guidelines">
        <span>Guidelines</span>
        <strong>${escapeHtml(guidelineFiles.join(', ') || 'general.md')}</strong>
      </div>
      <label class="promptlab-label" for="promptlab-improved">${escapeHtml(UI_TEXT.improvedPromptLabel)}</label>
      <textarea id="promptlab-improved" class="promptlab-improved" readonly>${escapeHtml(state.improvedPrompt)}</textarea>
    `;

    actions.hidden = false;
  }

  function stopAnswerCheck() {
    clearInterval(state.answerCheckTimer);
    state.answerCheckTimer = null;
    state.answerCheckStartedAt = 0;
    state.answerLastSnapshot = '';
    state.answerStableSince = 0;

    if (state.answerObserver) {
      state.answerObserver.disconnect();
      state.answerObserver = null;
    }
  }

  function setStatus(message, isError = false) {
    const status = document.querySelector('#promptlab-status');
    if (!status) return;
    status.textContent = message || '';
    status.classList.toggle('is-error', Boolean(isError));
  }

  function setBusy(isBusy) {
    const button = document.querySelector('#promptlab-analyze');
    const reloadButton = document.querySelector('#promptlab-reload');
    if (button) {
      button.disabled = isBusy;
      button.textContent = isBusy ? UI_TEXT.busy : UI_TEXT.improveButton;
    }
    if (reloadButton) reloadButton.disabled = isBusy;
  }

  function updateFabPlacement() {
    const root = document.querySelector('#promptlab-root');
    const button = document.querySelector('#promptlab-fab');
    if (!root || !button) return;

    const bottom = Math.max(96, Math.round(window.innerHeight * 0.22));
    root.style.setProperty('--promptlab-fab-bottom', `${bottom}px`);
    root.style.setProperty('--promptlab-fab-right', '14px');
  }

  function updateFabCue() {
    const button = document.querySelector('#promptlab-fab');
    if (!button) {
      updateInputOverlay();
      return;
    }

    updateFabPlacement();
    const prompt = getPromptText(findPromptInput());

    if (prompt && state.activePrompt && prompt !== state.activePrompt && !hasNewAssistantAnswer()) {
      resetPromptSession();
      renderResult();
    }

    const shouldCue = Boolean(prompt) && !state.isOpen && !state.response;
    button.classList.toggle('has-prompt', shouldCue);
    button.setAttribute('aria-label', shouldCue ? UI_TEXT.improveAvailable : UI_TEXT.openPromptLab);
    updateInputOverlay();
  }

  function startPromptWatch() {
    clearInterval(state.promptWatchTimer);
    state.promptWatchTimer = setInterval(schedulePromptRefresh, 350);
    updateFabCue();
  }

  function schedulePromptRefresh() {
    if (state.promptUpdateRaf) return;

    state.promptUpdateRaf = requestAnimationFrame(() => {
      state.promptUpdateRaf = null;
      updateFabCue();
      updateUndoToastPosition();
    });
  }

  function hideInputOverlay() {
    const overlay = document.querySelector('#promptlab-input-overlay');
    if (overlay) overlay.hidden = true;
    state.overlayVisible = false;
  }

  function observeOverlayTarget(target) {
    if (state.overlayObservedTarget === target) return false;

    if (!state.overlayResizeObserver && typeof ResizeObserver !== 'undefined') {
      state.overlayResizeObserver = new ResizeObserver(() => settleInputOverlay());
    }

    state.overlayResizeObserver?.disconnect();
    state.overlayObservedTarget = target || null;
    if (target) state.overlayResizeObserver?.observe(target);
    return true;
  }

  function rectsMatch(a, b, tolerance = 0.75) {
    if (!a || !b) return false;
    return (
      Math.abs(a.left - b.left) <= tolerance
      && Math.abs(a.top - b.top) <= tolerance
      && Math.abs(a.width - b.width) <= tolerance
      && Math.abs(a.height - b.height) <= tolerance
    );
  }

  function getOverlayRect(target) {
    if (!target?.isConnected) return null;
    const rect = target.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 28) return null;
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }

  function isOverlayGeometryStale(target) {
    if (!target || target !== state.overlayTarget) return true;
    const nextRect = getOverlayRect(target);
    if (!nextRect) return true;

    const overlay = document.querySelector('#promptlab-input-overlay');
    if (!overlay) return true;
    const currentRect = {
      left: Number.parseFloat(overlay.style.left),
      top: Number.parseFloat(overlay.style.top),
      width: Number.parseFloat(overlay.style.width),
      height: Number.parseFloat(overlay.style.height)
    };
    return !rectsMatch(currentRect, nextRect, 1.5);
  }

  function settleInputOverlay() {
    hideInputOverlay();
    cancelAnimationFrame(state.overlaySettleRaf);

    let previousRect = null;
    let stableFrames = 0;
    let frameCount = 0;

    const checkLayout = () => {
      const input = findPromptInput();
      const target = getPromptOverlayTarget(input);
      const rect = getOverlayRect(target);
      frameCount += 1;

      if (rect && rectsMatch(previousRect, rect)) {
        stableFrames += 1;
      } else {
        stableFrames = 0;
      }

      if ((rect && stableFrames >= 2) || frameCount >= 24) {
        state.overlaySettleRaf = null;
        updateFabCue();
        updateUndoToastPosition();
        return;
      }

      previousRect = rect;
      state.overlaySettleRaf = requestAnimationFrame(checkLayout);
    };

    state.overlaySettleRaf = requestAnimationFrame(checkLayout);
  }

  function bindPromptActivityListeners() {
    if (state.promptActivityListenersBound) return;
    state.promptActivityListenersBound = true;

    ['focusin', 'input', 'keyup', 'compositionend', 'pointerup', 'selectionchange'].forEach((eventName) => {
      document.addEventListener(eventName, schedulePromptRefresh, true);
    });
  }

  function resetPromptSession() {
    state.sessionId = null;
    state.originalPrompt = '';
    state.improvedPrompt = '';
    state.taskCategory = DEFAULT_TASK_CATEGORY;
    state.response = null;
    state.usedImproved = null;
    state.assistantMessageBaseline = getAssistantMessageCount();
    state.assistantTextBaseline = getAssistantTextSnapshot();
    state.activePrompt = '';
    state.inlineImproving = false;
    hideUndoToast();
    stopAnswerCheck();
    updateFabCue();
  }

  function resetAnalysisResult() {
    state.sessionId = null;
    state.originalPrompt = '';
    state.improvedPrompt = '';
    state.response = null;
    state.usedImproved = null;
    state.inlineImproving = false;
    hideUndoToast();
    stopAnswerCheck();
    renderResult();
  }

  function updateInputOverlay() {
    const overlay = document.querySelector('#promptlab-input-overlay');
    if (!overlay) return;

    if (state.overlaySettleRaf) {
      hideInputOverlay();
      return;
    }

    const input = findPromptInput();
    const target = getPromptOverlayTarget(input);
    const prompt = getPromptText(input);

    if (!target || state.isOpen) {
      hideInputOverlay();
      state.overlayTarget = null;
      observeOverlayTarget(null);
      return;
    }

    const rect = target.getBoundingClientRect();

    if (rect.width < 80 || rect.height < 28) {
      hideInputOverlay();
      state.overlayTarget = null;
      observeOverlayTarget(null);
      return;
    }

    const targetChanged = observeOverlayTarget(target);
    if (targetChanged) {
      settleInputOverlay();
      return;
    }

    overlay.hidden = false;
    overlay.style.left = `${rect.left}px`;
    overlay.style.top = `${rect.top}px`;
    overlay.style.width = `${rect.width}px`;
    overlay.style.height = `${rect.height}px`;

    const radius = Math.min(22, Math.max(10, Number.parseFloat(window.getComputedStyle(target).borderRadius) || 16));
    const editable = getEditableTarget(input);
    const isFocused = Boolean(
      editable
      && (
        editable === document.activeElement
        || editable.contains(document.activeElement)
        || target.contains(document.activeElement)
      )
    );
    overlay.style.setProperty('--promptlab-input-radius', `${radius}px`);
    overlay.classList.toggle('is-focused', isFocused);
    overlay.classList.toggle('is-ready', Boolean(prompt) && !state.inlineImproving);
    overlay.classList.toggle('is-improving', state.inlineImproving);
    state.overlayTarget = target;
    state.overlayVisible = true;
  }

  function updateUndoToastPosition() {
    const toast = document.querySelector('#promptlab-undo-toast');
    if (!toast || toast.hidden) return;

    const input = findPromptInput();
    const target = getPromptOverlayTarget(input);
    if (!target) return;

    const rect = target.getBoundingClientRect();
    toast.style.left = `${Math.round(Math.min(rect.right - toast.offsetWidth, window.innerWidth - toast.offsetWidth - 12))}px`;
    toast.style.top = `${Math.round(Math.max(12, rect.top - toast.offsetHeight - 10))}px`;
  }

  function hideUndoToast() {
    clearTimeout(state.undoTimer);
    state.undoTimer = null;
    const toast = document.querySelector('#promptlab-undo-toast');
    if (toast) toast.hidden = true;
  }

  function showUndoToast(originalPrompt) {
    const toast = document.querySelector('#promptlab-undo-toast');
    if (!toast) return;

    clearTimeout(state.undoTimer);
    toast.hidden = false;
    updateUndoToastPosition();
    toast.querySelector('button').onclick = () => {
      if (replacePromptInput(originalPrompt)) {
        state.usedImproved = false;
        state.assistantMessageBaseline = getAssistantMessageCount();
        state.assistantTextBaseline = getAssistantTextSnapshot();
        state.activePrompt = String(originalPrompt || '').trim();
        sendUsageLog(false);
      }
      hideUndoToast();
      updateInputOverlay();
    };

    state.undoTimer = setTimeout(hideUndoToast, 9000);
  }

  async function requestPromptImprovement(prompt, category, attachmentContext) {
    const response = await fetch(`${SERVER_URL}/api/improve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: state.userId,
        session_id: state.sessionId,
        original_prompt: prompt,
        task_category: category,
        client_language: CLIENT_LANGUAGE,
        attachment_context: attachmentContext
      })
    });

    if (!response.ok) {
      throw new Error(`Server returned ${response.status}`);
    }

    return response.json();
  }

  async function improveActivePromptInline() {
    if (state.inlineImproving) return;

    const input = findPromptInput();
    const prompt = getPromptText(input);
    const category = DEFAULT_TASK_CATEGORY;
    const attachmentContext = detectAttachmentMetadata();

    if (!prompt) {
      updateInputOverlay();
      return;
    }

    state.sessionId = createId('session');
    state.originalPrompt = prompt;
    state.taskCategory = category;
    state.response = null;
    state.improvedPrompt = '';
    state.usedImproved = null;
    state.activePrompt = '';
    state.inlineImproving = true;
    stopAnswerCheck();
    hideUndoToast();
    closePanel();
    updateInputOverlay();

    try {
      const data = await requestPromptImprovement(prompt, category, attachmentContext);
      state.response = data;
      state.improvedPrompt = data.improved_prompt || '';

      if (!state.improvedPrompt || !replacePromptInput(state.improvedPrompt)) {
        throw new Error(UI_TEXT.noImprovedPrompt);
      }

      state.usedImproved = true;
      state.assistantMessageBaseline = getAssistantMessageCount();
      state.assistantTextBaseline = getAssistantTextSnapshot();
      state.activePrompt = state.improvedPrompt.trim();
      sendUsageLog(true);
      showUndoToast(prompt);
    } catch (error) {
      console.warn(`PromptLab inline improvement failed: ${error.message}`);
      state.sessionId = null;
      state.response = null;
      state.improvedPrompt = '';
      state.usedImproved = null;
      state.activePrompt = '';
    } finally {
      state.inlineImproving = false;
      updateInputOverlay();
    }
  }

  function getCurrentPromptDraft() {
    const currentPrompt = document.querySelector('#promptlab-current');
    return String(currentPrompt?.value || '').trim();
  }

  function reloadCurrentPromptFromInput() {
    const input = findPromptInput();
    const prompt = getPromptText(input);
    const currentPrompt = document.querySelector('#promptlab-current');

    if (!currentPrompt) return;

    currentPrompt.value = prompt;
    resetAnalysisResult();
    setStatus(prompt ? '' : UI_TEXT.noPrompt, !prompt);
    currentPrompt.focus();
  }

  async function analyzePrompt() {
    const prompt = getCurrentPromptDraft();
    const category = DEFAULT_TASK_CATEGORY;
    const attachmentContext = detectAttachmentMetadata();

    if (!prompt) {
      setStatus(UI_TEXT.noPrompt, true);
      return;
    }

    state.sessionId = createId('session');
    state.originalPrompt = prompt;
    state.taskCategory = category;
    state.response = null;
    state.usedImproved = null;
    state.assistantMessageBaseline = getAssistantMessageCount();
    state.assistantTextBaseline = getAssistantTextSnapshot();
    state.activePrompt = '';
    stopAnswerCheck();

    setBusy(true);
    setStatus(UI_TEXT.improving);
    const fab = document.querySelector('#promptlab-fab');
    if (fab) fab.classList.remove('has-prompt');
    renderResult();

    try {
      const data = await requestPromptImprovement(prompt, category, attachmentContext);
      state.response = data;
      state.improvedPrompt = data.improved_prompt || '';
      setStatus(UI_TEXT.ready);
      renderResult();
    } catch (error) {
      setStatus(`${UI_TEXT.serverError}: ${error.message}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function sendUsageLog(usedImproved) {
    if (!state.response || !state.sessionId) {
      return;
    }

    const logPayload = {
      userId: state.userId,
      sessionId: state.sessionId,
      taskCategory: state.taskCategory,
      targetPlatform: TARGET_PLATFORM,
      provider: state.response.provider,
      improvementType: state.response.improvement_type,
      improvementReason: state.response.improvement_reason,
      beforeAnalysis: state.response.before_analysis,
      afterAnalysis: state.response.after_analysis,
      guidelineFiles: state.response.guideline_files,
      retrievedGuidelines: state.response.retrieved_guidelines,
      attachmentContext: state.response.attachment_context,
      originalPrompt: state.originalPrompt,
      improvedPrompt: state.improvedPrompt
    };

    try {
      const [originalHash, improvedHash] = await Promise.all([
        sha256(logPayload.originalPrompt),
        sha256(logPayload.improvedPrompt)
      ]);

      const response = await fetch(`${SERVER_URL}/api/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: logPayload.userId,
          session_id: logPayload.sessionId,
          task_category: logPayload.taskCategory,
          target_platform: logPayload.targetPlatform,
          provider: logPayload.provider,
          improvement_type: logPayload.improvementType,
          improvement_reason: logPayload.improvementReason,
          used_improved: usedImproved,
          before_analysis: logPayload.beforeAnalysis,
          after_analysis: logPayload.afterAnalysis,
          guideline_files: logPayload.guidelineFiles,
          retrieved_guidelines: logPayload.retrievedGuidelines || {
            category: logPayload.taskCategory,
            files: logPayload.guidelineFiles || [],
            target_platform: logPayload.targetPlatform,
            attachment_context: logPayload.attachmentContext
          },
          original_prompt_hash: originalHash,
          improved_prompt_hash: improvedHash,
          original_prompt_length: logPayload.originalPrompt.length,
          improved_prompt_length: logPayload.improvedPrompt.length
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }
    } catch (error) {
      console.warn(`PromptLab usage log failed: ${error.message}`);
    }
  }

  function handlePromptChoice(promptText, usedImproved) {
    if (!replacePromptInput(promptText)) return;

    state.usedImproved = usedImproved;
    state.assistantMessageBaseline = getAssistantMessageCount();
    state.assistantTextBaseline = getAssistantTextSnapshot();
    state.activePrompt = String(promptText || '').trim();
    closePanel();
    sendUsageLog(usedImproved);
    updateInputOverlay();
  }

  function openPanel() {
    state.isOpen = true;
    const panel = document.querySelector('#promptlab-panel');
    const input = findPromptInput();
    if (!panel) return;

    panel.hidden = false;
    document.querySelector('#promptlab-current').value = state.response ? state.originalPrompt : getPromptText(input);
    setStatus('');
    renderResult();
  }

  function closePanel() {
    state.isOpen = false;
    const panel = document.querySelector('#promptlab-panel');
    if (panel) panel.hidden = true;
  }

  function insertUi() {
    if (document.querySelector('#promptlab-root')) return;
    if (!document.body) return;

    const root = document.createElement('div');
    root.id = 'promptlab-root';
    root.innerHTML = `
      <button id="promptlab-fab" type="button" aria-label="${escapeHtml(UI_TEXT.openPromptLab)}">
        <img src="${chrome.runtime.getURL('icons/icon48.png')}" alt="">
      </button>
      <div id="promptlab-input-overlay" hidden>
        <div id="promptlab-input-ring" aria-hidden="true">
          <svg class="promptlab-ring-orbit" focusable="false" aria-hidden="true">
            <rect class="promptlab-ring-track" pathLength="100"></rect>
            <rect class="promptlab-ring-trace promptlab-ring-trace-primary" pathLength="100"></rect>
            <rect class="promptlab-ring-trace promptlab-ring-trace-secondary" pathLength="100"></rect>
          </svg>
        </div>
        <button id="promptlab-inline-chip" type="button" title="${escapeHtml(UI_TEXT.shortcutHint)}">
          <kbd>${escapeHtml(getShortcutLabel())}</kbd>
        </button>
      </div>
      <section id="promptlab-undo-toast" hidden aria-live="polite">
        <span>${escapeHtml(UI_TEXT.improvedApplied)}</span>
        <button type="button">${escapeHtml(UI_TEXT.undoImprovement)}</button>
      </section>
      <section id="promptlab-panel" hidden>
        <header class="promptlab-header">
          <div>
            <strong>PromptLab</strong>
            <span>${escapeHtml(UI_TEXT.subtitle)}</span>
          </div>
          <button id="promptlab-close" type="button" aria-label="Close">x</button>
        </header>
        <div class="promptlab-body">
          <label class="promptlab-label" for="promptlab-current">${escapeHtml(UI_TEXT.currentPrompt)}</label>
          <textarea id="promptlab-current"></textarea>
          <button id="promptlab-reload" class="promptlab-secondary" type="button">${escapeHtml(UI_TEXT.reloadCurrentPrompt)}</button>
          <button id="promptlab-analyze" class="promptlab-primary" type="button">${escapeHtml(UI_TEXT.improveButton)}</button>
          <div id="promptlab-status" class="promptlab-status" aria-live="polite"></div>
          <div id="promptlab-result"></div>
          <div id="promptlab-actions" hidden>
            <div class="promptlab-action-row">
              <button id="promptlab-insert" class="promptlab-primary" type="button">${escapeHtml(UI_TEXT.insertImproved)}</button>
              <button id="promptlab-original" type="button">${escapeHtml(UI_TEXT.keepOriginal)}</button>
            </div>
          </div>
        </div>
      </section>
    `;

    document.body.appendChild(root);
    applyBorderColor(state.borderColor);

    document.querySelector('#promptlab-fab').addEventListener('click', () => {
      if (state.isOpen) {
        closePanel();
      } else {
        openPanel();
      }
      updateFabCue();
    });
    window.addEventListener('resize', updateFabPlacement);
    window.addEventListener('resize', () => {
      updateInputOverlay();
      updateUndoToastPosition();
    });
    window.addEventListener('scroll', () => {
      updateInputOverlay();
      updateUndoToastPosition();
    }, true);

    document.querySelector('#promptlab-inline-chip').addEventListener('click', improveActivePromptInline);
    document.querySelector('#promptlab-close').addEventListener('click', closePanel);
    document.querySelector('#promptlab-reload').addEventListener('click', reloadCurrentPromptFromInput);
    document.querySelector('#promptlab-analyze').addEventListener('click', analyzePrompt);
    document.querySelector('#promptlab-insert').addEventListener('click', () => {
      handlePromptChoice(state.improvedPrompt, true);
    });
    document.querySelector('#promptlab-original').addEventListener('click', () => {
      handlePromptChoice(state.originalPrompt, false);
    });
    renderResult();
    updateFabCue();
  }

  function handleGlobalKeydown(event) {
    if (event.defaultPrevented || state.inlineImproving) return;
    if (event.code !== 'Period' && event.key !== '.') return;
    if (!event.shiftKey || event.altKey) return;

    const hasPlatformModifier = IS_MAC ? event.metaKey : event.ctrlKey;
    if (!hasPlatformModifier) return;

    const input = findPromptInput();
    const editable = getEditableTarget(input);
    if (!input || !editable) return;
    if (!editable.contains(document.activeElement) && editable !== document.activeElement) return;

    event.preventDefault();
    event.stopPropagation();
    improveActivePromptInline();
  }

  async function init() {
    [state.userId, state.borderColor] = await Promise.all([
      getStoredUserId(),
      getStoredBorderColor()
    ]);
    insertUi();
    startPromptWatch();
    bindPromptActivityListeners();
    document.addEventListener('keydown', handleGlobalKeydown, true);

    const observer = new MutationObserver((mutations) => {
      const hasExternalLayoutMutation = mutations.some((mutation) => {
        const target = mutation.target?.nodeType === Node.ELEMENT_NODE
          ? mutation.target
          : mutation.target?.parentElement;
        return !target?.closest?.('#promptlab-root');
      });
      if (!hasExternalLayoutMutation) return;

      if (!document.querySelector('#promptlab-root')) {
        insertUi();
      }

      const target = getPromptOverlayTarget(findPromptInput());
      if (state.overlayVisible && isOverlayGeometryStale(target)) {
        settleInputOverlay();
      } else {
        schedulePromptRefresh();
      }
    });

    if (document.body) {
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'hidden']
      });
    }
  }

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'local' || !changes[STORAGE_BORDER_COLOR_KEY]) return;
    applyBorderColor(changes[STORAGE_BORDER_COLOR_KEY].newValue);
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
