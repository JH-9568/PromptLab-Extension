(() => {
  const SERVER_URL = 'http://localhost:3000';
  const STORAGE_USER_ID_KEY = 'promptlab_user_id';
  const INPUT_SELECTORS = [
    '#prompt-textarea',
    '[data-testid="prompt-textarea"]',
    'textarea',
    'div[contenteditable="true"]',
    '[role="textbox"]',
    '.ProseMirror'
  ];
  const DEFAULT_TASK_CATEGORY = 'etc';

  let state = {
    isOpen: false,
    userId: null,
    sessionId: null,
    originalPrompt: '',
    improvedPrompt: '',
    taskCategory: DEFAULT_TASK_CATEGORY,
    response: null,
    usedImproved: null,
    satisfactionScore: null
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
    for (const selector of INPUT_SELECTORS) {
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
      setStatus('ChatGPT 입력창을 찾지 못했습니다.', true);
      return false;
    }

    if (!nextValue) {
      setStatus('삽입할 개선 프롬프트가 없습니다.', true);
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
      result.innerHTML = '<div class="promptlab-empty">Analyze a prompt to see the improved version and specificity scores.</div>';
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
      <label class="promptlab-label" for="promptlab-improved">Improved Prompt</label>
      <textarea id="promptlab-improved" class="promptlab-improved" readonly>${escapeHtml(state.improvedPrompt)}</textarea>
    `;

    actions.hidden = false;
    setSelectedRating(state.satisfactionScore);
  }

  function setSelectedRating(score) {
    document.querySelectorAll('.promptlab-rating button').forEach((button) => {
      const isSelected = Number(button.dataset.score) === score;
      button.classList.toggle('is-selected', isSelected);
      button.setAttribute('aria-pressed', String(isSelected));
    });
  }

  function setStatus(message, isError = false) {
    const status = document.querySelector('#promptlab-status');
    if (!status) return;
    status.textContent = message || '';
    status.classList.toggle('is-error', Boolean(isError));
  }

  function setBusy(isBusy) {
    const button = document.querySelector('#promptlab-analyze');
    if (!button) return;
    button.disabled = isBusy;
    button.textContent = isBusy ? 'Analyzing...' : 'Analyze & Improve';
  }

  async function analyzePrompt() {
    const input = findPromptInput();
    const prompt = getPromptText(input);
    const category = DEFAULT_TASK_CATEGORY;

    if (!prompt) {
      setStatus('현재 ChatGPT 입력창에 프롬프트가 없습니다.', true);
      return;
    }

    const currentPrompt = document.querySelector('#promptlab-current');
    if (currentPrompt) currentPrompt.value = prompt;

    state.sessionId = createId('session');
    state.originalPrompt = prompt;
    state.taskCategory = category;
    state.response = null;
    state.usedImproved = null;
    state.satisfactionScore = null;

    setBusy(true);
    setStatus('Sending prompt to local server...');
    renderResult();

    try {
      const response = await fetch(`${SERVER_URL}/api/improve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          user_id: state.userId,
          session_id: state.sessionId,
          original_prompt: prompt,
          task_category: category
        })
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      state.response = data;
      state.improvedPrompt = data.improved_prompt || '';
      setStatus('Improved prompt is ready.');
      renderResult();
    } catch (error) {
      setStatus(`서버 요청 실패: ${error.message}`, true);
    } finally {
      setBusy(false);
    }
  }

  async function sendLog(satisfactionScore) {
    if (!state.response || !state.sessionId) {
      setStatus('먼저 프롬프트를 분석해 주세요.', true);
      return;
    }

    state.satisfactionScore = satisfactionScore;
    setSelectedRating(satisfactionScore);
    setStatus(`만족도 ${satisfactionScore}점을 저장 중입니다...`);

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
          provider: state.response.provider,
          used_improved: state.usedImproved,
          satisfaction_score: satisfactionScore,
          before_analysis: state.response.before_analysis,
          after_analysis: state.response.after_analysis,
          guideline_files: state.response.guideline_files,
          retrieved_guidelines: state.response.retrieved_guidelines || {
            category: state.taskCategory,
            files: state.response.guideline_files || []
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

      setStatus(`만족도 ${satisfactionScore}점이 저장되었습니다.`);
    } catch (error) {
      setStatus(`로그 저장 실패: ${error.message}`, true);
    }
  }

  function openPanel() {
    state.isOpen = true;
    const panel = document.querySelector('#promptlab-panel');
    const input = findPromptInput();
    if (!panel) return;

    panel.hidden = false;
    document.querySelector('#promptlab-current').value = getPromptText(input);
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
      <button id="promptlab-fab" type="button">PromptLab</button>
      <section id="promptlab-panel" hidden>
        <header class="promptlab-header">
          <div>
            <strong>PromptLab</strong>
            <span>Prompt improver</span>
          </div>
          <button id="promptlab-close" type="button" aria-label="Close">x</button>
        </header>
        <div class="promptlab-body">
          <label class="promptlab-label" for="promptlab-current">Current Prompt</label>
          <textarea id="promptlab-current" readonly></textarea>
          <button id="promptlab-analyze" class="promptlab-primary" type="button">Analyze & Improve</button>
          <div id="promptlab-status" class="promptlab-status" aria-live="polite"></div>
          <div id="promptlab-result"></div>
          <div id="promptlab-actions" hidden>
            <div class="promptlab-action-row">
              <button id="promptlab-insert" class="promptlab-primary" type="button">Insert Improved</button>
              <button id="promptlab-original" type="button">Use Original</button>
            </div>
            <div class="promptlab-rating">
              <span>Satisfaction</span>
              <div>
                ${[1, 2, 3, 4, 5].map((score) => `<button type="button" data-score="${score}">${score}</button>`).join('')}
              </div>
            </div>
          </div>
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
    });

    document.querySelector('#promptlab-close').addEventListener('click', closePanel);
    document.querySelector('#promptlab-analyze').addEventListener('click', analyzePrompt);
    document.querySelector('#promptlab-insert').addEventListener('click', () => {
      if (replacePromptInput(state.improvedPrompt)) {
        state.usedImproved = true;
        closePanel();
      }
    });
    document.querySelector('#promptlab-original').addEventListener('click', () => {
      if (replacePromptInput(state.originalPrompt)) {
        state.usedImproved = false;
        closePanel();
      }
    });
    document.querySelectorAll('.promptlab-rating button').forEach((button) => {
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => sendLog(Number(button.dataset.score)));
    });

    renderResult();
  }

  async function init() {
    state.userId = await getStoredUserId();
    insertUi();

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
