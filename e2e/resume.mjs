// Browser test: a turn or a new game survives menus, reloads and leaving the app.
// Run: node e2e/resume.mjs
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve('.');
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };
const server = createServer(async (req, res) => {
  const path = join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname).replace(/\/$/, '/index.html'));
  try { res.writeHead(200, { 'Content-Type': types[extname(path)] || 'text/plain' }); res.end(await readFile(path)); }
  catch { res.writeHead(404); res.end(); }
}).listen(0);
const base = `http://localhost:${server.address().port}/`;
const reply = (obj) => ({ json: { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] }, finishReason: 'STOP' }] } });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let delay = 0;          // ms to hold the next narrator / world reply
let failNext = false;   // drop narrator requests while set (as if the app was put away)
let refereeCalls = 0;
let narrations = 0;

async function fakeGemini(route) {
  const url = route.request().url();
  if (url.includes('/models?')) return route.fulfill({ json: { models: [{ name: 'models/gemini-3.5-flash-lite', supportedGenerationMethods: ['generateContent'] }, { name: 'models/gemini-3.8-flash', supportedGenerationMethods: ['generateContent'] }] } });
  const body = JSON.parse(route.request().postData());
  const sys = body.systemInstruction?.parts?.[0]?.text || '';
  if (sys.startsWith('You design settings')) {
    if (delay) await sleep(delay);
    return route.fulfill(reply({ title: 'Saltmarsh', setting: 'A rainy port.', currency: { name: 'penny', plural: 'pennies' }, startDate: { year: 1247, month: 3, day: 4, hour: 21 }, startPlace: { name: 'The Drowned Rat', type: 'tavern', description: 'Smoky.' }, priceCatalogue: [] }));
  }
  if (sys.startsWith('You suggest')) return route.fulfill(reply({ name: 'Ada Venn', sex: 'female', pronouns: 'she/her', age: 29, looks: 'Wiry.', background: 'Smuggler.' }));
  if (sys.startsWith('You create player characters')) {
    if (delay) await sleep(delay);
    return route.fulfill(reply({ backstory: 'You ran salt.', attributes: { strength: 1, agility: 2, toughness: 1, wits: 1, charm: 0, nerve: 1 }, skills: [{ name: 'Lockpicking', level: 3 }], money: 40, gear: [{ name: 'Wool trousers', size: 'medium', tags: ['pants'], slot: 'worn' }], ally: { name: 'Tomas', sex: 'male', pronouns: 'he/him', age: 58, looks: 'Grey.', role: 'captain', why: 'Friend.' }, enemy: { name: 'Mirela', sex: 'female', pronouns: 'she/her', age: 35, looks: 'Tall.', role: 'officer', why: 'Grudge.' } }));
  }
  if (sys.startsWith('You are the referee')) {
    refereeCalls++;
    return route.fulfill(reply({ possible: true, needsCheck: true, skill: 'Lockpicking', attribute: 'agility', difficulty: 12, duration: 'short', kind: 'other' }));
  }
  if (sys.startsWith('You keep the running summary')) return route.fulfill(reply('Summary.'));
  if (delay) await sleep(delay);
  if (failNext) return route.abort('failed');
  const user = body.contents[0].parts[0].text;
  if (user.includes('OPENING SCENE')) return route.fulfill(reply({ prose: 'Rain on the Drowned Rat.', changes: [] }));
  narrations++;
  return route.fulfill(reply({ prose: `Narration ${narrations}.`, changes: [] }));
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 393, height: 851 }, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('dialog', (d) => d.accept());
await ctx.route('https://generativelanguage.googleapis.com/**', fakeGemini);
const btn = (name) => page.getByRole('button', { name, exact: true });
// Pretend the app was put in the background and brought back.
const setHidden = (hidden) => page.evaluate((h) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => h });
  document.dispatchEvent(new Event('visibilitychange'));
}, hidden);

try {
  await page.goto(base);
  await btn('Open Settings').click();
  await page.fill('input[type=password]', 'k');
  await btn('Check key').click();
  await page.waitForSelector('text=Key works');
  await page.click('[aria-label=Close]');

  // 1. Reload in the middle of building a character: carry on from that step.
  await btn('New world').click();
  await btn('1931 Chicago').click();
  await btn('Build this world').click();
  await btn('Use this world').click();
  await btn('Suggest the blanks').click();
  await page.waitForSelector('input[value="Ada Venn"]');
  delay = 3000;
  await btn('Begin').click();
  await page.waitForSelector('text=Writing your backstory');
  await page.reload();
  await page.waitForSelector('text=It was interrupted');
  delay = 0;
  await btn('Carry on').click();
  await page.waitForSelector('text=Rain on the Drowned Rat.');

  // 2. Open Settings while the narrator is writing: the turn still lands.
  delay = 2500;
  await page.fill('.action-bar textarea', 'I pick the lock.');
  await btn('Send').click();
  await page.waitForSelector('text=The narrator is writing');
  await page.click('[aria-label=Settings]');
  await page.click('[aria-label=Close]');
  await page.waitForSelector('text=The narrator is writing');
  await page.waitForSelector('text=Narration 1.');
  if (await page.locator('.msg.player', { hasText: 'I pick the lock.' }).count() !== 1) throw new Error('action shown twice or lost');

  // 3. Reload mid-turn: the turn resumes with the same dice (no new referee call).
  const before = refereeCalls;
  await page.fill('.action-bar textarea', 'I pick the next lock.');
  await btn('Send').click();
  await page.waitForSelector('text=The narrator is writing');
  const rolled = await page.locator('.msg.roll').last().textContent();
  await page.reload();
  delay = 0;
  await page.waitForSelector('text=Narration');
  await page.waitForFunction(() => document.body.innerText.includes('I pick the next lock.') && /Narration \d+\.\s*$/.test(document.querySelector('.log').innerText.trim()));
  if (refereeCalls !== before + 1) throw new Error(`referee asked again after reload (${refereeCalls - before} calls)`);
  const shown = await page.locator('.msg.roll').last().textContent();
  if (rolled.match(/rolled (\d+)/)[1] !== shown.match(/rolled (\d+)/)[1]) throw new Error(`dice changed: ${rolled} -> ${shown}`);

  // 4. App put away while the request is cut off: no error, it carries on when back.
  failNext = true;
  delay = 1500;
  await page.fill('.action-bar textarea', 'I wait.');
  await btn('Send').click();
  await page.waitForSelector('text=The narrator is writing');
  await setHidden(true);
  await page.waitForSelector('text=Picking up where you left off');
  delay = 0;
  if (await page.locator('.problem').count()) throw new Error('error box shown while away');
  failNext = false;
  await setHidden(false);
  await page.waitForFunction(() => /Narration \d+\.\s*$/.test(document.querySelector('.log').innerText.trim()) && document.body.innerText.includes('I wait.'));
  if (await page.locator('.msg.player', { hasText: 'I wait.' }).count() !== 1) throw new Error('action duplicated after resume');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'resume ok');
} catch (err) {
  await page.screenshot({ path: `${process.env.SHOTS || '.'}/resume-failure.png` });
  console.log('FAILED:', err.message, errors.join('\n'));
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
