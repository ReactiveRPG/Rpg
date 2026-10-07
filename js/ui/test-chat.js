// Stage 0 screen: send a message straight to the game master and read the reply.

import { h, prose } from './dom.js';
import { ask } from '../providers/index.js';
import { NARRATOR_RULES } from '../prompts.js';
import { loadSettings } from '../settings.js';
import { openSettings } from './settings-screen.js';

export async function renderTestChat(root) {
  const history = [];
  const log = h('div.log');
  const input = h('textarea', { rows: 2, placeholder: 'Say something to the game master…' });
  const sendBtn = h('button.primary', { type: 'button' }, 'Send');

  const s = await loadSettings();
  if (!s.geminiKey) {
    log.append(h('div.notice',
      h('p', 'Welcome. To talk to the game master, the game needs a Gemini key.'),
      h('button.primary', { type: 'button', onclick: () => openSettings({ onClose: () => renderTestChat(root) }) }, 'Open Settings')));
  } else {
    log.append(h('div.notice', h('p', 'Stage 0 test: send any message, for example "Describe a rainy harbour town at night."')));
  }

  function scroll() { log.scrollTop = log.scrollHeight; }

  async function send(text) {
    if (!text) return;
    sendBtn.disabled = true;
    input.value = '';
    history.push({ role: 'user', text });
    log.append(h('div.msg.player', text));
    const waiting = h('div.msg.waiting', 'The game master is writing…');
    log.append(waiting);
    scroll();

    const res = await ask({ job: 'gm', system: NARRATOR_RULES, messages: history, temperature: 1 });
    waiting.remove();
    if (res.ok) {
      history.push({ role: 'model', text: res.text });
      log.append(h('div.msg.gm', prose(res.text)));
    } else {
      history.pop();
      const box = h('div.problem',
        h('p', res.message),
        h('div.row',
          h('button', { type: 'button', onclick: () => { box.remove(); log.lastElementChild?.classList.contains('player') && log.lastElementChild.remove(); send(text); } }, 'Resend'),
          h('button', { type: 'button', onclick: () => { box.remove(); log.lastElementChild?.classList.contains('player') && log.lastElementChild.remove(); input.value = text; input.focus(); } }, 'Rephrase')));
      log.append(box);
    }
    sendBtn.disabled = false;
    scroll();
  }

  sendBtn.addEventListener('click', () => send(input.value.trim()));

  root.replaceChildren(
    h('div.play',
      log,
      h('div.action-bar', input, sendBtn)));
}
