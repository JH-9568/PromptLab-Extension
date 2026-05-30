(() => {
  const SERVER_URL = 'https://promptlab-server.onrender.com';
  const STORAGE_USER_ID_KEY = 'promptlab_user_id';
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
  const ANSWER_STABLE_DELAY_MS = 4500;
  const TARGET_PLATFORM = detectTargetPlatform();
  const CLIENT_LANGUAGE = navigator.languages?.[0] || navigator.language || 'en';
  const i18n = (key, substitutions) => chrome.i18n.getMessage(key, substitutions) || key;
  const UI_TEXT = {
    inputNotFound: i18n('inputNotFound'),
    noImprovedPrompt: i18n('noImprovedPrompt'),
    emptyResult: i18n('emptyResult'),
    improvedPromptLabel: i18n('improvedPromptLabel'),
    ratingPrompt: i18n('ratingPrompt'),
    busy: i18n('busy'),
    improveButton: i18n('improveButton'),
    improveAvailable: i18n('improveAvailable'),
    openPromptLab: i18n('openPromptLab'),
    noPrompt: i18n('noPrompt'),
    improving: i18n('improving'),
    ready: i18n('ready'),
    serverError: i18n('serverError'),
    analyzeFirst: i18n('analyzeFirst'),
    savingRating: (score) => i18n('savingRating', [String(score)]),
    savedRating: (score) => i18n('savedRating', [String(score)]),
    logError: i18n('logError'),
    subtitle: i18n('subtitle'),
    currentPrompt: i18n('currentPrompt'),
    reloadCurrentPrompt: i18n('reloadCurrentPrompt'),
    insertImproved: i18n('insertImproved'),
    keepOriginal: i18n('keepOriginal'),
    ratingTitle: i18n('ratingTitle')
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
    satisfactionScore: null,
    awaitingRating: false,
    assistantMessageBaseline: 0,
    assistantTextBaseline: '',
    answerLastSnapshot: '',
    answerStableSince: 0,
    activePrompt: '',
    answerCheckTimer: null,
    answerCheckStartedAt: 0,
    promptWatchTimer: null,
    answerObserver: null
  };

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

  function isAssistantAnswerStable() {
    const snapshot = getAssistantTextSnapshot();
    const hasNewAnswer = (
      getAssistantMessageCount() > state.assistantMessageBaseline
      || snapshot !== state.assistantTextBaseline
    );

    if (!hasNewAnswer) {
      state.answerLastSnapshot = '';
      state.answerStableSince = 0;
      return false;
    }

    if (snapshot !== state.answerLastSnapshot) {
      state.answerLastSnapshot = snapshot;
      state.answerStableSince = Date.now();
      return false;
    }

    return Date.now() - state.answerStableSince >= ANSWER_STABLE_DELAY_MS;
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

  function analysisRows(analysis) {
    const fields = [
      ['Goal', 'has_goal'],
      ['Context', 'has_context'],
      ['Format', 'has_format'],
      ['Constraint', 'has_constraint'],
      ['Reference', 'has_reference']
    ];

    return fields.map(([label, key]) => `
      <div class="promptlab-signal ${analysis?.[key] ? 'is-on' : ''}">
        <span>${label}</span>
        <strong>${analysis?.[key] ? 'Yes' : 'No'}</strong>
      </div>
    `).join('');
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

    const before = state.response.before_analysis || {};
    const after = state.response.after_analysis || {};
    const guidelineFiles = state.response.retrieved_guidelines?.files || state.response.guideline_files || [];

    result.innerHTML = `
      <div class="promptlab-score-grid">
        <div>
          <span>Before</span>
          <strong>${before.specificity_score ?? 0}</strong>
        </div>
        <div>
          <span>After</span>
          <strong>${after.specificity_score ?? 0}</strong>
        </div>
      </div>
      <div class="promptlab-guidelines">
        <span>Guidelines</span>
        <strong>${escapeHtml(guidelineFiles.join(', ') || 'general.md')}</strong>
      </div>
      <div class="promptlab-analysis">
        <div>
          <h3>Before</h3>
          ${analysisRows(before)}
        </div>
        <div>
          <h3>After</h3>
          ${analysisRows(after)}
        </div>
      </div>
      <label class="promptlab-label" for="promptlab-improved">${escapeHtml(UI_TEXT.improvedPromptLabel)}</label>
      <textarea id="promptlab-improved" class="promptlab-improved" readonly>${escapeHtml(state.improvedPrompt)}</textarea>
    `;

    actions.hidden = false;
  }

  function setSelectedRating(score) {
    document.querySelectorAll('#promptlab-rating-toast button[data-score]').forEach((button) => {
      const isSelected = Number(button.dataset.score) === score;
      button.classList.toggle('is-selected', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
    });
  }

  function setRatingStatus(message, isError = false) {
    const status = document.querySelector('#promptlab-rating-status');
    if (!status) return;
    status.textContent = message || '';
    status.classList.toggle('is-error', Boolean(isError));
  }

  function showRatingPrompt() {
    if (!state.awaitingRating || state.satisfactionScore) return;
    const ratingToast = document.querySelector('#promptlab-rating-toast');
    if (!ratingToast) return;
    ratingToast.hidden = false;
    setSelectedRating(null);
    setRatingStatus(UI_TEXT.ratingPrompt);
  }

  function hideRatingPrompt() {
    const ratingToast = document.querySelector('#promptlab-rating-toast');
    if (ratingToast) ratingToast.hidden = true;
    setSelectedRating(null);
    setRatingStatus('');
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

  function startAnswerCheck() {
    stopAnswerCheck();

    if (!state.awaitingRating || state.satisfactionScore) return;

    const checkForAnswer = () => {
      if (!state.awaitingRating || state.satisfactionScore) {
        stopAnswerCheck();
        return;
      }

      if (isAssistantAnswerStable()) {
        showRatingPrompt();
        stopAnswerCheck();
      }
    };

    state.answerCheckStartedAt = Date.now();
    state.answerObserver = new MutationObserver(checkForAnswer);
    state.answerObserver.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true
    });

    state.answerCheckTimer = setInterval(() => {
      if (!state.awaitingRating || state.satisfactionScore) {
        stopAnswerCheck();
        return;
      }

      if (isAssistantAnswerStable()) {
        showRatingPrompt();
        stopAnswerCheck();
        return;
      }

      if (Date.now() - state.answerCheckStartedAt > 120000) {
        state.awaitingRating = false;
        stopAnswerCheck();
      }
    }, 1500);
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
    if (!button) return;

    updateFabPlacement();
    const prompt = getPromptText(findPromptInput());

    if (
      state.awaitingRating
      && !state.satisfactionScore
      && !hasNewAssistantAnswer()
      && prompt
      && state.activePrompt
      && prompt !== state.activePrompt
    ) {
      resetPromptSession();
      renderResult();
    }

    const shouldCue = Boolean(prompt) && !state.isOpen && !state.response && !state.awaitingRating;
    button.classList.toggle('has-prompt', shouldCue);
    button.setAttribute('aria-label', shouldCue ? UI_TEXT.improveAvailable : UI_TEXT.openPromptLab);
  }

  function startPromptWatch() {
    clearInterval(state.promptWatchTimer);
    state.promptWatchTimer = setInterval(updateFabCue, 800);
    updateFabCue();
  }

  function resetPromptSession() {
    state.sessionId = null;
    state.originalPrompt = '';
    state.improvedPrompt = '';
    state.taskCategory = DEFAULT_TASK_CATEGORY;
    state.response = null;
    state.usedImproved = null;
    state.satisfactionScore = null;
    state.awaitingRating = false;
    state.assistantMessageBaseline = getAssistantMessageCount();
    state.assistantTextBaseline = getAssistantTextSnapshot();
    state.activePrompt = '';
    stopAnswerCheck();
    hideRatingPrompt();
    updateFabCue();
  }

  function resetAnalysisResult() {
    state.sessionId = null;
    state.originalPrompt = '';
    state.improvedPrompt = '';
    state.response = null;
    state.usedImproved = null;
    state.satisfactionScore = null;
    state.awaitingRating = false;
    stopAnswerCheck();
    hideRatingPrompt();
    renderResult();
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

    if (!prompt) {
      setStatus(UI_TEXT.noPrompt, true);
      return;
    }

    state.sessionId = createId('session');
    state.originalPrompt = prompt;
    state.taskCategory = category;
    state.response = null;
    state.usedImproved = null;
    state.satisfactionScore = null;
    state.awaitingRating = false;
    state.assistantMessageBaseline = getAssistantMessageCount();
    state.assistantTextBaseline = getAssistantTextSnapshot();
    state.activePrompt = '';
    stopAnswerCheck();
    hideRatingPrompt();

    setBusy(true);
    setStatus(UI_TEXT.improving);
    const fab = document.querySelector('#promptlab-fab');
    if (fab) fab.classList.remove('has-prompt');
    renderResult();

    try {
      const response = await fetch(`${SERVER_URL}/api/improve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: state.userId,
          session_id: state.sessionId,
          original_prompt: prompt,
          task_category: category,
          client_language: CLIENT_LANGUAGE
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
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

  async function sendLog(satisfactionScore) {
    if (!state.response || !state.sessionId) {
      setRatingStatus(UI_TEXT.analyzeFirst, true);
      return;
    }

    state.satisfactionScore = satisfactionScore;
    setSelectedRating(satisfactionScore);
    setRatingStatus(UI_TEXT.savingRating(satisfactionScore));

    try {
      const [originalHash, improvedHash] = await Promise.all([
        sha256(state.originalPrompt),
        sha256(state.improvedPrompt)
      ]);

      const response = await fetch(`${SERVER_URL}/api/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: state.userId,
          session_id: state.sessionId,
          task_category: state.taskCategory,
          target_platform: TARGET_PLATFORM,
          provider: state.response.provider,
          improvement_type: state.response.improvement_type,
          improvement_reason: state.response.improvement_reason,
          used_improved: state.usedImproved,
          satisfaction_score: satisfactionScore,
          before_analysis: state.response.before_analysis,
          after_analysis: state.response.after_analysis,
          guideline_files: state.response.guideline_files,
          retrieved_guidelines: state.response.retrieved_guidelines || {
            category: state.taskCategory,
            files: state.response.guideline_files || [],
            target_platform: TARGET_PLATFORM
          },
          original_prompt_hash: originalHash,
          improved_prompt_hash: improvedHash,
          original_prompt_length: state.originalPrompt.length,
          improved_prompt_length: state.improvedPrompt.length
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      setRatingStatus(UI_TEXT.savedRating(satisfactionScore));
      setTimeout(() => {
        resetPromptSession();
        renderResult();
      }, 450);
    } catch (error) {
      state.satisfactionScore = null;
      setSelectedRating(null);
      setRatingStatus(`${UI_TEXT.logError}: ${error.message}`, true);
    }
  }

  function handlePromptChoice(promptText, usedImproved) {
    if (!replacePromptInput(promptText)) return;

    state.usedImproved = usedImproved;
    state.satisfactionScore = null;
    state.awaitingRating = true;
    state.assistantMessageBaseline = getAssistantMessageCount();
    state.assistantTextBaseline = getAssistantTextSnapshot();
    state.activePrompt = String(promptText || '').trim();
    hideRatingPrompt();
    closePanel();
    startAnswerCheck();
  }

  function openPanel() {
    state.isOpen = true;
    const panel = document.querySelector('#promptlab-panel');
    const input = findPromptInput();
    if (!panel) return;

    if (state.satisfactionScore && !state.awaitingRating) {
      resetPromptSession();
    }

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
      <section id="promptlab-rating-toast" hidden aria-live="polite">
        <div>
          <strong>${escapeHtml(UI_TEXT.ratingTitle)}</strong>
          <span id="promptlab-rating-status">${escapeHtml(UI_TEXT.ratingPrompt)}</span>
        </div>
        <div class="promptlab-rating-buttons">
          ${[1, 2, 3, 4, 5].map((score) => `<button type="button" data-score="${score}" aria-pressed="false">${score}</button>`).join('')}
        </div>
      </section>
    `;

    document.body.appendChild(root);

    document.querySelector('#promptlab-fab').addEventListener('click', () => {
      if (state.isOpen) {
        closePanel();
      } else {
        openPanel();
      }
      updateFabCue();
    });
    window.addEventListener('resize', updateFabPlacement);

    document.querySelector('#promptlab-close').addEventListener('click', closePanel);
    document.querySelector('#promptlab-reload').addEventListener('click', reloadCurrentPromptFromInput);
    document.querySelector('#promptlab-analyze').addEventListener('click', analyzePrompt);
    document.querySelector('#promptlab-insert').addEventListener('click', () => {
      handlePromptChoice(state.improvedPrompt, true);
    });
    document.querySelector('#promptlab-original').addEventListener('click', () => {
      handlePromptChoice(state.originalPrompt, false);
    });
    document.querySelectorAll('#promptlab-rating-toast button[data-score]').forEach((button) => {
      button.addEventListener('click', () => sendLog(Number(button.dataset.score)));
    });

    renderResult();
    updateFabCue();
  }

  async function init() {
    state.userId = await getStoredUserId();
    insertUi();
    startPromptWatch();

    const observer = new MutationObserver(() => {
      if (!document.querySelector('#promptlab-root')) {
        insertUi();
      }
    });

    if (document.body) {
      observer.observe(document.body, { childList: true });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
