// New game: describe a world, accept or redo the premise, make a character,
// then the opening scene.

import { h, prose, hiddenTimes, whenVisible, INTERRUPTED } from './dom.js';
import { ask as askNow } from '../providers/index.js';
import { premiseRequest, characterRequest, suggestRequest } from '../game/ai.js';
import { worldFromPremise, normaliseChoices, addCharacter } from '../game/creation.js';
import { playOpening } from '../game/turn.js';
import { saveWorld, saveDraft, clearDraft } from '../game/saves.js';
import { formatDateTime } from '../game/clock.js';
import { DEFAULT_PRONOUNS } from '../game/rules.js';

const EXAMPLES = [
  'A rain-soaked harbour city in a grim, low-magic fantasy world, full of smugglers, guilds and corrupt watchmen.',
  'Chicago, 1931. Prohibition, speakeasies, rival Irish and Italian gangs, crooked cops.',
  'A neon megacity in 2089 where corporations own the police and the poor sell their memories.',
  'The American frontier, 1876. A mining town in the Dakota hills during the gold rush.',
];

/** Like ask(), but a request cut off by leaving the app is sent again once the app is back. */
async function ask(req) {
  for (let tries = 0; ; tries++) {
    const before = hiddenTimes();
    const res = await askNow(req);
    if (res.ok || tries >= 2 || hiddenTimes() === before || !INTERRUPTED.includes(res.kind)) return res;
    await whenVisible();
  }
}

/**
 * draft: an unfinished new game saved earlier ({ stage, description, world, choices }),
 * so creation carries on from the last finished step instead of starting over.
 */
