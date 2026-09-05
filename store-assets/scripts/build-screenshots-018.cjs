const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const PROJECT_ROOT = path.resolve(ROOT, '..');
const OUTPUT_DIR = path.join(ROOT, 'screenshots-0.1.8-en');
const EXTENSION_STYLE = path.join(PROJECT_ROOT, 'extension', 'style.css');
const POPUP_PATH = path.join(PROJECT_ROOT, 'extension', 'popup.html');
const ICON_PATH = path.join(PROJECT_ROOT, 'extension', 'icons', 'icon128.png');
const CHROME_PATH = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const WIDTH = 1280;
const HEIGHT = 800;

const PALETTES = {
  purple: ['168, 85, 247', '216, 180, 254', '88, 28, 135'],
  teal: ['20, 184, 166', '94, 234, 212', '15, 118, 110'],
};

const pageStyles = `
  * { box-sizing: border-box; }
  html, body { width: 100%; height: 100%; }
  body {
    margin: 0;
    overflow: hidden;
    background: #f5f6f8;
    color: #17171b;
    font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  .store-header {
    position: absolute;
    top: 46px;
    left: 64px;
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .store-header img { width: 38px; height: 38px; border-radius: 9px; }
  .store-brand { font-size: 17px; font-weight: 760; }
  .store-version { margin-left: 5px; color: #777782; font-size: 13px; font-weight: 650; }
  .store-copy { position: absolute; top: 122px; left: 64px; right: 64px; }
  .store-copy h1 { margin: 0; font-size: 42px; line-height: 1.08; letter-spacing: 0; }
  .store-copy p { margin: 13px 0 0; color: #5d5e68; font-size: 19px; line-height: 1.45; }
  .platforms { position: absolute; right: 64px; top: 57px; color: #666873; font-size: 14px; font-weight: 650; }
  .composer {
    position: fixed;
    left: var(--composer-left, 80px);
    top: var(--composer-top, 342px);
    width: var(--composer-width, 1120px);
    height: var(--composer-height, 178px);
    padding: 31px 34px;
    overflow: hidden;
    border: 1px solid #d9dbe1;
    border-radius: 25px;
    background: #ffffff;
    box-shadow: 0 20px 50px rgba(25, 26, 33, 0.08);
    font-size: 20px;
    line-height: 1.55;
  }
  .composer-meta {
    position: absolute;
    right: 26px;
    bottom: 22px;
    color: #8a8b93;
    font-size: 13px;
    font-weight: 600;
  }
  .store-footnote {
    position: absolute;
    left: 66px;
    bottom: 54px;
    color: #787983;
    font-size: 14px;
    font-weight: 600;
  }
  .popup-preview {
    position: fixed;
    top: 286px;
    right: 58px;
    width: 340px;
    border: 1px solid rgba(30, 31, 38, 0.1);
    border-radius: 12px;
    box-shadow: 0 24px 60px rgba(21, 22, 29, 0.2);
  }
`;

function iconDataUrl() {
  return `data:image/png;base64,${fs.readFileSync(ICON_PATH).toString('base64')}`;
}

function ringMarkup() {
  return `
    <div id="promptlab-input-ring" aria-hidden="true">
      <svg class="promptlab-ring-orbit" focusable="false" aria-hidden="true">
        <rect class="promptlab-ring-track" pathLength="100"></rect>
        <rect class="promptlab-ring-trace promptlab-ring-trace-primary" pathLength="100"></rect>
        <rect class="promptlab-ring-trace promptlab-ring-trace-secondary" pathLength="100"></rect>
      </svg>
    </div>`;
}

function promptLabMarkup({ state, shortcut = true, toast = false }) {
  const classes = state === 'improving' ? 'is-focused is-improving' : 'is-focused is-ready';
  return `
    <div id="promptlab-root">
      <div id="promptlab-input-overlay" class="${classes}">
        ${ringMarkup()}
        <button id="promptlab-inline-chip" type="button">
          <kbd>${shortcut ? 'Command+Shift+;' : ''}</kbd>
          <span class="promptlab-inline-progress" aria-hidden="true"><i></i><i></i></span>
          <span class="promptlab-inline-progress-label">Improving prompt</span>
        </button>
      </div>
      ${toast ? `
        <section id="promptlab-undo-toast" aria-live="polite">
          <span class="promptlab-toast-check" aria-hidden="true"></span>
          <span class="promptlab-toast-message">Improved prompt applied</span>
          <button type="button"><span class="promptlab-toast-undo-icon" aria-hidden="true"></span>Undo</button>
        </section>` : ''}
    </div>`;
}

