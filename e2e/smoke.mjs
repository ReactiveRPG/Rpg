// Phone-sized browser playtest with a fake Gemini. Run: node e2e/smoke.mjs
// Serves the folder, opens it in Chromium, and plays through the main screens.
// Screenshots go to $SHOTS (default: current folder).
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

const reply = (obj) => ({ json: { candidates: [{ content: { parts: [{ text: typeof obj === 'string' ? obj : JSON.stringify(obj) }] }, finishReason: 'STOP' }] } });

let narrations = 0;
let blockNext = 0;
function fakeGemini(route) {
  const url = route.request().url();
  if (url.includes('/models?')) {
    return route.fulfill({ json: { models: [
      { name: 'models/gemini-3.5-flash-lite', displayName: 'Gemini 3.5 Flash-Lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-3.8-flash', displayName: 'Gemini 3.8 Flash', supportedGenerationMethods: ['generateContent'] },
    ] } });
  }
  const body = JSON.parse(route.request().postData());
  const sys = body.systemInstruction?.parts?.[0]?.text || '';
  const user = body.contents?.[0]?.parts?.[0]?.text || '';
  if (sys.startsWith('You design settings')) {
    return route.fulfill(reply({
      title: 'Saltmarsh', setting: 'A rain-soaked harbour city ruled by guilds.', era: 'Late medieval', technology: 'Crossbows, no magic',
      currency: { name: 'penny', plural: 'pennies', note: '12 pennies to a shilling' },
      monthNames: ['Frostmoon', 'Thaw', 'Seedfall', 'Greening', 'Bloom', 'Highsun', 'Harvest', 'Reaping', 'Leaffall', 'Mist', 'Darkening', 'Deepwinter'],
      startDate: { year: 1247, month: 3, day: 4, hour: 21 }, artStyle: 'Muted oil painting',
      startPlace: { name: 'The Drowned Rat', type: 'tavern', region: 'Lower Quays', description: 'A low, smoky taproom.', usual: 'dockhands', soundTags: ['crowd', 'fire', 'rain'] },
      nearbyPlaces: [{ name: 'Harbour Wall', type: 'street', description: 'Wet stone.', travelMinutes: 5 }],
      priceCatalogue: [{ name: 'Mug of ale', value: 2, size: 'medium', weight: 0.6, tags: ['drink'] }, { name: 'Knife', value: 30, size: 'small', weight: 0.3, tags: ['weapon'] }],
    }));
  }
  if (sys.startsWith('You suggest')) {
    return route.fulfill(reply({ name: 'Ada Venn', sex: 'female', pronouns: 'she/her', age: 29, looks: 'Short and wiry, a scar through her lip.', background: 'Ex-sailor turned smuggler.' }));
  }
  if (sys.startsWith('You create player characters')) {
    return route.fulfill(reply({
      backstory: 'You ran salt past the customs boats for six years.\n\nNow the guild wants its cut.',
      attributes: { strength: 1, agility: 2, toughness: 1, wits: 1, charm: 0, nerve: 1 },
      skills: [{ name: 'Lockpicking', level: 3 }, { name: 'Blades', level: 2 }, { name: 'Stealth', level: 2 }],
      money: 40,
      gear: [
        { name: 'Wool trousers', size: 'medium', weight: 0.8, tags: ['pants', 'clothing'], slot: 'worn' },
        { name: 'Oilskin jacket', size: 'medium', weight: 1.5, tags: ['jacket', 'clothing'], slot: 'worn' },
        { name: 'Sea boots', size: 'medium', weight: 1.2, tags: ['boots', 'clothing'], slot: 'worn' },
        { name: 'Knife', size: 'small', weight: 0.3, value: 30, tags: ['weapon'], slot: 'belt' },
        { name: 'Lockpicks', size: 'tiny', weight: 0.1, tags: ['tool'], slot: 'pants_pockets' },
        { name: 'Shoulder bag', size: 'medium', weight: 0.5, tags: ['bag'], slot: 'worn', capacity: 8 },
        { name: 'Hard bread', qty: 2, size: 'small', weight: 0.2, tags: ['food'], slot: 'inside' },
      ],
      ally: { name: 'Tomas Reed', sex: 'male', pronouns: 'he/him', age: 58, looks: 'Grey beard, one ear.', role: 'old captain', why: 'You pulled him out of the harbour.' },
      enemy: { name: 'Mirela Dusk', sex: 'female', pronouns: 'she/her', age: 35, looks: 'Tall, close-cropped hair.', role: 'customs officer', why: 'You made a fool of her.' },
    }));
  }
  if (sys.startsWith('You are the referee')) {
    const lock = /lock/i.test(user.split("PLAYER'S ACTION:").pop());
    return route.fulfill(reply(lock
      ? { possible: true, needsCheck: true, skill: 'Lockpicking', attribute: 'agility', difficulty: 12, duration: 'short', minutes: 0, kind: 'other', note: '' }
      : { possible: true, needsCheck: false, duration: 'moment', minutes: 0, kind: 'talk', note: '' }));
  }
  if (sys.startsWith('You keep the running summary')) return route.fulfill(reply('Ada arrived at the Drowned Rat.'));
  // Narrator
  if (blockNext) { blockNext--; return route.fulfill({ json: { promptFeedback: { blockReason: 'OTHER' } } }); }
  if (user.includes('OPENING SCENE')) {
    return route.fulfill(reply({ prose: 'Rain needles the windows of the **Drowned Rat**. Behind the bar, a bald man wipes a mug.', changes: [
      { op: 'new_person', name: 'Bren', sex: 'male', pronouns: 'he/him', age: 44, looks: 'Bald, broken nose.', voice: 'Low growl.', role: 'barkeep' },
    ] }));
  }
  if (user.includes('CANON')) {
    return route.fulfill(reply({ prose: 'Bren laughs and slides a brass key across the bar.', changes: [
      { op: 'new_item', name: 'Brass key', size: 'tiny', weight: 0.05, tags: ['key'], to: 'player', slot: 'jacket_pockets' },
      { op: 'history', personId: 'Bren', text: 'Gave the player the cellar key.' },
    ] }));
  }
  narrations++;
  return route.fulfill(reply({ prose: `Turn ${narrations}: Bren pours you an ale and takes two pennies.`, changes: [
    { op: 'new_item', name: 'Mug of ale', size: 'medium', weight: 0.6, value: 2, tags: ['drink'], to: 'player', source: 'bought from Bren' },
    { op: 'pay', from: 'player', to: 'Bren', amount: 2, reason: 'ale' },
    { op: 'person_update', personId: 'Bren', field: 'sex', newValue: 'female' },
    { op: 'relationship', personId: 'Bren', aspect: 'trust', direction: 'up', change: 'slight' },
  ] }));
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
await page.route('https://generativelanguage.googleapis.com/**', fakeGemini);
const shot = (n) => page.screenshot({ path: `${process.env.SHOTS || '.'}/${n}.png` });
const btn = (name) => page.getByRole('button', { name, exact: true });

try {
  await page.goto(base);
  await page.waitForSelector('text=Welcome');
  await shot('01-home-nokey');
  await btn('Open Settings').click();
  await page.fill('input[type=password]', 'fake-key');
  await btn('Check key').click();
  await page.waitForSelector('text=Key works');
  await page.click('[aria-label=Close]');

  await btn('New world').click();
  await btn('1931 Chicago').click();
  await btn('Build this world').click();
  await page.waitForSelector('text=Saltmarsh');
  await shot('02-premise');
  await btn('Use this world').click();
  await btn('Suggest the blanks').click();
  await page.waitForSelector('input[value="Ada Venn"]');
  await shot('03-character');
  await btn('Begin').click();
  await page.waitForSelector('text=Rain needles');
  await shot('04-opening');

  // A turn with no check, then one with a roll.
  await page.fill('.action-bar textarea', 'I ask Bren for an ale.');
  await btn('Send').click();
  await page.waitForSelector('text=Turn 1:');
  await page.fill('.action-bar textarea', 'I pick the lock on the cellar door.');
  await btn('Send').click();
  await page.waitForSelector('text=Turn 2:');
  await page.waitForSelector('.msg.roll >> text=Lockpicking: rolled');
  await shot('05-turns');

  // A blocked reply is explained plainly and resends with the same dice.
  blockNext = 1;
  await page.fill('.action-bar textarea', 'I pick the lock again.');
  await btn('Send').click();
  await page.waitForSelector('text=blocked');
  await shot('06-blocked');
  await btn('Resend').click();
  await page.waitForSelector('text=Turn 3:');

  await btn('Inventory').click();
  await page.waitForSelector('table.sheet');
  await shot('07-inventory');
  await page.click('td:text-is("Lockpicks")');
  await page.waitForSelector('text=Found by');
  await shot('08-item');
  await btn('Mouth').click();
  await page.waitForSelector('td:text-is("Mouth")');
  await page.click('[aria-label=Close]');

  await btn('People').click();
  await page.click('strong:text-is("Bren")');
  await page.waitForSelector('text=Fixed facts');
  await shot('09-card');
  const brenSex = await page.locator('dt:text-is("Sex") + dd').first().textContent();
  if (brenSex !== 'male') throw new Error('Bren changed sex: ' + brenSex);
  await page.click('[aria-label=Close] >> nth=-1');
  await page.click('[aria-label=Close]');

  // Undo with rewrite.
  await btn('Undo').click();
  await page.waitForSelector('text=Turn removed');
  await shot('10-undo');
  await page.fill('.undo-panel textarea', 'Bren laughs and gives me the cellar key.');
  await btn('Done').click();
  await page.waitForSelector('text=brass key');
  await shot('11-rewrite');

  // Back 2 turns.
  await btn('Undo').click();
  await page.fill('.undo-panel textarea', 'back 2');
  await btn('Done').click();
  await page.waitForSelector('text=Turn 2:', { state: 'detached' });

  await btn('Console').click();
  await page.waitForSelector('text=fixed fact');
  await shot('12-console');
  await page.click('[aria-label=Close]');

  // Reload: the save persists.
  await page.reload();
  await page.waitForSelector('text=Turn 1:');
  await page.waitForSelector('text=The Drowned Rat');
  await shot('13-reloaded');

  console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'smoke ok');
} catch (err) {
  await shot('zz-failure');
  console.log('FAILED:', err.message, errors.length ? '\nPage errors:\n' + errors.join('\n') : '');
  process.exitCode = 1;
} finally {
  await browser.close();
  server.close();
}
