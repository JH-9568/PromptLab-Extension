const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
const output = process.env.PROMPTLAB_QA_OUTPUT || '/tmp/promptlab-settings-qa';

function mockChrome({ messages, locale, platform = 'MacIntel' }) {
  const listeners = [];
  const load = () => JSON.parse(localStorage.getItem('promptlab-test-storage') || '{}');
  window.chrome = {
    i18n: {
      getUILanguage: () => locale,
      getMessage: (key, substitutions) => (messages[key]?.message || key).replace(/\$SHORTCUT\$/g, substitutions?.[0] || '')
    },
    storage: {
      local: {
        get: async (keys, callback) => {
          const data = load();
          const result = Object.fromEntries(keys.map((key) => [key, data[key]]));
          callback?.(result);
          return result;
        },
        set: async (values, callback) => {
          if (localStorage.getItem('fail-next-save')) {
            localStorage.removeItem('fail-next-save');
            throw new Error('Simulated storage failure');
          }
          const data = load();
          localStorage.setItem('promptlab-test-storage', JSON.stringify({ ...data, ...values }));
          const changes = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { oldValue: data[key], newValue: value }]));
          listeners.forEach((listener) => listener(changes, 'local'));
          callback?.();
        }
      },
      onChanged: { addListener: (listener) => listeners.push(listener) }
    },
    runtime: { getURL: (file) => `https://extension.test/${file}`, getManifest: () => ({ version: '0.1.9' }) }
  };
  Object.defineProperty(navigator, 'platform', { get: () => platform });
}

async function verifyLayout(page) {
  const layout = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > innerWidth,
    broken: [...document.querySelectorAll('h1, h2, button, .mode-control span, .setting-heading')].filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent)
  }));
  assert.equal(layout.overflow, false);
  assert.deepEqual(layout.broken, []);
}