function documentMarkup({ title, subtitle, prompt, state = 'ready', color = 'purple', colorLayout = false, popupDataUrl = '', toast = false }) {
  const [accent, light, dark] = PALETTES[color];
  const composerStyle = colorLayout
    ? '--composer-left:64px;--composer-top:330px;--composer-width:760px;--composer-height:190px'
    : '';
  const overlayStyle = colorLayout
    ? 'left:64px;top:330px;width:760px;height:190px;--promptlab-input-radius:25px'
    : 'left:80px;top:342px;width:1120px;height:178px;--promptlab-input-radius:25px';
  const toastStyle = toast ? 'left:794px;top:292px' : '';

  return `<!doctype html>
    <html lang="en">
      <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
      <body>
        <div class="store-header"><img src="${iconDataUrl()}" alt=""><span class="store-brand">PromptLab</span><span class="store-version">0.1.8</span></div>
        <div class="platforms">ChatGPT&nbsp;&nbsp;·&nbsp;&nbsp;Gemini&nbsp;&nbsp;·&nbsp;&nbsp;Claude</div>
        <div class="store-copy"><h1>${title}</h1><p>${subtitle}</p></div>
        <div class="composer" style="${composerStyle}">${prompt}<span class="composer-meta">AI composer</span></div>
        <div style="--promptlab-accent-rgb:${accent};--promptlab-accent-light-rgb:${light};--promptlab-accent-dark-rgb:${dark}">
          ${promptLabMarkup({ state, toast })}
        </div>
        ${popupDataUrl ? `<img class="popup-preview" src="${popupDataUrl}" alt="PromptLab color settings">` : ''}
        <div class="store-footnote">Private by design: full prompts are not stored in analytics logs.</div>
        <style>
          #promptlab-input-overlay { ${overlayStyle}; }
          #promptlab-undo-toast { ${toastStyle}; }
        </style>
      </body>
    </html>`;
}

async function renderStoreScreen(page, fileName, options, waitMs = 300) {
  await page.setContent(documentMarkup(options), { waitUntil: 'load' });
  await page.addStyleTag({ path: EXTENSION_STYLE });
  await page.addStyleTag({ content: pageStyles });
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: path.join(OUTPUT_DIR, fileName) });
  console.log(path.join(OUTPUT_DIR, fileName));
}

async function capturePopup(browser) {
  const page = await browser.newPage({ viewport: { width: 340, height: 430 }, deviceScaleFactor: 1 });
  await page.goto(`file://${POPUP_PATH}`, { waitUntil: 'load' });
  await page.evaluate(() => {
    document.querySelector('#server-status').textContent = 'Connected';
    document.querySelector('#server-status').classList.add('is-ok');
    document.querySelector('#selected-color').textContent = 'Teal';
    document.querySelector('[data-color="teal"]').classList.add('is-selected');
  });
  const screenshot = await page.screenshot({ fullPage: true });
  await page.close();
  return `data:image/png;base64,${screenshot.toString('base64')}`;
}

async function build() {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ executablePath: CHROME_PATH, headless: true });
  const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });

  await renderStoreScreen(page, 'promptlab-01-shortcut.png', {
    title: 'Write naturally. Improve instantly.',
    subtitle: 'Use Command+Shift+; on Mac or Ctrl+Shift+. on Windows.',
    prompt: 'Help me plan a focused study schedule for this week.',
  });

  await renderStoreScreen(page, 'promptlab-02-improving.png', {
    title: 'Stay in the flow while PromptLab rewrites.',
    subtitle: 'A lightweight progress state follows the active AI input box.',
    prompt: 'Help me plan a focused study schedule for this week.',
    state: 'improving',
  }, 850);

  await renderStoreScreen(page, 'promptlab-03-undo.png', {
    title: 'Applied in place. Easy to undo.',
    subtitle: 'Review the clearer prompt immediately, or restore the original in one click.',
    prompt: 'Create a focused seven-day study plan with daily goals, time blocks, and a final review session.',
    toast: true,
  });

  const popupDataUrl = await capturePopup(browser);
  await renderStoreScreen(page, 'promptlab-04-customize-color.png', {
    title: 'Choose a border color that fits you.',
    subtitle: 'Open PromptLab from the Chrome toolbar and pick from 10 colors.',
    prompt: 'Turn this idea into a clear, actionable prompt.',
    color: 'teal',
    colorLayout: true,
    popupDataUrl,
  });

  await browser.close();
}

build().catch((error) => {
  console.error(error);
  process.exit(1);
});
