const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '../..');
async function main() {
  const profile = await fs.mkdtemp(path.join(os.tmpdir(), 'promptlab-native-popup-'));
  const context = await chromium.launchPersistentContext(profile, {
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    headless: true, viewport: { width: 1200, height: 900 },
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--host-resolver-rules=MAP promptlab-server.onrender.com ~NOTFOUND'],
  });
  try {
    const requests = [], logs = [];
    let release, failNext = false;
    await context.route('https://promptlab-server.onrender.com/**', async route => {
      const headers = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type' };
      if (route.request().method() === 'POST' && route.request().url().endsWith('/api/improve')) {
        requests.push(route.request().postDataJSON());
        await new Promise(resolve => { release = resolve; });
        if (failNext) {
          failNext = false;
          return route.fulfill({ status: 503, headers, json: { error: 'Test-only outage' } });
        }
        return route.fulfill({ headers, json: { improved_prompt: 'A clearer prompt.', provider: 'fixture', before_analysis: {}, after_analysis: {}, retrieved_guidelines: {} } });
      }
      if (route.request().method() === 'POST' && route.request().url().endsWith('/api/log')) logs.push(route.request().postDataJSON());
      return route.fulfill({ headers, json: { ok: true } });
    });
    const page = context.pages()[0];
    const cdp = await context.browser().newBrowserCDPSession();
    const { id } = await cdp.send('Extensions.loadUnpacked', { path: path.join(root, 'extension') });
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{}] });
    const tab = targetInfos.find(target => target.type === 'tab');
    if (!tab) throw new Error('No tab target: ' + JSON.stringify(targetInfos));
    let target, sessionId, sequence = 0;
    const send = (method, params = {}) => new Promise((resolve, reject) => {
      const requestId = ++sequence;
      const timeout = setTimeout(() => { cdp.off('Target.receivedMessageFromTarget', receive); reject(new Error(`Timed out: ${method}`)); }, 10000);
      const receive = event => {
        if (event.sessionId !== sessionId) return;
        const message = JSON.parse(event.message);
        if (message.id !== requestId) return;
        clearTimeout(timeout); cdp.off('Target.receivedMessageFromTarget', receive);
        if (message.error) reject(new Error(message.error.message)); else resolve(message.result);
      };
      cdp.on('Target.receivedMessageFromTarget', receive);
      cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: requestId, method, params }) }).catch(reject);
    });
    const evaluate = async (fn, arg) => {
      const result = await send('Runtime.evaluate', { expression: `(${fn})(${JSON.stringify(arg) || ''})`, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const waitFor = async fn => {
      for (let i = 0; i < 100; i++) {
        if (await evaluate(fn)) return;
        await page.waitForTimeout(50);
      }
      throw new Error(`Popup condition timed out: ${fn}`);
    };
    const openPopup = async () => {
      await cdp.send('Extensions.triggerAction', { id, targetId: tab.targetId });
      target = null;
      for (let i = 0; i < 100 && !target; i++) {
        target = (await cdp.send('Target.getTargets')).targetInfos.find(t => t.url === `chrome-extension://${id}/popup.html`);
        if (!target) await page.waitForTimeout(50);
      }
      if (!target) throw new Error('Native action popup target not exposed');
      ({ sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false }));
      await waitFor(() => document.querySelector('#custom-instructions') && !document.querySelector('#custom-instructions').disabled);
    };
    const click = async selector => {
      const point = await evaluate(selector => {
        const element = document.querySelector(selector);
        element.scrollIntoView({ block: 'nearest' });
        const rect = element.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      }, selector);
      await send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', clickCount: 1, ...point });
      await send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', clickCount: 1, ...point });
    };
    const storage = () => evaluate(() => chrome.storage.local.get(['promptlab_rewrite_settings', 'promptlab_border_color']));
    await openPopup();
    await page.waitForTimeout(300);
    const inspect = () => {
      const rect = el => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; };
      return { viewport: [innerWidth, innerHeight], dpr: devicePixelRatio, html: rect(document.documentElement), body: rect(document.body), title: rect(document.querySelector('h1')), brand: rect(document.querySelector('.brand')), status: rect(document.querySelector('.status')), main: rect(document.querySelector('main')), swatches: rect(document.querySelector('.color-swatches')), scroll: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] };
    };
    const geometry = (await send('Runtime.evaluate', { expression: `(${inspect})()`, returnByValue: true })).result.value;
    console.log(JSON.stringify(geometry, null, 2));
    assert(geometry.viewport[0] >= 320 && geometry.viewport[0] <= 800, 'Native popup must not collapse to its initial viewport width');
    assert(geometry.title.right <= geometry.viewport[0]);
    assert(geometry.status.y >= geometry.title.bottom, 'Connection status must not overlap the brand title');
    assert(geometry.main.bottom <= geometry.viewport[1] + 1, 'Settings scroller must fit the native popup');
    const screenshot = await send('Page.captureScreenshot');
    await fs.writeFile('/tmp/promptlab-native-popup.png', Buffer.from(screenshot.data, 'base64'));
    const checkColors = async () => {
      const main = document.querySelector('main');
      main.scrollTop = main.scrollHeight;
      const buttons = [...document.querySelectorAll('.color-swatch')];
      for (const button of buttons) {
        button.click();
        await new Promise(resolve => setTimeout(resolve, 30));
      }
      const stored = await chrome.storage.local.get(['promptlab_border_color']);
      const headerBottom = document.querySelector('.app-header').getBoundingClientRect().bottom;
      return { count: buttons.length, visible: buttons.every(button => { const r = button.getBoundingClientRect(); return r.top >= headerBottom && r.bottom <= innerHeight; }), selected: document.querySelector('[data-color="gray"]').getAttribute('aria-pressed'), stored: stored.promptlab_border_color };
    };
    const colors = (await send('Runtime.evaluate', { expression: `(${checkColors})()`, awaitPromise: true, returnByValue: true })).result.value;
    assert.deepEqual(colors, { count: 10, visible: true, selected: 'true', stored: 'gray' });
    const scrolled = await send('Page.captureScreenshot');
    await fs.writeFile('/tmp/promptlab-native-popup-colors.png', Buffer.from(scrolled.data, 'base64'));
    console.log('[PASS] Real Chrome action popup: intrinsic width, non-overlapping header, constrained settings scroller, all 10 colors reachable and real chrome.storage persistence');

    for (const mode of ['light', 'balanced', 'detailed']) {
      await click(`.mode-control label:has([value="${mode}"])`);
      await waitFor(() => !document.querySelector('[name="rewrite-mode"]').disabled);
      assert.equal((await storage()).promptlab_rewrite_settings.mode, mode);
    }
    await click('#custom-instructions');
    await send('Input.insertText', { text: 'Use TypeScript. Skip introductions.' });
    await click('#save-preferences');
    await waitFor(() => document.querySelector('#save-preferences').disabled && !document.querySelector('#custom-instructions').disabled);
    assert.deepEqual((await storage()).promptlab_rewrite_settings, { mode: 'detailed', instructions: 'Use TypeScript. Skip introductions.', instructionsEnabled: true });
    await cdp.send('Target.closeTarget', { targetId: target.targetId });
    await openPopup();
    assert.deepEqual(await evaluate(() => ({ text: document.querySelector('#custom-instructions').value, mode: document.querySelector('[name="rewrite-mode"]:checked').value, enabled: document.querySelector('#instructions-enabled').checked, color: document.querySelector('.color-swatch.is-selected').dataset.color })), { text: 'Use TypeScript. Skip introductions.', mode: 'detailed', enabled: true, color: 'gray' });
    await click('.toggle');
    await waitFor(() => !document.querySelector('#instructions-enabled').disabled);
    assert.equal((await storage()).promptlab_rewrite_settings.instructionsEnabled, false);
    await cdp.send('Target.closeTarget', { targetId: target.targetId });
    await openPopup();
    assert.equal(await evaluate(() => document.querySelector('#instructions-enabled').checked), false);
    assert.equal(await evaluate(() => document.querySelector('#custom-instructions').value), 'Use TypeScript. Skip introductions.');
    await click('.toggle');
    await waitFor(() => !document.querySelector('#instructions-enabled').disabled);
    await cdp.send('Target.closeTarget', { targetId: target.targetId });
    console.log('[PASS] Native settings: actual pointer/typing events, all strengths, save, close/reopen persistence, preference toggle without deleting the text');

    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'warning' || message.type() === 'error') console.log(`[browser ${message.type()}] ${message.text()}`); });
    for (const host of ['chatgpt.com', 'gemini.google.com', 'claude.ai']) {
      await context.route(`https://${host}/**`, route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>
        *{box-sizing:border-box}body{margin:0;background:#f5f7f6}form{position:absolute;left:40px;right:40px;top:300px;padding:16px;background:white;border-radius:20px;overflow:hidden}
        .scroll-frame{max-height:160px;overflow:auto}.ProseMirror{min-height:80px;outline:none;white-space:pre-wrap;font:14px/1.5 system-ui}
        .attachment-preview{height:44px;padding:12px;background:#eef3ef;margin-bottom:12px}
        </style><form><div class="attachment-preview" data-testid="file-thumbnail">photo.png</div><div class="scroll-frame"><div id="prompt-textarea" class="ProseMirror" role="textbox" contenteditable="true"></div></div></form>` }));
      await page.goto(`https://${host}/`);
      // No addScriptTag or mock chrome APIs: manifest injection and storage are real.
      await page.waitForSelector('#promptlab-root', { state: 'attached' });
      const input = page.locator('#prompt-textarea');
      const original = 'Explain the attached photo and API caching.\n'.repeat(120).trim();
      await input.fill(original);
      await input.focus();
      await page.waitForFunction(() => !document.querySelector('#promptlab-input-overlay').hidden);
      await page.waitForFunction(() => {
        const a = document.querySelector('#promptlab-input-overlay').getBoundingClientRect(), b = document.querySelector('form').getBoundingClientRect();
        return Math.abs(a.height - b.height) < 2 && Math.abs(a.top - b.top) < 2;
      });
      await openPopup();
      await click('[data-color="red"]');
      await cdp.send('Target.closeTarget', { targetId: target.targetId });
      await page.waitForFunction(() => document.querySelector('#promptlab-root').style.getPropertyValue('--promptlab-accent-rgb') === '239, 68, 68');
      await input.focus();
      const start = requests.length, logStart = logs.length;
      release = null;
      await input.press('Meta+Shift+Semicolon');
      for (let i = 0; !release && i < 100; i++) await page.waitForTimeout(50);
      assert(release, 'Loaded content script must reach the intercepted API');
      await input.press('Meta+Shift+Semicolon');
      await page.waitForTimeout(150);
      assert.equal(requests.length, start + 1);
      assert.deepEqual(requests.at(-1).rewrite_settings, { mode: 'detailed', instructions: 'Use TypeScript. Skip introductions.' });
      assert.equal(requests.at(-1).original_prompt, original);
      assert.equal(requests.at(-1).attachment_context.has_attachment, true);
      assert.equal(await page.locator('#promptlab-inline-chip').getAttribute('aria-busy'), 'true');
      await page.screenshot({ path: `/tmp/promptlab-native-${host}-busy.png` });
      release();
      await page.waitForFunction(() => document.querySelector('#prompt-textarea').innerText === 'A clearer prompt.');
      await page.waitForFunction(() => !document.querySelector('#promptlab-undo-toast').hidden && getComputedStyle(document.querySelector('#promptlab-inline-chip')).opacity === '0');
      await page.screenshot({ path: `/tmp/promptlab-native-${host}-done.png` });
      await page.locator('#promptlab-undo-toast button').click();
      assert.equal(await input.innerText(), original);
      for (let i = 0; logs.length < logStart + 2 && i < 100; i++) await page.waitForTimeout(30);
      assert.deepEqual(logs.slice(logStart).map(log => log.used_improved), [true, false]);
      assert.equal(logs[logStart].session_id, logs[logStart + 1].session_id);
      assert.equal(logs[logStart].target_platform, host === 'chatgpt.com' ? 'chatgpt' : host === 'claude.ai' ? 'claude' : 'gemini');
      assert.equal(await page.locator('[data-testid="file-thumbnail"]').count(), 1);

      failNext = true;
      release = null;
      await input.press('Meta+Shift+Semicolon');
      for (let i = 0; !release && i < 100; i++) await page.waitForTimeout(30);
      assert(release, 'Outage request must reach the intercepted API');
      assert.equal(requests.length, start + 2);
      await page.waitForFunction(() => document.querySelector('#promptlab-inline-chip').getAttribute('aria-busy') === 'true');
      release();
      await page.waitForFunction(() => document.querySelector('#promptlab-inline-chip').getAttribute('aria-busy') === 'false');
      assert.equal(await input.innerText(), original, 'An API outage must not lose the original text');
      assert.equal(await page.locator('#promptlab-undo-toast').isVisible(), false);
      release = null;
      await input.press('Meta+Shift+Semicolon');
      for (let i = 0; !release && i < 100; i++) await page.waitForTimeout(30);
      assert(release, 'Shortcut must work again after an API outage');
      release();
      await page.waitForFunction(() => document.querySelector('#prompt-textarea').innerText === 'A clearer prompt.');
      for (let i = 0; logs.length < logStart + 3 && i < 100; i++) await page.waitForTimeout(30);
      console.log(`[PASS] Loaded extension on ${host} fixture: automatic injection, live popup color, saved preferences payload, long text + attachment, duplicate guard, Undo logs, API outage and retry`);
    }
    assert.deepEqual(errors, []);
    await openPopup();
    await evaluate(() => {
      const editor = document.querySelector('#custom-instructions');
      editor.value = '';
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await click('#save-preferences');
    await waitFor(() => document.querySelector('#save-preferences').disabled && !document.querySelector('#custom-instructions').disabled);
    assert.deepEqual((await storage()).promptlab_rewrite_settings, { mode: 'detailed', instructions: '', instructionsEnabled: false });
    console.log('[PASS] Native preference deletion and no uncaught page errors; production API calls blocked by DNS rule');
  } finally {
    await context.close();
    await fs.rm(profile, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
