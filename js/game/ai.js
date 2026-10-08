// What the game asks the AI, and the exact shape of the answers it accepts.

import { NARRATOR_RULES, TONE, FIXED_RULES } from '../prompts.js';
import { ATTRIBUTES, ACTION_KINDS, DURATIONS, RELATION_ASPECTS, MUTABLE_PERSON_FIELDS, skillTable } from './rules.js';
import { SIZES, SLOTS, INSIDE } from './inventory.js';
import { CHANGE_OPS } from './changes.js';

const S = (description, extra = {}) => ({ type: 'STRING', description, ...(extra.enum ? { format: 'enum' } : {}), ...extra });
const I = (description) => ({ type: 'INTEGER', description });
const N = (description) => ({ type: 'NUMBER', description });
const B = (description) => ({ type: 'BOOLEAN', description });
const A = (items, description) => ({ type: 'ARRAY', items, description });
const O = (properties, required = []) => ({ type: 'OBJECT', properties, required });

// ---------- Referee ----------

export function refereeSchema(world) {
  const skills = Object.keys(skillTable(world));
  return O({
    possible: B('Can the character attempt this at all with what they have, where they are, right now?'),
    reason: S('If not possible: why, in one plain sentence. Otherwise empty.'),
    needsCheck: B('True only if the outcome is uncertain AND it matters. Talking, walking, looking around normally need no check.'),
    skill: S('Skill used for the check, or "none" for a plain attribute check.', { enum: ['none', ...skills] }),
    attribute: S('Governing attribute for the check.', { enum: ATTRIBUTES }),
    difficulty: I('5 easy, 10 moderate, 15 hard, 20 very hard, 25 extreme, 30 near impossible. Consider circumstances and opposition.'),
    duration: S('How long the action takes.', { enum: Object.keys(DURATIONS) }),
    minutes: I('Optional more exact length in minutes for long or extended actions; 0 if not needed.'),
    kind: S('What sort of action this is.', { enum: ACTION_KINDS }),
    note: S('One short line for the narrator: what is at stake, or what a cost could be.'),
  }, ['possible', 'needsCheck', 'duration', 'kind']);
}

export function refereeSystem(world) {
  const skills = Object.entries(skillTable(world)).map(([k, v]) => `${k} (${v.attribute})`).join(', ');
  return `You are the referee of a text roleplaying game. You do not narrate. You return data only.
Judge the player's typed action. It is an attempt, never a fact: the player cannot declare outcomes, items they do not have, or other people's reactions.
- possible: false if the character lacks what the action needs (an item not on the carried list, being somewhere they are not, a physical impossibility). Wanting or trying is always possible.
- needsCheck: true only when success is uncertain and failure would matter. Ordinary talk, movement and looking need no check. Persuading, lying, sneaking, picking locks, fighting, spotting something hidden usually do.
- Durations: instant (a glance, a one-word answer), moment (~10 s: one line of dialogue, drawing a weapon), short (1–5 min: searching a desk), task (15–30 min: a meal, bandaging), long (1–3 h: a stakeout, crossing a district), extended (half a day or more: a day's travel, a full sleep).
- Waiting until something happens is ONE action. Choose a duration long enough for the situation to change.
Skills and their attributes: ${skills}.
${FIXED_RULES}`;
}

export function refereeRequest(world, packet, action) {
  return {
    job: 'gm',
    system: refereeSystem(world),
    messages: [{ role: 'user', text: `${packet}\n\nPLAYER'S ACTION: ${action}` }],
    json: refereeSchema(world),
    temperature: 0.2,
    maxTokens: 2000,
  };
}

// ---------- Narrator ----------

