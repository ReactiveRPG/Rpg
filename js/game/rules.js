// Fixed rules and tables from the blueprint. Every number here is a starting
// value to tune in playtests.

export const ATTRIBUTES = ['strength', 'agility', 'toughness', 'wits', 'charm', 'nerve'];
export const ATTRIBUTE_MIN = -1;
export const ATTRIBUTE_MAX = 3;

/** Starter skills: name -> governing attribute and group. */
export const STARTER_SKILLS = {
  'Combat': { attribute: 'agility', group: 'Fighting' },
  'Unarmed': { attribute: 'strength', group: 'Fighting' },
  'Blades': { attribute: 'agility', group: 'Fighting' },
  'Blunt weapons': { attribute: 'strength', group: 'Fighting' },
  'Firearms': { attribute: 'agility', group: 'Fighting' },
  'Bows and thrown': { attribute: 'agility', group: 'Fighting' },
  'Athletics': { attribute: 'strength', group: 'Body' },
  'Stealth': { attribute: 'agility', group: 'Body' },
  'Survival': { attribute: 'wits', group: 'Body' },
  'Lockpicking': { attribute: 'agility', group: 'Hands' },
  'Sleight of hand': { attribute: 'agility', group: 'Hands' },
  'Repair and crafting': { attribute: 'wits', group: 'Hands' },
  'Driving or riding': { attribute: 'agility', group: 'Hands' },
  'Medicine': { attribute: 'wits', group: 'Mind' },
  'Knowledge': { attribute: 'wits', group: 'Mind' },
  'Perception': { attribute: 'wits', group: 'Mind' },
  'Speech': { attribute: 'charm', group: 'People' },
  'Deception': { attribute: 'charm', group: 'People' },
  'Intimidation': { attribute: 'nerve', group: 'People' },
  'Haggling': { attribute: 'charm', group: 'People' },
};
export const SKILL_MIN = 0;
export const SKILL_MAX = 10;
export const START_SKILL_MAX = 4;

/** Skill table for a world: starter skills plus any the world adds. */
export function skillTable(world) {
  const table = { ...STARTER_SKILLS };
  for (const s of (world && world.premise && world.premise.extraSkills) || []) {
    if (s && s.name && ATTRIBUTES.includes(s.attribute)) table[s.name] = { attribute: s.attribute, group: s.group || 'Setting' };
  }
  return table;
}

export const DIFFICULTY_MIN = 5;
export const DIFFICULTY_MAX = 30;
/** Missing the difficulty by this much or less is a success at a cost. */
export const COST_MARGIN = 3;

/** Duration classes: seconds range [min, max]. */
export const DURATIONS = {
  instant: [0, 0],
  moment: [5, 15],
  short: [60, 300],
  task: [15 * 60, 30 * 60],
  long: [60 * 60, 3 * 60 * 60],
  extended: [8 * 60 * 60, 16 * 60 * 60],
};

export const ACTION_KINDS = ['talk', 'look', 'search', 'wait', 'move', 'fight', 'use_item', 'sneak', 'trade', 'rest', 'other'];

export const SEXES = ['female', 'male', 'other'];
export const DEFAULT_PRONOUNS = { female: 'she/her', male: 'he/him', other: 'they/them' };

/** Fixed facts on a person card. Nobody can change these once set. */
export const FIXED_FACTS = ['name', 'sex', 'pronouns', 'birthYear', 'looks', 'voice'];
/** Fields on a person card the narrator may change. */
export const MUTABLE_PERSON_FIELDS = ['job', 'home', 'workplace', 'faction', 'mood', 'goal', 'status', 'role'];

export const RELATION_ASPECTS = ['trust', 'fear', 'attraction', 'respect'];
export const RELATION_STEPS = { slight: 2, notable: 5, major: 12 };

/** Carry limit in kg, from Strength. Generous by design. */
export function carryLimit(strength) {
  return 25 + 7.5 * (strength || 0);
}
export const HARD_CAP_FACTOR = 1.5;
