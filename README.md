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
  - Undo and Rewrite, going back up to 20 turns
  - automatic saves, plus Export and Import backups
  - a developer console

- **Text services:** the game master runs on either Gemini (free) or a model on your own PC through LM Studio and Tailscale (private and unfiltered). You choose in Settings. Gemini stays available as a backup.

## What the playtests found

- Google's PROHIBITED_CONTENT filter can't be switched off. It blocks long explicit scenes on Gemini, mostly when earlier explicit turns are sent back as context. The game tones down automatically and leaves the blocked text out of later requests, but sustained explicit scenes need the home PC.
- On the home PC (a GTX 1080 Ti running Rocinante 12B Q4_K_M with 12k context), turns work, and Short replies keep them quick.

## For developers

- No build step. The files in this folder are the app, served as-is by GitHub Pages from the default branch.
- `js/game/` holds the rules: pure functions over plain data, tested in Node.
- `js/ui/` holds the screens. `js/providers/` holds the swappable AI services.
- Tests: `npm test` runs the unit tests. `npm install && node e2e/smoke.mjs` runs a phone-sized browser playthrough against a fake Gemini.
- API keys never go in the repository.