export function renderNewGame(root, app, draft = null) {
  let description = draft?.description || '';
  let world = draft?.world || null;

  function problem(message, retry) {
    return h('div.problem', h('p', message), h('div.row', h('button', { type: 'button', onclick: retry }, 'Try again'), h('button', { type: 'button', onclick: () => stepWorld() }, 'Back')));
  }

  function busy(text) {
    return h('div.page', h('p.msg.waiting', text));
  }

  // Step 1: describe the world.
  function stepWorld() {
    const box = h('textarea', { rows: 6, placeholder: 'Describe the world you want to play in: place, era, mood, anything you want in it.' }, description);
    box.value = description;
    root.replaceChildren(h('div.page',
      h('h2.big-title', 'A new world'),
      h('p.hint', 'Describe any setting. A few lines is enough; the game fills in the rest.'),
      box,
      h('div.chips', EXAMPLES.map((ex, i) => h('button.chip', { type: 'button', onclick: () => { box.value = ex; } }, ['Grim fantasy port', '1931 Chicago', '2089 megacity', '1876 gold town'][i]))),
      h('div.row',
        h('button', { type: 'button', onclick: async () => { await clearDraft(); app.home(); } }, 'Cancel'),
        h('button.primary', { type: 'button', onclick: () => { description = box.value.trim(); if (description) buildWorld(); } }, 'Build this world'))));
  }

  async function buildWorld() {
    root.replaceChildren(busy('Building the world… this can take up to a minute.'));
    await saveDraft({ stage: 'building', description });
    const res = await ask(premiseRequest(description));
    if (!res.ok) { root.replaceChildren(h('div.page', problem(res.message, buildWorld))); return; }
    world = worldFromPremise(res.data, description);
    await saveDraft({ stage: 'premise', description, world });
    showPremise(res.fellBack);
  }

  function showPremise(fellBack) {
    const pr = world.premise;
    const start = world.places[world.currentPlaceId];
    root.replaceChildren(h('div.page',
      h('h2.big-title', pr.title),
      fellBack ? h('p.hint', 'Built with the smaller model: the world-building allowance is used up for today.') : null,
      prose(pr.setting),
      h('dl.kv',
        pr.era ? [h('dt', 'Era'), h('dd', pr.era)] : null,
        pr.technology ? [h('dt', 'Tech / magic'), h('dd', pr.technology)] : null,
        h('dt', 'Money'), h('dd', `${pr.currency.plural}${pr.currency.note ? ' — ' + pr.currency.note : ''}`),
        h('dt', 'Starts'), h('dd', `${formatDateTime(world)}, ${start.name}`)),
      h('div.row',
        h('button', { type: 'button', onclick: () => stepWorld() }, 'Change description'),
        h('button', { type: 'button', onclick: () => buildWorld() }, 'Try again'),
        h('button.primary', { type: 'button', onclick: () => stepCharacter() }, 'Use this world'))));
  }

  // Step 2: the character.
  const form = { name: '', sex: '', pronouns: '', age: '', looks: '', background: '' };
  function stepCharacter(message) {
    const f = {
      name: h('input', { value: form.name, placeholder: 'Leave blank to have one suggested' }),
      sex: h('select', ['', 'female', 'male', 'other'].map((v) => h('option', { value: v, selected: form.sex === v }, v || '(suggest)'))),
      pronouns: h('input', { value: form.pronouns, placeholder: 'e.g. she/her' }),
      age: h('input', { type: 'number', min: 18, max: 120, value: form.age, placeholder: '18 or older' }),
      looks: h('textarea', { rows: 3, placeholder: 'What they look like' }),
      background: h('input', { value: form.background, placeholder: 'One line: who they are, what they do' }),
    };
    f.looks.value = form.looks;
    f.sex.addEventListener('change', () => { if (!f.pronouns.value || Object.values(DEFAULT_PRONOUNS).includes(f.pronouns.value)) f.pronouns.value = DEFAULT_PRONOUNS[f.sex.value] || ''; });
    const read = () => { for (const k of Object.keys(form)) form[k] = f[k].value.trim(); };
    const missing = () => ['name', 'sex', 'age', 'looks', 'background'].filter((k) => !form[k]);

    async function suggest() {
      read();
      root.replaceChildren(busy('Suggesting…'));
      const partial = Object.fromEntries(Object.entries(form).filter(([, v]) => v));
      const res = await ask(suggestRequest(world, partial));
      if (res.ok) {
        for (const k of Object.keys(form)) if (!form[k] && res.data[k] != null) form[k] = String(res.data[k]);
        if (!['female', 'male', 'other'].includes(form.sex)) form.sex = 'other';
        if (parseInt(form.age, 10) < 18) form.age = '18';
        stepCharacter();
      } else stepCharacter(res.message);
    }

    async function begin() {
      read();
      if (missing().length) { stepCharacter(`Still blank: ${missing().join(', ')}. Fill them in or tap "Suggest the blanks".`); return; }
      if ((parseInt(form.age, 10) || 0) < 18) { stepCharacter('Your character must be 18 or older.'); return; }
      createCharacter(normaliseChoices(form));
    }

    root.replaceChildren(h('div.page.form',
      h('h2.big-title', 'Your character'),
      h('p.hint', 'Name, sex, age and looks are fixed facts once the game starts.'),
      message ? h('div.problem', h('p', message)) : null,
      h('label', 'Name', f.name),
      h('label', 'Sex', f.sex),
      h('label', 'Pronouns', f.pronouns),
      h('label', 'Age', f.age),
      h('label', 'Looks', f.looks),
      h('label', 'Background (one line)', f.background),
      h('div.row',
        h('button', { type: 'button', onclick: suggest }, 'Suggest the blanks'),
        h('button.primary', { type: 'button', onclick: begin }, 'Begin'))));
  }

  async function createCharacter(choices) {
    root.replaceChildren(busy('Writing your backstory, gear, an ally and an enemy…'));
    await saveDraft({ stage: 'character', description, world, choices });
    const res = await ask(characterRequest(world, choices));
    if (!res.ok) { root.replaceChildren(h('div.page', problem(res.message, () => createCharacter(choices)))); return; }
    // Start from a clean copy each attempt so a retry does not add a second player.
    const fresh = structuredClone(world);
    addCharacter(fresh, choices, res.data);
    await saveDraft({ stage: 'opening', description, world: fresh });
    opening(fresh);
  }

  async function opening(w) {
    root.replaceChildren(busy('Setting the opening scene…'));
    const res = await playOpening(w, { ask });
    if (!res.ok) { root.replaceChildren(h('div.page', problem(res.error.message || 'The opening scene failed.', () => opening(w)))); return; }
    await saveWorld(w);
    await clearDraft();
    app.play(w);
  }

  // Carry on an unfinished new game from its last finished step.
  if (draft?.stage === 'building') buildWorld();
  else if (draft?.stage === 'premise' && world) showPremise(false);
  else if (draft?.stage === 'character' && world && draft.choices) createCharacter(draft.choices);
  else if (draft?.stage === 'opening' && world) opening(world);
  else stepWorld();
}
