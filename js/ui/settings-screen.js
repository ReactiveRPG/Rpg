import { h, overlay, toast } from './dom.js';
import { loadSettings, saveSettings } from '../settings.js';
import { getUsage, countFor, onUsageChange } from '../usage.js';
import { getNarrator, NARRATOR_PROVIDERS } from '../providers/index.js';
import { pickModel } from '../providers/gemini.js';

/** Extra sections later stages add to Settings (export/import, etc.). */
const extraSections = [];
export function addSettingsSection(build) { extraSections.push(build); }

export async function openSettings({ onClose } = {}) {
  const s = await loadSettings();

  const keyInput = h('input', { type: 'password', value: s.geminiKey, placeholder: 'Paste your Gemini API key', autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
  const showKey = h('button.small', { type: 'button', onclick: () => {
    keyInput.type = keyInput.type === 'password' ? 'text' : 'password';
    showKey.textContent = keyInput.type === 'password' ? 'Show' : 'Hide';
  } }, 'Show');
  const keyStatus = h('p.hint');

  const modelList = h('datalist#model-list');
  const gmModel = h('input', { value: s.gmModel, list: 'model-list', autocapitalize: 'off', spellcheck: false });
  const worldModel = h('input', { value: s.worldModel, list: 'model-list', autocapitalize: 'off', spellcheck: false });
  const gmLimit = h('input', { type: 'number', min: 1, value: s.gmDailyLimit });
  const worldLimit = h('input', { type: 'number', min: 1, value: s.worldDailyLimit });

  const usageBox = h('div.usage');
  async function renderUsage() {
    const u = await getUsage();
    const cur = await loadSettings();
    const row = (label, model, limit) => {
      const used = countFor(u, model);
      const pct = Math.min(100, Math.round((used / limit) * 100));
      return h('div.usage-row',
        h('div.usage-label', h('span', label), h('span', `${used} / ${limit}`)),
        h('div.meter', h('div.meter-fill', { style: { width: `${pct}%` }, class: pct >= 90 ? 'meter-fill warn' : 'meter-fill' })),
        h('div.hint', model));
    };
    usageBox.replaceChildren(
      row('Game master', cur.gmModel, cur.gmDailyLimit),
      row('World-building', cur.worldModel, cur.worldDailyLimit),
      h('p.hint', 'A game turn uses about two game-master requests. Counts reset at midnight US Pacific time.'));
  }
  const unsubscribe = onUsageChange(renderUsage);

  async function saveKey(quiet) {
    await saveSettings({ geminiKey: keyInput.value.trim() });
    if (quiet !== true) toast('Key saved on this phone');
  }

  async function checkKey() {
    await saveKey(true);
    keyStatus.textContent = 'Checking…';
    const narrator = await getNarrator('gemini');
    const res = await narrator.listModels();
    if (!res.ok) { keyStatus.textContent = res.message; keyStatus.className = 'hint bad'; return; }
    const ids = res.models.map((m) => m.id);
    modelList.replaceChildren(...res.models.map((m) => h('option', { value: m.id }, m.name)));
    const patch = {};
    if (!ids.includes(gmModel.value.trim())) {
      const pick = pickModel(ids, 'gm');
      if (pick) { gmModel.value = pick; patch.gmModel = pick; }
    }
    if (!ids.includes(worldModel.value.trim())) {
      const pick = pickModel(ids, 'world');
      if (pick) { worldModel.value = pick; patch.worldModel = pick; }
    }
    if (Object.keys(patch).length) await saveSettings(patch);
    keyStatus.className = 'hint good';
    keyStatus.textContent = `Key works. ${ids.length} models available.` +
      (Object.keys(patch).length ? ' Model names were updated to ones your key can use.' : '');
    renderUsage();
  }

  async function saveModels() {
    await saveSettings({
      gmModel: gmModel.value.trim(),
      worldModel: worldModel.value.trim(),
      gmDailyLimit: Math.max(1, parseInt(gmLimit.value, 10) || 500),
      worldDailyLimit: Math.max(1, parseInt(worldLimit.value, 10) || 20),
    });
    renderUsage();
    toast('Saved');
  }

  // ----- Which service runs the game master -----
  const pcUrl = h('input', { value: s.pcUrl, placeholder: 'https://your-pc.tail1234.ts.net', autocapitalize: 'off', spellcheck: false, inputmode: 'url' });
  const pcModelList = h('datalist#pc-model-list');
  const pcModel = h('input', { value: s.pcModel, list: 'pc-model-list', placeholder: 'Tap Check connection', autocapitalize: 'off', spellcheck: false });
  const pcKey = h('input', { type: 'password', value: s.pcKey, placeholder: 'Leave blank unless you set one', autocomplete: 'off', autocapitalize: 'off', spellcheck: false });
  const pcStatus = h('p.hint');
  const pcBox = h('div', { style: { display: s.provider === 'pc' ? '' : 'none' } },
    h('label', 'PC address', pcUrl),
    h('label', 'Model', pcModel),
    h('label', 'Key (optional)', pcKey),
    pcModelList,
    h('div.row', h('button.primary', { type: 'button', onclick: () => checkPc() }, 'Check connection')),
    pcStatus);

  async function savePc() {
    await saveSettings({ pcUrl: pcUrl.value.trim(), pcModel: pcModel.value.trim(), pcKey: pcKey.value.trim() });
  }
  [pcUrl, pcModel, pcKey].forEach((el) => el.addEventListener('change', savePc));

  async function checkPc() {
    await savePc();
    pcStatus.className = 'hint';
    pcStatus.textContent = 'Checking…';
    const res = await (await getNarrator('pc')).listModels();
    if (!res.ok) { pcStatus.className = 'hint bad'; pcStatus.textContent = res.message; return; }
    pcModelList.replaceChildren(...res.models.map((m) => h('option', { value: m.id })));
    if (!res.models.length) { pcStatus.className = 'hint bad'; pcStatus.textContent = 'Connected, but no model is loaded in LM Studio. Load one and check again.'; return; }
    if (!res.models.some((m) => m.id === pcModel.value.trim())) {
      pcModel.value = res.models[0].id;
      await savePc();
    }
    pcStatus.className = 'hint good';
    pcStatus.textContent = `Connected. Using ${pcModel.value}.`;
  }

  const serviceButtons = NARRATOR_PROVIDERS.map((p) => h('button.seg', {
    type: 'button',
    class: s.provider === p.id ? 'seg on' : 'seg',
    onclick: async (e) => {
      await saveSettings({ provider: p.id });
      serviceButtons.forEach((b) => b.classList.toggle('on', b === e.currentTarget));
      pcBox.style.display = p.id === 'pc' ? '' : 'none';
    },
  }, p.id === 'pc' ? 'Home PC' : 'Gemini'));

  const sizeButtons = ['small', 'medium', 'large', 'huge'].map((size) => h('button.seg', {
    type: 'button',
    class: s.textSize === size ? 'seg on' : 'seg',
    onclick: async (e) => {
      await saveSettings({ textSize: size });
      sizeButtons.forEach((b) => b.classList.toggle('on', b === e.currentTarget));
    },
  }, size[0].toUpperCase() + size.slice(1)));

  const body = h('div.settings',
    h('section',
      h('h3', 'Gemini key'),
      h('p.hint', 'Stored only on this phone. Get a free key at ',
        h('a', { href: 'https://aistudio.google.com/apikey', target: '_blank', rel: 'noopener' }, 'aistudio.google.com/apikey'), '.'),
      h('div.row', keyInput, showKey),
      h('div.row', h('button', { type: 'button', onclick: saveKey }, 'Save key'), h('button.primary', { type: 'button', onclick: checkKey }, 'Check key')),
      keyStatus),
    h('section',
      h('h3', 'Game master runs on'),
      h('div.segmented', serviceButtons),
      h('p.hint', 'Gemini: free, but Google\'s filter can block explicit scenes. Home PC: private and unfiltered, needs your PC on.'),
      pcBox),
    h('section',
      h('h3', 'Gemini requests used today'),
      usageBox),
    h('section',
      h('h3', 'Text size'),
      h('div.segmented', sizeButtons)),
    ...extraSections.map((build) => build()),
    h('section',
      h('details',
        h('summary', 'Gemini models and limits'),
        h('label', 'Game-master model (every turn)', gmModel),
        h('label', 'World-building model (world, summaries)', worldModel),
        h('label', 'Game-master daily limit', gmLimit),
        h('label', 'World-building daily limit', worldLimit),
        modelList,
        h('p.hint', 'Tap "Check key" above to fill in the list of models your key can use.'),
        h('button', { type: 'button', onclick: saveModels }, 'Save models and limits'))),
    h('p.hint.center', 'Living World · stage 1 · build 15'));

  renderUsage();
  return overlay('Settings', body, { onClose: () => { unsubscribe(); onClose && onClose(); } });
}