const CHANGE_SCHEMA = O({
  op: S('Which change.', { enum: CHANGE_OPS }),
  itemId: S('Item id like "i12" (or exact item name).'),
  personId: S('Person id like "p3" (or exact name).'),
  placeId: S('Place id like "l2" (or exact name).'),
  to: S('Destination: a person id, a place id, a container item id, or "here" for the ground.'),
  from: S('Payer person id (pay).'),
  slot: S('Carry slot on a person, or "inside" for a container.', { enum: [...Object.keys(SLOTS), INSIDE] }),
  name: S('Name for a new item, person or place.'),
  qty: I('How many.'),
  size: S('Item size.', { enum: SIZES }),
  weight: N('Weight of ONE item in kg.'),
  value: I('Value of ONE item in the base currency unit, from the price list.'),
  capacity: I('For bags only: room inside (shoulder bag 8, backpack 20, sack 15).'),
  tags: A({ type: 'STRING' }, 'Item tags: weapon, food, drink, drug, tool, key, document, pants, jacket, belt, socks, boots, strap, sheath, bag, clothing, armour.'),
  source: S('Where a new item came from (taken from the room, bought from p3, handed over by p4...). Required.'),
  amount: I('Money amount in base units (pay).'),
  reason: S('Why (for use_up_item, person_dies, pay).'),
  sex: S('For new_person.', { enum: ['female', 'male', 'other'] }),
  pronouns: S('For new_person, e.g. she/her.'),
  age: I('For new_person.'),
  looks: S('For new_person: fixed appearance.'),
  voice: S('For new_person: voice and manner.'),
  role: S('For new_person: who they are in one phrase.'),
  job: S('For new_person.'),
  mood: S('For new_person.'),
  goal: S('For new_person: what they want right now.'),
  field: S(`person_update: one of ${MUTABLE_PERSON_FIELDS.join(', ')}. place_update: state, owner or usual.`),
  newValue: S('New value for person_update or place_update.'),
  aspect: S('relationship aspect.', { enum: RELATION_ASPECTS }),
  direction: S('relationship direction.', { enum: ['up', 'down'] }),
  change: S('relationship size.', { enum: ['slight', 'notable', 'major'] }),
  text: S('history: one dated line, from the other person\'s view, of what they and the player did together.'),
  type: S('new_place: kind of place.'),
  region: S('new_place: region.'),
  description: S('new_place: fixed description.'),
  owner: S('new_place: owner.'),
  usual: S('new_place: who is usually there.'),
  soundTags: A({ type: 'STRING' }, 'new_place: short sound words, e.g. crowd, fire, rain.'),
  travelMinutes: I('new_place or player_moves: travel time from the current place.'),
}, ['op']);

export const NARRATOR_SCHEMA = O({
  prose: S('The narration shown to the player.'),
  changes: A(CHANGE_SCHEMA, 'Proposed changes to the game state. The code checks each one; invalid ones are dropped.'),
}, ['prose', 'changes']);

export function narratorSystem() {
  return `${NARRATOR_RULES}

You are given a scene packet with every fact the game holds, then the player's action and the code's ruling on it.
- The ruling is final. If a check failed, the attempt fails; if it succeeded at a cost, it works but something goes wrong or is lost. If the action was not possible, narrate the attempt running into that reason.
- Narrate only what happens in the time the action takes. Do not skip ahead or invent later events.
- Facts on cards are true. Use names, sex and pronouns exactly as written. Never change anyone's looks or age.
- The character carries only what is on their list. Nothing else exists unless it is in the scene.
- The player character cannot die in this version of the game; at worst they are badly hurt or knocked out.

CHANGES: list every change your narration causes, using ids from the packet (or exact names for things created in the same reply).
- new_person whenever someone becomes named, is traded with, fought, or otherwise starts to matter (unnamed crowd stays uncarded). Give sex, pronouns, age, looks, voice, role. Anyone in a romantic or sexual role is clearly an adult: give an adult age and adult looks.
- person_enters / person_leaves when carded people arrive or go. person_dies only if they are truly dead.
- history: one line on that person's card for anything memorable they did with the player.
- relationship: when the player's action really changes how someone feels (aspect, direction, change size).
- new_item only with a real source in the scene (taken from the room, handed over, bought). use_up_item when eaten, spent, broken or lost. move_item when something changes hands or place (to a person with a slot, "here" for the ground, or a bag id).
- pay for money changing hands; prices come from the price list. The code does the arithmetic.
- new_place then player_moves when the player goes somewhere new; player_moves alone for a known place.
- Do not repeat facts that did not change. Use an empty list if nothing changed.`;
}

