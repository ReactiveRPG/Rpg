// Money lives in one place only: the money number on a person's card.
// These helpers keep cash from turning up as inventory items.

const MONEY_WORDS = ['dollar', 'dollars', 'buck', 'bucks', 'cash', 'money', 'banknote', 'banknotes', 'greenbacks'];
// Things that hold or imitate money are real items.
const NOT_MONEY = /\b(purse|wallet|clip|belt|bag|box|case|pouch|tin|jar|safe|counterfeit|fake|forged|prop|register|machine|counter|order|card|cheque|check)\b/i;

/** Whether an item is really just money (e.g. "Thirty Dollars", "Roll of cash", "50 pennies"). */
export function isCashLike(world, item) {
  const name = String((item && item.name) || '').toLowerCase();
  if (!name || NOT_MONEY.test(name)) return false;
  if (/[$£€¥]\s?\d/.test(name)) return true;
  const c = (world.premise && world.premise.currency) || {};
  const words = [...MONEY_WORDS, c.name, c.plural].filter(Boolean).map((w) => String(w).toLowerCase());
  const tokens = name.split(/[^a-z0-9]+/).filter(Boolean);
  return tokens.some((t) => words.includes(t));
}

const UNITS = { zero: 0, one: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
const TENS = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };

/** A number written in an item's name ("Thirty Dollars", "$45 in bills"), or null. */
export function amountInName(name) {
  const text = String(name || '').toLowerCase();
  const digits = text.match(/\d[\d,]*/);
  if (digits) return Number(digits[0].replace(/,/g, ''));
  let total = 0;
  let current = 0;
  let found = false;
  for (const w of text.split(/[^a-z]+/)) {
    if (w in UNITS && w !== 'a') { current += UNITS[w]; found = true; }
    else if (w in TENS) { current += TENS[w]; found = true; }
    else if (w === 'hundred' && found) current *= 100;
    else if (w === 'thousand' && found) { total += current * 1000; current = 0; }
  }
  return found ? total + current : null;
}

/** Best guess at how much money a cash item stands for. */
export function cashAmount(item) {
  const named = amountInName(item.name);
  if (named != null) return named;
  return Math.max(0, Math.round((Number(item.value) || 0) * (Number(item.qty) || 1)));
}
