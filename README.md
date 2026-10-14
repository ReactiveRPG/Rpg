# Living World

A single-player text RPG where an AI game master narrates any world you describe, and the app's own code keeps track of everything that has to stay true. The full design is in [BLUEPRINT.md](BLUEPRINT.md).

**Play:** https://reactiverpg.github.io/Rpg/ (open on your phone, then "Add to Home screen").

## Built so far

- **Stage 0:** an installable web app with no server. Your Gemini key is stored only on your phone. It counts requests per day, sends every request with the safety filters off, and explains blocked or empty replies in plain words.
- **Stage 1:** new worlds and characters, and the turn loop:
  1. the referee decides what roll an action needs
  2. the code rolls the dice
  3. the narrator writes what happens
  4. the code accepts only the changes that follow the rules
  
  Also:
  - person and place cards with fixed facts
  - inventory with carry slots, size and weight
  - Undo opens a panel and removes nothing until you choose: edit the last reply (optionally re-running the record-keeper on the edited text), rewrite what happens, or take back up to 20 turns
  - reply length: Shortest, Short, Medium, Long, or Auto (the referee picks per turn)
  - the narrator is told the exact time of day every turn; reference codes like [p29] are removed from the story
  - money is only the money number: cash items are refused, every money change shows as a note under the turn, Fix money in Inventory, and old cash items can be folded into money
  - homes: owned or rented, made with the character (landlord card and rent deal), shown to the game master every turn; "Add a place you know" in Here for existing worlds
  - no second pair of the same worn clothing; the referee allows travel to places not yet recorded
  - Check connection says which link to the home PC is broken (phone, PC, LM Studio, CORS)
  - automatic saves, plus Export and Import backups
  - a developer console
  - a record-keeper step after every reply: a second, quick request reads the new story and records what changed (money, items, people, who is present, positions, deals), so the narrator only writes prose
  - if the record step is cut off because the phone was closed, it is asked again once the app is back; if it still fails, the note under the turn has an "Update the record" button
  - deals and promises: agreements are recorded and shown to the game master every turn until done or broken

- **Text services:** the game master runs on Gemini (free), on a model on your own PC through LM Studio and Tailscale (private and unfiltered), or on **Auto**. Auto uses Gemini, hands anything Gemini blocks to the home PC, and stays on the PC for about six turns while that scene continues. A footnote marks replies written on the PC.

## What the playtests found

- Google's PROHIBITED_CONTENT filter can't be switched off. It blocks long explicit scenes on Gemini, mostly when earlier explicit turns are sent back as context. Explicit play therefore runs on the home PC. Gemini stays as a backup, and when it blocks a reply the game shows a plain message with Resend and Rephrase.
- On the home PC (a GTX 1080 Ti running Rocinante 12B Q4_K_M with 12k context), turns work, and Short replies keep them quick.

## For developers

- No build step. The files in this folder are the app, served as-is by GitHub Pages from the default branch.
- `js/game/` holds the rules: pure functions over plain data, tested in Node.
- `js/ui/` holds the screens. `js/providers/` holds the swappable AI services.
- Tests: `npm test` runs the unit tests. `npm install && node e2e/smoke.mjs` runs a phone-sized browser playthrough against a fake Gemini; `node e2e/resume.mjs` checks that turns and new games survive menus, reloads and leaving the app.
- API keys never go in the repository.