export const TONE_DOWN = 'FOR THIS REPLY ONLY: the last attempt was blocked by a content filter. Keep the same events and outcome, but tell the most explicit moments briefly and without graphic detail, then carry on. Everything else as normal.';

export function narratorRequest(world, packet, action, ruling, { toneDown = false } = {}) {
  return {
    job: 'gm',
    system: narratorSystem(),
    messages: [{ role: 'user', text: `${packet}\n\n${action}\n\n${ruling}${toneDown ? '\n\n' + TONE_DOWN : ''}` }],
    json: NARRATOR_SCHEMA,
    temperature: 0.95,
    maxTokens: 8000,
  };
}

// ---------- World premise ----------

const PLACE_SCHEMA = O({
  name: S('Place name.'), type: S('Kind of place.'), region: S('Region or district.'),
  description: S('Two or three concrete sentences.'), owner: S('Who owns or runs it.'),
  usual: S('Who is usually there.'), soundTags: A({ type: 'STRING' }, 'Short sound words.'),
  travelMinutes: I('Travel time from the starting place, for nearby places.'),
}, ['name', 'type', 'description']);

export const PREMISE_SCHEMA = O({
  title: S('Short name for this world.'),
  setting: S('One paragraph: place, era, mood, what life is like.'),
  era: S('Era or year range.'),
  technology: S('Technology and/or magic level.'),
  medicine: S('What medicine exists.'),
  law: S('What is illegal and who enforces it.'),
  tone: S('The feel of the setting in a few words.'),
  currency: O({ name: S('Singular name of the base coin or unit.'), plural: S('Plural.'), note: S('Short note on larger coins or notes.') }, ['name', 'plural']),
  monthNames: A({ type: 'STRING' }, 'Exactly 12 month names (real ones for real-world settings).'),
  weekdayNames: A({ type: 'STRING' }, 'Exactly 7 weekday names starting with the day equivalent to Sunday.'),
  startDate: O({ year: I('Year.'), month: I('1-12.'), day: I('1-28.'), hour: I('0-23.') }, ['year', 'month', 'day', 'hour']),
  artStyle: S('One line describing a consistent art style for pictures of this world.'),
  startPlace: PLACE_SCHEMA,
  nearbyPlaces: A(PLACE_SCHEMA, 'Two to four places near the start, with travel times.'),
  priceCatalogue: A(O({
    name: S('Item or service.'), value: I('Price in base currency units.'), size: S('Size.', { enum: SIZES }),
    weight: N('kg.'), tags: A({ type: 'STRING' }, 'Tags.'),
  }, ['name', 'value']), 'About 30 typical goods and services with consistent prices: food, drink, lodging, clothing, tools, weapons, medicine, transport.'),
  extraSkills: A(O({ name: S('Skill name.'), attribute: S('Attribute.', { enum: ATTRIBUTES }), group: S('Group.') }, ['name', 'attribute']),
    'Skills this setting needs beyond the standard list (such as a magic or hacking skill). Often none.'),
}, ['title', 'setting', 'currency', 'startDate', 'startPlace', 'priceCatalogue']);

export function premiseRequest(description) {
  return {
    job: 'world',
    system: `You design settings for a single-player text roleplaying game. Build a grounded, specific, playable world from the player's description, with consistent details. ${TONE}\n${FIXED_RULES}`,
    messages: [{ role: 'user', text: `The player wants to play in this world:\n\n${description}\n\nCreate the world premise. Keep everything consistent with the description. Prices must make sense against each other.` }],
    json: PREMISE_SCHEMA,
    temperature: 1,
    maxTokens: 16000,
  };
}

// ---------- Character ----------

const NPC_SCHEMA = O({
  name: S('Full name.'), sex: S('Sex.', { enum: ['female', 'male', 'other'] }), pronouns: S('Pronouns.'),
  age: I('Age.'), looks: S('Fixed appearance.'), voice: S('Voice and manner.'), role: S('Who they are to the player, one phrase.'),
  job: S('Job.'), goal: S('What they want.'), why: S('Why they are an ally or enemy, in one sentence.'),
  where: S('Where they can usually be found.'),
}, ['name', 'sex', 'pronouns', 'age', 'looks', 'role', 'why']);

