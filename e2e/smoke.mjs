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
let lastChanges = [];
function fakeGemini(route) {
  // The narrator now writes prose only; its changes are handed to the record-keeper.
  const narrate = ({ prose, changes }) => { lastChanges = changes; return route.fulfill(reply(prose)); };
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
  if (sys.startsWith('You are the record-keeper')) {
    const changes = lastChanges;
    lastChanges = [];
    return route.fulfill(reply({ changes, scene_state: 'Ada at the bar.' }));
  }
  // Narrator
  if (blockNext) { blockNext--; return route.fulfill({ json: { promptFeedback: { blockReason: 'OTHER' } } }); }
  if (user.includes('OPENING SCENE')) {
    return narrate({ prose: 'Rain needles the windows of the **Drowned Rat**. Behind the bar, a bald man wipes a mug.', changes: [
      { op: 'new_person', name: 'Bren', sex: 'male', pronouns: 'he/him', age: 44, looks: 'Bald, broken nose.', voice: 'Low growl.', role: 'barkeep' },
    ] });
  }
  if (user.includes('CANON')) {
    return narrate({ prose: 'Bren laughs and slides a brass key across the bar.', changes: [
      { op: 'new_item', name: 'Brass key', size: 'tiny', weight: 0.05, tags: ['key'], to: 'player', slot: 'jacket_pockets' },
      { op: 'history', personId: 'Bren', text: 'Gave the player the cellar key.' },
    ] });
  }
  narrations++;
  return narrate({ prose: `Turn ${narrations}: Bren pours you an [i99] ale and takes two pennies.`, changes: [
    { op: 'new_item', name: 'Mug of ale', size: 'medium', weight: 0.6, value: 2, tags: ['drink'], to: 'player', source: 'bought from Bren' },
    { op: 'pay', from: 'player', to: 'Bren', amount: 2, reason: 'ale' },
    { op: 'person_update', personId: 'Bren', field: 'sex', newValue: 'female' },
    { op: 'relationship', personId: 'Bren', aspect: 'trust', direction: 'up', change: 'slight' },
    { op: 'deal_new', personId: 'Bren', terms: 'Carry a crate to the docks; Bren pays 10 pennies on delivery.' },
  ] });
}

