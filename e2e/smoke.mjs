// Phone-sized browser check with a fake Gemini. Run: node e2e/smoke.mjs
// Serves the folder, opens it in Chromium, and walks through the main screens.
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] || '.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  try { res.writeHead(200, { 'Content-Type': types[extname(path)] || 'text/plain' }); res.end(await readFile(path)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;

export async function launch(fakeGemini) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://generativelanguage.googleapis.com/**', fakeGemini);
  await page.goto(base);
  return { browser, page, errors, close: async () => { await browser.close(); server.close(); } };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  let calls = 0;
  const { page, errors, close } = await launch(async (route) => {
    const url = route.request().url();
    if (url.includes('/models?')) {
      return route.fulfill({ json: { models: [
        { name: 'models/gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] },
      ] } });
    }
    calls++;
    if (calls === 1) return route.fulfill({ json: { promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } } });
    return route.fulfill({ json: { candidates: [{ content: { parts: [{ text: 'Rain needles the harbour. *Lanterns* sway.\n\nA gull screams.' }] }, finishReason: 'STOP' }] } });
  });
  const shot = (n) => page.screenshot({ path: `${process.env.SHOTS || '.'}/${n}.png` });
  await page.waitForSelector('text=Open Settings');
  await shot('0-welcome');
  await page.click('text=Open Settings');
  await page.fill('input[type=password]', 'fake-key');
  await page.click('text=Check key');
  await page.waitForSelector('text=Key works');
  await shot('1-settings');
  await page.click('[aria-label=Close]');
  await page.waitForSelector('text=Stage 0 test');
  await page.fill('textarea', 'Describe a harbour at night.');
  await page.click('button:has-text("Send")');

  await page.waitForSelector('text=blocked');
  await shot('2-blocked');
  await page.click('button:has-text("Resend")');

  await page.waitForSelector('text=A gull screams.');
  await shot('3-reply');
  await page.click('[aria-label=Settings]');
  await page.waitForSelector('text=2 / 500');
  await shot('4-usage');
  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'smoke ok');
  await close();
}