const GEAR_SCHEMA = O({
  name: S('Item.'), qty: I('How many.'), size: S('Size.', { enum: SIZES }), weight: N('kg each.'), value: I('Value each, from the price list.'),
  tags: A({ type: 'STRING' }, 'Tags. Clothing worn must include pants/jacket/belt/socks/boots/etc so pockets exist.'),
  slot: S('Where it is carried.', { enum: [...Object.keys(SLOTS), INSIDE] }),
  capacity: I('Bags only: room inside.'),
}, ['name', 'size', 'slot']);

export const CHARACTER_SCHEMA = O({
  backstory: S('Two short paragraphs of backstory, in second person, consistent with the player\'s background line.'),
  attributes: O(Object.fromEntries(ATTRIBUTES.map((a) => [a, I('-1 to 3')])), ATTRIBUTES),
  skills: A(O({ name: S('Skill name from the list.'), level: I('0 to 4.') }, ['name', 'level']), 'Starting skills from the background. Most 1–2, a few 3, at most one 4.'),
  money: I('Starting money in base currency units.'),
  gear: A(GEAR_SCHEMA, 'Starting clothing (worn) and gear, modest and fitting the background.'),
  ally: NPC_SCHEMA,
  enemy: NPC_SCHEMA,
}, ['backstory', 'attributes', 'skills', 'money', 'gear', 'ally', 'enemy']);

export function characterRequest(world, ch) {
  const skills = Object.entries(skillTable(world)).map(([k, v]) => `${k} (${v.attribute})`).join(', ');
  return {
    job: 'world',
    system: `You create player characters for a text roleplaying game, fitting the world premise. The player's choices are fixed facts: never change the name, sex, age or looks they gave. ${TONE}\n${FIXED_RULES}`,
    messages: [{ role: 'user', text: `WORLD PREMISE:\n${JSON.stringify(world.premise)}\n\nTHE PLAYER'S CHARACTER:\nName: ${ch.name}\nSex: ${ch.sex} (${ch.pronouns})\nAge: ${ch.age}\nLooks: ${ch.looks}\nBackground: ${ch.background}\n\nSkills available: ${skills}.\nAttributes are modifiers from -1 to 3 and should add up to about 5.\nAdd a backstory, attributes, starting skills, starting money, starting gear (including worn clothing so they have pockets), one ally and one enemy.` }],
    json: CHARACTER_SCHEMA,
    temperature: 1,
    maxTokens: 12000,
  };
}

export const SUGGEST_SCHEMA = O({
  name: S('Name fitting the world.'), sex: S('Sex.', { enum: ['female', 'male', 'other'] }), pronouns: S('Pronouns.'), age: I('Adult age.'),
  looks: S('Two sentences of appearance.'), background: S('One-line background.'),
}, ['name', 'sex', 'pronouns', 'age', 'looks', 'background']);

export function suggestRequest(world, partial) {
  return {
    job: 'gm',
    system: `You suggest player characters for a text roleplaying game. Keep anything the player already filled in exactly as given and only fill the blanks. The character is an adult. ${FIXED_RULES}`,
    messages: [{ role: 'user', text: `WORLD: ${world.premise.title}. ${world.premise.setting}\n\nFilled in so far (keep these): ${JSON.stringify(partial)}\n\nSuggest the rest.` }],
    json: SUGGEST_SCHEMA,
    temperature: 1.1,
    maxTokens: 2000,
  };
}

// ---------- Summary ----------

export function summaryRequest(world, previousSummary, turnsText) {
  return {
    job: 'world',
    system: 'You keep the running summary of a text roleplaying game. Write plainly, in past tense, third person about the player character. Keep names exact. Keep it under 300 words. Keep facts that matter later: promises, debts, enemies made, where things were left, who knows what.',
    messages: [{ role: 'user', text: `SUMMARY SO FAR:\n${previousSummary || '(none yet)'}\n\nNEW EVENTS TO FOLD IN:\n${turnsText}\n\nWrite the updated summary.` }],
    temperature: 0.4,
    maxTokens: 3000,
  };
}