function fakePc(route) {
  const url = route.request().url();
  if (url.endsWith('/v1/models')) return route.fulfill({ json: { data: [{ id: 'rocinante-12b-v1.1' }] } });
  const b = JSON.parse(route.request().postData());
  const sys = b.messages[0].content;
  const content = sys.startsWith('You are the referee')
    ? JSON.stringify({ possible: true, needsCheck: false, duration: 'moment', kind: 'other' })
    : JSON.stringify({ prose: 'PC narration: the scene goes on.', changes: [] });
  return route.fulfill({ json: { choices: [{ message: { content }, finish_reason: 'stop' }] } });
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 393, height: 851 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('dialog', (d) => d.accept());
await page.route('https://generativelanguage.googleapis.com/**', fakeGemini);
await page.route('https://my-pc.tail1234.ts.net/**', fakePc);
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
  await page.click('td:text-is("Hard bread")');
  await btn('Remove from the game').click();
  await page.waitForSelector('td:text-is("Hard bread")', { state: 'detached' });
  await page.click('[aria-label=Close]');

  await btn('People').click();
  await page.click('strong:text-is("Bren")');
  await page.waitForSelector('text=Fixed facts');
  await shot('09-card');
  const brenSex = await page.locator('dt:text-is("Sex") + dd').first().textContent();
  if (brenSex !== 'male') throw new Error('Bren changed sex: ' + brenSex);
  await page.click('[aria-label=Close] >> nth=-1');
  await page.click('[aria-label=Close]');

  // Deals screen shows what was agreed; it can be closed by hand.
  await btn('Deals').click();
  await page.waitForSelector('text=Bren pays 10 pennies on delivery');
  await page.screenshot({ path: `${process.env.SHOTS || '.'}/09b-deals.png` });
  await btn('Mark done').click();
  await page.waitForSelector('text=Finished and broken');
  await page.click('[aria-label=Close]');

  // Here: someone the game wrongly lists can be marked as not here.
  await btn('Here').click();
  await page.waitForSelector('button.list-btn:has-text("Bren")');
  await page.screenshot({ path: `${process.env.SHOTS || '.'}/09c-here.png` });
  await btn('Not here').click();
  await page.waitForSelector('text=No one you know.');
  await page.click('[aria-label=Close]');

  // Reference codes the narrator copied are not shown.
  if ((await page.locator('.log').innerText()).includes('[i99]')) throw new Error('reference code shown in the story');

  // Undo opens choices and removes nothing until one is picked.
  const turnsBeforeUndo = await page.locator('.msg.player').count();
  await btn('Undo').click();
  await page.waitForSelector('text=Change the last turn');
  await shot('10-undo');
  await btn('Cancel').click();
  if (await page.locator('.msg.player').count() !== turnsBeforeUndo) throw new Error('Undo removed a turn before a choice');

  // Edit the reply, updating the record.
  await btn('Undo').click();
  await btn('Edit the reply').click();
  await page.fill('.undo-panel textarea', 'Bren pours you a small beer instead.');
  await shot('10b-edit');
  await btn('Save').click();
  await page.waitForSelector('text=Reply edited and the record updated');
  await page.waitForSelector('.msg.gm >> text=small beer instead');
  await page.waitForSelector('text=Edited by you.');
  if (await page.locator('.msg.player').count() !== turnsBeforeUndo) throw new Error('editing changed the number of turns');

  // Rewrite what happens.
  await btn('Undo').click();
  await btn('Rewrite what happens').click();
  await page.fill('.undo-panel textarea', 'Bren laughs and gives me the cellar key.');
  await btn('Send').first().click();
  await page.waitForSelector('text=brass key');
  await shot('11-rewrite');

  // Take back 2 turns: the first one's action goes back in the box.
  await btn('Undo').click();
  await btn('Take back the turn').click();
  await page.fill('.undo-panel input[type=number]', '2');
  await btn('Take back').click();
  await page.waitForSelector('text=2 turns taken back');
  await page.waitForSelector('text=Turn 2:', { state: 'detached' });
  if (!(await page.inputValue('.action-bar textarea'))) throw new Error('action not put back after taking back turns');
  await page.fill('.action-bar textarea', '');

  // Fix money by hand.
  await btn('Inventory').click();
  await btn('Fix money').click();
  await page.fill('.overlay input[type=number]', '99');
  await btn('Save').click();
  await page.waitForSelector('text=Money: 99 pennies');
  await page.click('[aria-label=Close]');
  await page.waitForSelector('.status-line >> text=99 pennies');
  await page.waitForSelector('.msg.system >> text=Money set by you');

  // Add a rented home the game did not know about.
  await btn('Here').click();
  await btn('Add a place you know').click();
  await page.fill('input[placeholder^="e.g. My apartment"]', 'Room above the chandler');
  await page.selectOption('.overlay select', 'rented');
  await page.fill('input[placeholder^="Optional: e.g. Mrs."]', 'Old Marta');
  await page.fill('input[placeholder="Optional"]', '12');
  await shot('12c-add-home');
  await btn('Add').click();
  await page.waitForSelector('text=Home added');
  await btn('Here').click();
  await page.waitForSelector('text=Room above the chandler — rented from Old Marta');
  await page.click('[aria-label=Close]');
  await btn('Deals').click();
  await page.waitForSelector('text=Rent for Room above the chandler');
  await page.click('[aria-label=Close]');

  await btn('Console').click();
  await page.waitForSelector('table.sheet >> text=narrator');
  await page.screenshot({ path: `${process.env.SHOTS || '.'}/12a-requests.png` });
  await page.getByRole('button', { name: /^Rejected/ }).click();
  await page.waitForSelector('text=fixed fact');
  await shot('12-console');
  await page.click('[aria-label=Close]');

  // Auto mode: Gemini blocks, the home PC takes over, with a footnote.
  await page.click('[aria-label=Settings]');
  await btn('Auto').first().click();
  if (!(await btn('Auto').first().getAttribute('class')).includes('on')) throw new Error('Auto button not highlighted');
  await btn('Shortest').click();
  if (!(await btn('Shortest').getAttribute('class')).includes('on')) throw new Error('Shortest button not highlighted');
  await shot('12b-lengths');
  await btn('Short').click();
  if (!(await btn('Short').getAttribute('class')).includes('on')) throw new Error('Short button not highlighted');
  await btn('Large').click();
  if (!(await btn('Large').getAttribute('class')).includes('on')) throw new Error('Large button not highlighted');
  if ((await btn('Medium').first().getAttribute('class')).includes(' on')) throw new Error('old choice still highlighted');
  await page.fill('input[placeholder="https://your-pc.tail1234.ts.net"]', 'my-pc.tail1234.ts.net');
  await btn('Check connection').click();
  await page.waitForSelector('text=Connected.');
  await page.click('[aria-label=Close]');
  await page.waitForSelector('.action-bar textarea');
  blockNext = 1;
  await page.fill('.action-bar textarea', 'Something Gemini declines.');
  await btn('Send').click();
  await page.waitForSelector('text=PC narration: the scene goes on.');
  await page.waitForSelector('text=Gemini declined this part');
  await shot('12b-auto');
  await page.fill('.action-bar textarea', 'Carry on.');
  await btn('Send').click();
  await page.waitForSelector('text=while this scene continues');

  // Reload: the save persists.
  await page.reload();
  await page.waitForSelector('text=Turn 1:');
  await page.waitForSelector('text=The Drowned Rat');
  await page.waitForSelector('text=Gemini declined this part');
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
