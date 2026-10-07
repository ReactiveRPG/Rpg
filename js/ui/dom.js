// Tiny helpers for building the screens.

/**
 * h('div.card#main', { onclick, ... }, child, child...)
 * Strings become text nodes (never HTML), so AI text cannot inject markup.
 */
export function h(tag, props, ...children) {
  const [, name = 'div', rest = ''] = tag.match(/^([a-z0-9-]*)(.*)$/i);
  const el = document.createElement(name || 'div');
  for (const part of rest.match(/[.#][^.#]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    children.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k in el && typeof v !== 'string') el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

/** Turns narrator prose into paragraphs, with *emphasis* shown as italics. Text only, no HTML. */
export function prose(text) {
  return text.split(/\n{2,}|\n(?=\s*[-*] )/).filter((p) => p.trim()).map((para) =>
    h('p', ...para.split(/(\*\*[^*]+\*\*|\*[^*\n]+\*)/).map((bit) => {
      if (/^\*\*[^*]+\*\*$/.test(bit)) return h('strong', bit.slice(2, -2));
      if (/^\*[^*]+\*$/.test(bit)) return h('em', bit.slice(1, -1));
      return bit;
    })));
}

/** Opens a full-screen panel over the chat. Returns { el, close }. */
export function overlay(title, body, { onClose } = {}) {
  const close = () => { wrap.remove(); onClose && onClose(); };
  const wrap = h('div.overlay', { role: 'dialog', 'aria-label': title },
    h('div.overlay-head',
      h('h2', title),
      h('button.icon-btn', { onclick: close, 'aria-label': 'Close' }, '✕')),
    h('div.overlay-body', body));
  document.body.append(wrap);
  return { el: wrap, close };
}

export function toast(message, ms = 3000) {
  const t = h('div.toast', message);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