async function verifyInlineStates(browser) {
  for (const locale of ['ko', 'en']) for (const platform of ['MacIntel', 'Win32']) {
    const messages = JSON.parse(await fs.readFile(path.join(root, 'extension/_locales', locale, 'messages.json'), 'utf8'));
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, locale });
    await context.addInitScript(mockChrome, { messages, locale, platform });
    await context.route('https://chatgpt.com/**', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>
      *{box-sizing:border-box}body{margin:0;background:#f5f7f6}form{position:absolute;left:16px;right:16px;top:280px;padding:16px;background:white;border-radius:20px;overflow:hidden}
      .scroll-frame{max-height:160px;overflow:auto}.ProseMirror{min-height:80px;outline:none;white-space:pre-wrap;font:14px/1.5 system-ui}
      .attachment-preview{height:44px;font:13px system-ui;padding:12px;background:#eef3ef;margin-bottom:12px}
      </style><form><div class="attachment-preview" data-testid="file-thumbnail">photo.png</div><div class="scroll-frame"><div id="prompt-textarea" class="ProseMirror" role="textbox" contenteditable="true"></div></div></form>` }));
    let release;
    const requests = [];
    const logs = [];
    await context.route('https://promptlab-server.onrender.com/**', async route => {
      if (route.request().url().endsWith('/api/improve')) {
        requests.push(route.request().postDataJSON());
        await new Promise(resolve => { release = resolve; });
        return route.fulfill({ json: { improved_prompt: 'A clearer prompt.', provider: 'fixture', before_analysis: {}, after_analysis: {}, retrieved_guidelines: {} } });
      }
      if (route.request().url().endsWith('/api/log')) logs.push(route.request().postDataJSON());
      return route.fulfill({ json: { ok: true } });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto('https://chatgpt.com/');
      await page.addStyleTag({ path: path.join(root, 'extension/style.css') });
      await page.addScriptTag({ path: path.join(root, 'extension/settings.js') });
      await page.addScriptTag({ path: path.join(root, 'extension/content.js') });
      const input = page.locator('#prompt-textarea');
      const original = 'Explain the attached photo and API caching.\n'.repeat(120).trim();
      await input.fill(original);
      await input.focus();
      await page.waitForFunction(() => !document.querySelector('#promptlab-input-overlay').hidden);
      await page.waitForFunction(() => {
        const a = document.querySelector('#promptlab-input-overlay').getBoundingClientRect(), b = document.querySelector('form').getBoundingClientRect();
        return Math.abs(a.height-b.height)<2 && Math.abs(a.top-b.top)<2;
      });
      const shortcut = platform === 'MacIntel' ? 'Meta+Shift+Semicolon' : 'Control+Shift+Period';
      assert.equal(await page.locator('#promptlab-inline-chip kbd').getAttribute('aria-label'), platform === 'MacIntel' ? 'Command+Shift+;' : 'Ctrl+Shift+.');
      await input.press(shortcut);
      await page.waitForFunction(() => document.querySelector('#promptlab-input-overlay').classList.contains('is-improving'));
      await input.press(shortcut);
      await page.waitForTimeout(150);
      assert.equal(requests.length, 1, 'Repeated shortcut must not issue a second request');
      assert.equal(requests[0].attachment_context.has_attachment, true);
      assert.equal(requests[0].original_prompt, original);
      await verifyLayout(page);
      const before = await page.locator('#promptlab-input-overlay').screenshot();
      await page.waitForTimeout(200);
      const after = await page.locator('#promptlab-input-overlay').screenshot();
      assert(!before.equals(after), 'Native progress motion must change pixels');
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
      assert.equal(await page.locator('.promptlab-inline-progress i').first().evaluate(el => getComputedStyle(el).animationName), 'none');
      await page.screenshot({ path: path.join(output, `inline-${locale}-${platform}-busy.png`) });
      release();
      await page.waitForFunction(() => !document.querySelector('#promptlab-undo-toast').hidden);
      await page.waitForFunction(() => document.querySelector('#prompt-textarea').innerText === 'A clearer prompt.');
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#promptlab-inline-chip')).opacity === '0');
      await verifyLayout(page);
      const bounds = await page.locator('#promptlab-undo-toast').boundingBox();
      assert(bounds.x >= 0 && bounds.x + bounds.width <= 390);
      await page.screenshot({ path: path.join(output, `inline-${locale}-${platform}-done.png`) });
      await page.locator('#promptlab-undo-toast button').click();
      assert.equal(await input.innerText(), original);
      await page.waitForFunction(() => !document.querySelector('#promptlab-input-overlay').hidden);
      await page.evaluate(() => { document.querySelector('form').style.top = '400px'; window.dispatchEvent(new Event('resize')); });
      await page.waitForFunction(() => !document.querySelector('#promptlab-input-overlay').hidden && Math.abs(document.querySelector('#promptlab-input-overlay').getBoundingClientRect().top - 400) < 2);
      for (let i = 0; logs.length < 2 && i < 100; i++) await page.waitForTimeout(20);
      assert.deepEqual(logs.map(log => log.used_improved), [true, false]);
      assert.equal(logs[0].session_id, logs[1].session_id);
      assert.deepEqual(errors, []);
    } finally { await context.close(); }
  }
  console.log('[PASS] Inline: KO/EN, Mac/Windows keys, long rich-text input with attachment, repeat guard, motion/reduced motion, viewport bounds, Undo logs and resizing');
}

async function main() {
  await fs.mkdir(output, { recursive: true });
  const server = http.createServer(async (req, res) => {
    try {
      const file = path.join(root, 'extension', req.url === '/' ? 'popup.html' : req.url);
      const data = await fs.readFile(file);
      res.setHeader('Content-Type', file.endsWith('.css') ? 'text/css' : file.endsWith('.js') ? 'application/javascript' : file.endsWith('.png') ? 'image/png' : 'text/html');
      res.end(data);
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  try {
    for (const locale of ['ko', 'en']) {
      const messages = JSON.parse(await fs.readFile(path.join(root, 'extension/_locales', locale, 'messages.json'), 'utf8'));
      const context = await browser.newContext({ viewport: { width: 380, height: 650 }, locale });
      await context.addInitScript(mockChrome, { messages, locale });
      await context.route('https://promptlab-server.onrender.com/health', (route) => route.fulfill({ json: { ok: true } }));
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`http://127.0.0.1:${server.address().port}`);
      await page.waitForFunction(() => !document.querySelector('#custom-instructions').disabled);
      assert.equal(await page.locator('[name="rewrite-mode"][value="balanced"]').isChecked(), true);
      await page.locator('[value="detailed"]').check();
      await page.waitForFunction(() => !document.querySelector('[value="detailed"]').disabled);
      const editor = page.locator('#custom-instructions');
      await editor.fill('Use TypeScript for code examples. Skip introductions.');
      await page.locator('[value="light"]').check();
      await page.waitForFunction(() => !document.querySelector('[value="light"]').disabled);
      assert.equal(await page.locator('#settings-status').textContent(), messages.unsavedPreferences.message);
      await page.locator('[value="detailed"]').check();
      await page.waitForFunction(() => !document.querySelector('[value="detailed"]').disabled);
      await page.locator('#save-preferences').click();
      await page.waitForFunction(() => document.querySelector('#save-preferences').disabled && !document.querySelector('#custom-instructions').disabled);
      assert.equal(await page.locator('#instructions-enabled').isChecked(), true);
      await page.reload();
      await page.waitForFunction(() => !document.querySelector('#custom-instructions').disabled);
      assert.equal(await editor.inputValue(), 'Use TypeScript for code examples. Skip introductions.');
      assert.equal(await page.locator('[value="detailed"]').isChecked(), true);
      await page.locator('#instructions-enabled').uncheck();
      await page.waitForFunction(() => !document.querySelector('#instructions-enabled').disabled);
      await page.reload();
      await page.waitForFunction(() => !document.querySelector('#custom-instructions').disabled);
      assert.equal(await page.locator('#instructions-enabled').isChecked(), false);
      assert.ok((await editor.inputValue()).includes('TypeScript'));
      await editor.fill('x'.repeat(600));
      assert.equal(await page.locator('#instructions-count').textContent(), '600 / 600');
      await page.evaluate(() => localStorage.setItem('fail-next-save', '1'));
      await page.locator('#save-preferences').click();
      await page.waitForFunction(() => document.querySelector('#settings-status').classList.contains('is-error'));
      assert.equal(await page.locator('#save-preferences').isDisabled(), false);
      await editor.fill('');
      await page.locator('#save-preferences').click();
      await page.waitForFunction(() => document.querySelector('#save-preferences').disabled && !document.querySelector('#custom-instructions').disabled);
      await page.reload();
      await page.waitForFunction(() => !document.querySelector('#custom-instructions').disabled);
      assert.equal(await editor.inputValue(), '');
      assert.equal(await page.locator('#instructions-enabled').isChecked(), false);
      for (const swatch of await page.locator('.color-swatch').all()) {
        await swatch.click();
        assert.equal(await swatch.getAttribute('aria-pressed'), 'true');
      }
      await page.reload();
      await page.waitForFunction(() => !document.querySelector('#custom-instructions').disabled);
      assert.equal(await page.locator('[data-color="gray"]').getAttribute('aria-pressed'), 'true');
      for (const scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForTimeout(200);
        await verifyLayout(page);
        await page.screenshot({ path: path.join(output, `popup-${locale}-${scheme}.png`), fullPage: true });
      }
      await page.setViewportSize({ width: 320, height: 650 });
      await page.locator('summary').click();
      await verifyLayout(page);
      for (const viewport of [{ width: 320, height: 498 }, { width: 380, height: 300 }]) {
        await page.setViewportSize(viewport);
        await page.locator('[data-color="red"]').click();
        assert.equal(await page.locator('[data-color="red"]').getAttribute('aria-pressed'), 'true');
        await verifyLayout(page);
        const frame = await page.evaluate(() => {
          const title = document.querySelector('h1').getBoundingClientRect();
          const status = document.querySelector('#server-status').getBoundingClientRect();
          const main = document.querySelector('main').getBoundingClientRect();
          return { headerOverlap: status.top < title.bottom, titleOutside: title.right > innerWidth, scrollerOutside: main.bottom > innerHeight + 1, canScroll: document.querySelector('main').scrollHeight > document.querySelector('main').clientHeight };
        });
        assert.deepEqual(frame, { headerOverlap: false, titleOutside: false, scrollerOutside: false, canScroll: true });
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    await verifyInlineStates(browser);

    const messages = JSON.parse(await fs.readFile(path.join(root, 'extension/_locales/en/messages.json'), 'utf8'));
    for (const host of ['chatgpt.com', 'gemini.google.com', 'claude.ai']) {
      const context = await browser.newContext();
      await context.addInitScript(mockChrome, { messages, locale: 'en' });
      await context.route(`https://${host}/**`, (route) => route.fulfill({ contentType: 'text/html', body: '<!doctype html><form style="margin:200px auto;width:600px"><textarea id="prompt-textarea" aria-label="Prompt" style="width:600px;height:140px"></textarea></form>' }));
      const requests = [];
      await context.route('https://promptlab-server.onrender.com/**', (route) => {
        if (route.request().url().endsWith('/api/improve')) {
          const payload = route.request().postDataJSON();
          requests.push(payload);
          return route.fulfill({ json: { improved_prompt: 'Explain API caching clearly.', provider: 'openai', before_analysis: {}, after_analysis: {}, retrieved_guidelines: {} } });
        }
        return route.fulfill({ json: { ok: true } });
      });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      await page.goto(`https://${host}/`);
      await page.addScriptTag({ path: path.join(root, 'extension/settings.js') });
      await page.addScriptTag({ path: path.join(root, 'extension/content.js') });
      await page.addStyleTag({ path: path.join(root, 'extension/style.css') });
      await page.waitForSelector('#promptlab-root', { state: 'attached' });
      for (const instructionsEnabled of [true, false]) {
        await page.evaluate(async (enabled) => chrome.storage.local.set({ promptlab_rewrite_settings: { mode: 'light', instructions: 'Use TypeScript.', instructionsEnabled: enabled } }), instructionsEnabled);
        await page.locator('#prompt-textarea').fill('Explain API caching');
        await page.locator('#prompt-textarea').press('Meta+Shift+Semicolon');
        await page.waitForFunction(() => document.querySelector('#prompt-textarea').value === 'Explain API caching clearly.');
        assert.deepEqual(requests.at(-1).rewrite_settings, { mode: 'light', instructions: instructionsEnabled ? 'Use TypeScript.' : '' });
        await page.waitForFunction(() => getComputedStyle(document.querySelector('#promptlab-inline-chip')).opacity === '0');
        await page.locator('#promptlab-undo-toast button').click();
        assert.equal(await page.locator('#prompt-textarea').inputValue(), 'Explain API caching');
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
    console.log('[PASS] Korean/English popup: save/reopen/toggle/delete/error, light/dark and narrow layout');
    console.log('[PASS] ChatGPT/Gemini/Claude: live setting changes, shortcut request payload, and Undo');
    console.log(`Screenshots: ${output}`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
