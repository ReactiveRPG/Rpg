# Living World RPG Blueprint

Design as of October 7, 2026. This file is the source of truth for the game. Build it stage by stage, in the order given under "Build stages". Every number in this document is a starting value to tune during playtests.

## Summary

A single-player text RPG where an AI game master narrates any world the player describes, and the app's own code tracks everything that has to stay true. It is built for one player on an Android phone and costs nothing to run.

| Decision | Choice |
| --- | --- |
| Player | One person, on his own phone |
| App type | Web app installed to the phone's home screen. No server |
| Game master | Gemini 3.5 Flash-Lite, free tier |
| World-building and summaries | Gemini 3.8 Flash, free tier |
| Content | Mature. Graphic violence and sex between adult characters are allowed |
| Images | Cloudflare Workers AI free tier, for places and people |
| Audio | Not built yet. Sound tags are stored from the start |
| Build tool | Claude Code |

What the game must do better than Nervejack (nervejack.gg, the game that inspired it):

- Any scenario, not one fixed setting.
- People and places remember what happened and stay consistent.
- Time follows what the character does, not how many messages were sent.
- Scenes do not loop, and the plot is never forced into a conversation.
- The world carries on without the player, and can outlive the character.

## Foundation

The app is one installable web page with no server. All game data lives on the phone, and every outside service sits behind a swappable provider.

- **Storage:** saves, cards and images are kept in the phone's browser storage (IndexedDB).
- **Keys:** API keys are typed once into Settings and stored only on the phone. They never appear in the code or the repository.
- **Providers:** `narrator` (text), `painter` (images) and later `sound`. Each can be switched in Settings without changing code.

| Model | Job | Free limit read from AI Studio on Oct 6, 2026 |
| --- | --- | --- |
| Gemini 3.5 Flash-Lite | Referee and narrator, every turn | 15 requests/min, 250K tokens/min, 500 requests/day |
| Gemini 3.8 Flash | World bible, weekly faction moves, story summaries | 5 requests/min, 250K tokens/min, 20 requests/day |

**Request budget.** A turn costs two Flash-Lite requests, so the daily limit is about 250 turns. Settings shows requests used today. When the 3.8 Flash allowance is spent, its jobs fall back to Flash-Lite.

**Content settings.** Every request sends all four adjustable Gemini safety categories (harassment, hate speech, sexually explicit, dangerous) set to off. The game master prompt asks for a mature, unsoftened tone. One rule is fixed in the prompt and cannot be changed in play: every character in sexual content is an adult.

**Blocked replies.** If a reply comes back blocked or empty, the app says so in plain words and lets the player rephrase or resend. It never fails silently.

**Privacy.** On the free tier, Google may use submitted content to improve its products. A paid key or a local model avoids that.

## The core rule: code owns the facts

The code holds every fact about the game. The AI proposes and narrates, and nothing it says becomes true until the code accepts it.

This is what stops the mushiness, forgetting and gender swaps of AI-only games. It also lets a lite model run a deep game, because the model never has to remember or calculate anything.

One turn, in order:

1. The player types an action.
2. The code builds a scene packet: date and time, the place card, the card of everyone present including the player, body state, relevant inventory, the last few turns, the running summary, and what the last few similar actions produced.
3. **Referee request** (returns data only). It answers: is the action possible with what the character has, does it need a check, which skill, how hard, and how long it takes.
4. The code rolls the dice and applies skill, wounds and conditions. The result is final.
5. **Narrator request.** It receives the packet and the result, and returns prose plus a list of proposed changes.
6. The code checks every proposed change against the rules and applies the valid ones. Invalid ones are dropped and logged.
7. The code advances the clock, fires any calendar events now due, and updates needs, healing and XP.
8. The game saves and keeps a snapshot for undo.

Rules the code enforces on step 6:

- Fixed facts on a card (name, sex, age, looks) cannot be changed by the AI.
- Items cannot appear without a source or be used after they are gone.
- The dead stay dead unless the revival rules say otherwise.
- All numbers (money, weight, blood, XP, reputation, dates) are calculated by code, never by the AI.

The player's typed action is an attempt, never a fact. The only exception is the Rewrite box.

## Game master rules

Each immersion problem from Nervejack gets a specific fix in code or in the game master prompt.

| Problem in Nervejack | Fix in this game |
| --- | --- |
| A short conversation burned several hours | Every action gets a duration from what it is. A line of dialogue costs seconds |
| Only a 24-hour clock, no date | Full date, 12-hour am/pm time, and a calendar screen |
| The stakeout loop: same action, same result, over and over | Waiting is one action that resolves in a single turn. The narrator is shown what the last few similar actions produced and may not repeat them. The situation must change or resolve |
| People forgot what they did with the player | Each person's card holds a dated list of shared history, sent whenever they are in the scene |
| Gender changed mid-conversation, including the player's | Sex and pronouns are fixed card facts, sent every turn, and the AI cannot edit them |
| Forced encounters and quest-pushing mid-conversation | There is no plot-pusher. Interruptions come only from the calendar or a rare code-rolled event that fits the place and time |
| A character ignored the last thing said | The prompt requires every reply to answer what the player just said or did before anything else |

Standing prompt rules for the narrator:

- Second person, present tense, concrete and sensory.
- Never decide what the player's character says, thinks or does beyond the stated action.
- No closing question such as "What do you do next?" and no menu of choices.
- No softening, warnings or moralizing. Do not cut away from violence or sex.
- Keep every recurring name exactly as written on its card.
- People act from their own goals, mood and what they know. They can refuse, lie, leave or be busy.

## Time and calendar

The game tracks a full date and time, shown as weekday, month, day and year with a 12-hour am/pm clock. The world bible sets the starting date and, for invented worlds, the month names.

The referee picks a duration class for each action and the code picks the exact minutes.

| Class | Time passed | Example |
| --- | --- | --- |
| Instant | None | A glance, a one-word answer |
| Moment | About 10 seconds | One line of dialogue, drawing a weapon |
| Short | 1 to 5 minutes | Searching a desk, a quick exchange of blows |
| Task | 15 to 30 minutes | Picking a hard lock, bandaging a wound, a meal |
| Long | 1 to 3 hours | A stakeout, crossing a district, a night of drinking |
| Extended | Half a day or more | A day's travel, a shift of work, a full sleep |

**Passing time on purpose.** The player can wait until something happens, sleep, or skip a number of days. Each resolves in one turn. Calendar events fire in order during the skip, and the skip stops early if something happens that needs the player.

**Two calendars.**

- The **calendar screen** shows what the character knows about: rent days, appointments, job deadlines, recovery dates, promised meetings.
- The **hidden calendar** holds world events the player has not learned of. See the World section.

Each day also stores weather and daylight, which feed the narration and later the audio.

## Character, skills and XP

Skills grow only by being used, and failures count. Levelling is slow by design.

**Creation.** The player describes a world, then gives or accepts a name, sex, age, looks and a one-line background. The game master adds a backstory, starting gear, one ally and one enemy. Starting skills come from the background.

**Attributes.** Six numbers that change rarely: Strength, Agility, Toughness, Wits, Charm, Nerve. Each gives a modifier from -1 to +3.

**Skills.** Each skill has a level from 0 (untrained) to 10 (master). The starter skill list is below. The world bible can rename or add skills to fit the setting, such as a magic or hacking skill.

| Group | Skills |
| --- | --- |
| Fighting | Combat (general), Unarmed, Blades, Blunt weapons, Firearms, Bows and thrown |
| Body | Athletics, Stealth, Survival |
| Hands | Lockpicking, Sleight of hand, Repair and crafting, Driving or riding |
| Mind | Medicine, Knowledge of the setting, Perception |
| People | Speech, Deception, Intimidation, Haggling |

**Checks.** d20 + skill level + attribute modifier, against a difficulty the referee sets before the roll. A natural 20 always succeeds and a natural 1 always fails. Missing by 3 or less is a success at a cost.

**XP rules.**

- Every check gives XP to the skill used. Weapon skills also give half as much to Combat.
- A failure gives 60% of the XP of a success.
- XP scales with difficulty against current level. A trivial task for the character's level gives almost nothing.
- Each level costs more than the last. Starting formula: 100 x (next level) to the power 1.5.
- Gains in one skill shrink after the fifth gain in the same in-game day, which stops grinding.

**Other people.** Carded people use the same skill sheet. Their skills grow slowly, and only at reunion catch-up, along their life direction. Companions gain XP by use at the same rate as the player.

**Skills screen.** A table: skill, level, progress to next level, governing attribute.

## Body, combat, healing and addiction

There is no single health number. A character is a body with parts, and each wound is its own record.

**Body map.**

| Part | What can be damaged inside |
| --- | --- |
| Head | Brain, eyes, jaw and teeth, skull |
| Neck | Carotid artery, windpipe, spine |
| Chest | Heart, lungs, ribs |
| Abdomen | Liver, stomach and intestines, kidneys |
| Each arm | Brachial artery, bones, hand |
| Each leg | Femoral artery, bones, foot |

**Wound record.** Location, type (cut, stab, gunshot, blunt, burn, fracture), severity 1 to 5, bleeding rate, infected or not, treated or not, date.

**Whole-body meters.** Blood, pain, consciousness and infection. Wounds feed these. A hurt arm penalizes anything done with that arm, a hurt leg slows movement, a lung wound cuts stamina. Blood loss leads to weakness, then unconsciousness, then death. An arterial hit bleeds fast and needs pressure or a tourniquet within a few turns.

**Combat.** Fights run as short exchanges. The player states what they try, the referee sets the check, the code resolves it.

- Position is tracked with three tags: range (grappling, melee, near, far), cover (none, partial, full) and stance.
- Ammunition is counted.
- Hits land on a body part. Aiming for a specific part is harder. Armour protects by location.
- Named opponents use the full body model. Unnamed crowd opponents use a three-state version: fine, hurt, down.

**Healing.** Treatment happens in stages, and each stage has its own tools and skill check.

1. Stop the bleeding: pressure, bandage, tourniquet.
2. Clean the wound, or risk infection.
3. Close it: stitches or cautery.
4. Set broken bones: splint, then weeks of rest.
5. Surgery for organ damage: needs a surgeon and a place to operate.
6. Rest. Recovery runs in days and weeks on the calendar.

The Medicine skill of whoever treats the wound sets the quality. Poor treatment leaves scars, infection or a permanent penalty such as a limp or a lost eye. The world bible states which treatments exist in that setting.

**Drugs and addiction.** Each substance has effects, a duration, an overdose threshold and an addiction risk per use. Alcohol counts. An addiction record tracks the substance, the level (habit, dependent, severe) and the last dose. Withdrawal arrives on the calendar with penalties. Recovery comes from time without the substance, or treatment. Painkillers used for wounds carry the same risk. Other people can have addictions too.

**Dying and revival.** A lethal injury or overdose puts the character in a dying state with a countdown. The code decides survival from three things:

- Someone nearby cares enough, or has a reason, to help. This reads the relationship numbers.
- Help can be reached in time, given the distance to a doctor or healer.
- The world has the means: surgery, a defibrillator, an overdose antidote, magic.

Surviving has a cost: weeks of recovery, scars, a debt or a favour owed. If the check fails, the character is dead. Instantly fatal injuries skip the dying state.

## Inventory, carrying and hiding spots

Inventory opens from a button as a table, outside the chat. What a character can carry comes from what they are wearing.

**Inventory screen.** Columns: item, quantity, weight, value, where it is carried. A footer shows total weight against the limit. Rows can be sorted and filtered by container.

**Every item has** a name, quantity, weight, value, size class, condition and tags such as weapon, food, drug, tool or key.

| Size class | Examples |
| --- | --- |
| Tiny | Razor blade, coin, pill, key |
| Small | Knife, pistol, phone, wallet |
| Medium | Short sword, bottle, book, hatchet |
| Large | Rifle, long sword, crowbar |
| Huge | Anvil, a body, a crate |

**Carry slots.** Size class decides what fits where. This is what keeps an anvil out of a pocket.

| Slot | Needs | Holds | How easily found in a search |
| --- | --- | --- | --- |
| Hands | Nothing | One item each up to Large. A Huge item takes both and slows movement | In plain sight |
| Pants pockets | Pants | A few Tiny or Small items | Any pat-down |
| Jacket pockets | Jacket | Several Tiny or Small items | Any pat-down |
| Tucked inside jacket | Jacket | One Small or Medium item | Pat-down, usually |
| Belt or waistband | Belt or pants | Two Small or Medium items | Pat-down, usually |
| Pant leg | Pants | One Small or Medium weapon per leg | A careful pat-down |
| Sock or boot | Socks or boots | One Tiny or Small item per foot | A careful pat-down |
| Slung on back | A strap or sheath | One Large item | In plain sight |
| Bag or backpack | The bag | Up to Large, limited by the bag's own capacity | Opened in any search |
| Mouth | Nothing | One Tiny item. Speech is impaired | Only a strip search |
| Body cavity | Nothing | One Tiny or Small item. Slow to place and retrieve | Only a cavity search |

Mouth, body cavity, sock and boot are real slots, not something the game master is trusted to remember.

**Weight limit.** Set by Strength and kept generous. Over the limit, the character is slower and tires faster. A hard cap sits at about one and a half times the limit.

**Edge cases.** The code enforces size and count. The referee judges anything unusual for plausibility.

**Searches.** A search is a check by the searcher against how well the item is hidden. Pat-down, strip search and cavity search each reach different slots.

**Storage.** Stashes, home storage, shop stock and other people's pockets all use the same structure.

**Prices.** The world bible creates a price catalogue for the setting. A new item takes its value from the nearest catalogue entry, so prices stay consistent.

## People

Every person who matters has a card. Nobody is simulated while the player is away. When the player meets them again, the game works out what happened in between.

**What a card holds.**

| Part | Contents | Who can change it |
| --- | --- | --- |
| Fixed facts | Name, sex and pronouns, birth date, looks, voice and manner | Nobody, once set |
| Life | Job, home, workplace, faction and rank, wealth tier, family links, daily schedule | Code |
| Direction | Where their life is heading: rising, steady or sliding, and in what | Code |
| Body | Skills, wounds, addictions | Code |
| Relationship | Trust, fear, attraction and respect toward the player, each -100 to 100. Date last seen | Code |
| Shared history | Dated one-line entries of what they and the player did together | Code, from accepted turns |
| What they know | Which of the player's deeds they have learned about | Code |
| Media | Portrait image, sound tags | Painter provider |

**Three tiers.**

- **Close:** companions, family, lovers, sworn enemies. Updated every in-game day by code.
- **Known:** anyone carded. Updated only at reunion.
- **Crowd:** not stored at all. A crowd member is promoted to Known when they are named, traded with, fought, or otherwise start to matter.

**Reunion catch-up.** When the player meets a Known person after a gap of more than a few days:

1. The code works out how long it has been.
2. It rolls the gap along the person's direction. A rising gang member is likely a better fighter with more money or rank. A man on the slide is likely worse off, with a new habit or injury.
3. A swerve has a low chance, about 5% per month: he left the gang and has a family, or he got clean and found work.
4. Any hidden calendar events about that person are applied.
5. The results are written to the card before the narrator sees the scene, so they are fixed and consistent.

This costs no extra AI requests. The narrator shows the changes naturally in the same reply.

**Relationships need upkeep.** Closeness fades without contact, slowly for family and faster for casual ties. Time together, favours, gifts and kept promises build it. Broken promises, harm and neglect damage it. Romance, marriage and children are supported.

**Companions.** A companion follows the player and has their own body, inventory, skills and loyalty. They take orders but can refuse, leave or betray when loyalty is low or their own goals conflict. They can die.

**Children.** A pregnancy runs on the calendar. A child gets a card at birth and ages by date. A child can become the player's heir. See Death and legacy.

## World

The world is built once as a hidden world bible, then kept alive by a calendar of dated events. The code runs it. The AI is asked only for big-picture decisions.

**World bible.** Generated at the start of a run by Gemini 3.8 Flash and hidden from the player. It holds:

- Setting facts: place, era, technology or magic level, what medicine exists, how secrets tend to get out.
- Calendar, currency and the price catalogue.
- Four to eight factions, each with goals, territory, leaders, resources and relations with the others.
- A map of regions and key places with travel times between them.
- Key people, with cards.
- Law: what is illegal and who enforces it.
- Secrets the player can uncover.
- A timeline of what happens if the player does nothing. These go onto the hidden calendar.

What the player discovers is copied into the journal.

**Places.** A place card holds name, type, region, description, owner, state (open, closed, abandoned), who is usually there, connections with travel times, image and sound tags. A place is generated on the first visit and fixed after that.

**The hidden calendar.** Every consequence becomes a dated event that fires whether or not the player is watching. Example, after the player kills a shopkeeper:

| When | Event |
| --- | --- |
| Same day | Shop closes. Witnesses, if any, start to talk |
| 2 weeks later | If the shopkeeper has a son or someone close, they take over and the shop reopens |
| If nobody takes over | Shop becomes abandoned |
| Each month after 3 months | A chance that someone new moves in |

**Faction moves.** Once per in-game week, one request asks what each faction does next, given its sheet and recent events. The answers become calendar events.

**Reputation and who knows what.**

- Each faction holds a standing toward the player from -100 to 100, plus a rank if the player is a member.
- Every notable deed is recorded: what, when, where, who gained, who was harmed, who witnessed it, what evidence was left.
- Standing changes only with factions and people who know about the deed. Helping one faction does not lower standing with its enemies until they learn of it.
- Knowledge spreads through witnesses reporting back, rumour, discovered evidence, or the player talking.
- A deed with no witnesses and no evidence stays secret, unless the setting gives a reason for it to come out.

**Law and crime.** Wanted status is tracked per jurisdiction, with bounties, arrest, fines and jail. Jail time passes on the calendar.

**Random events.** Rolled by code at low odds with a cooldown. An event must fit the place and time. It never interrupts a conversation unless it physically happens there.

**Jobs and promises.** There is no quest-pusher. A job or promise is a journal entry, with a calendar deadline if it has one. Missing it has consequences, but the world does not nag.

## Property, income and needs

The player can own buildings and businesses that pay out on the calendar. Upkeep and daily needs exist, but both run quietly unless something is wrong.

**Property card.** Type (apartments, shop, house, land), location, condition 0 to 100, value, income rule, tenants or staff, manager, upkeep policy.

**Income.**

- Rent is collected on the first of each month.
- A shop or business earns profit daily. It builds up in the till until the player or a manager collects it.
- Earnings depend on location, condition, stock, staff skill, local reputation and events.

**Upkeep without tedium.** Condition drops slowly, about 1 to 2 points a month. The game raises a repair decision only when condition crosses 75, 50 or 25, or after damage such as a fire. Each decision is one journal note with a cost.

| Upkeep policy | What happens |
| --- | --- |
| Maintain | Repairs are paid automatically. Nothing to do |
| Minimal | Only urgent repairs are paid. Condition drifts down |
| Neglect | No repairs. Rents fall, worse tenants move in, incidents rise, and the owner gains a slumlord reputation locally |

Neglect is a playable strategy, not a failure state.

**Managers.** A hired manager collects income and handles repairs for a wage. A manager may skim, depending on their honesty and loyalty.

**Getting and losing property.** Property can be bought, inherited, taken by force or gained by fraud. It can also be lost to debts, factions or the law.

**Property screen.** A table: property, type, condition, income, next payment, policy.

**Needs.** Hunger, thirst and sleep.

- Eating and drinking are daily and automatic. At the end of each day, if the character has food and drink or has money somewhere it can be bought, the game deducts it and adds one line to the day's log.
- Needs only become a problem when they cannot be met: broke, in the wilderness, locked up. Penalties then build over days, and starvation or thirst can kill.
- After about 18 hours awake, tiredness penalties begin. Sleeping passes time, and better lodging gives better recovery.

## Undo and rewrite

An Undo button reverts the last turn completely and opens a text box. What the player types in the box decides what happens next.

| Typed in the box | Result |
| --- | --- |
| Nothing | The turn is removed. The player takes a new action, with a new roll if one is needed |
| "Back 2 turns", or any number | That many turns are removed |
| What should have happened instead | The text becomes canon. No roll is made. The narrator rewrites the scene to match |

- Undo restores everything: dice, time, wounds, inventory, calendar events and cards.
- The game keeps snapshots of the last 20 turns.
- Rewrite text is trusted. The code still records the resulting changes properly, but does not judge whether they are plausible.
- Example: a character reacts in a way that does not fit. The player hits Undo, types how they should have reacted, and the game master adjusts.
- Undo is on while the game is being built and tuned. Settings has a switch to turn it off later for a no-takebacks mode.

## Death and legacy

When a character dies for good, the player chooses to continue in the same world or start fresh.

**Continue this world.**

- The player picks who to play next: an adult child first, then a spouse, companion or relative, or a stranger arriving in the same world.
- The world state, both calendars and every card carry over. People still remember the dead character.
- Property, stashes and money pass on according to the world's law and who claims them. Debts and enemies pass on too. Reputation carries over in part, through the family name.
- The dead character's grave becomes a place.
- If the chosen heir is still a child, the world skips ahead until they are 18. The gap runs through the hidden calendar and reunion catch-up, and the player gets a short summary of those years.

**Start fresh.** A new world bible is generated. The old world is kept as its own save slot.

**Graveyard screen.** A list of past characters with dates, world and cause of death.

## Screens

Every menu is a button that opens over the chat as a spreadsheet-style table. Everything is text for now, with slots reserved for icons later.

| Screen | Shows |
| --- | --- |
| Play | Story log, action box, Undo button. A header with date, time and place, and a one-line body status |
| Inventory | Item, quantity, weight, value, where carried. Total weight against the limit |
| Body | Wounds by body part, blood, pain, conditions, addictions, needs |
| Skills | Skill, level, progress to next level, governing attribute |
| People | Everyone carded: name, role, relationship, last seen. Tap a name for the full card and portrait |
| Journal | Jobs and promises, known facts, rumours, discovered lore |
| Calendar | Upcoming events the character knows about |
| Map | A text list of known regions and places with travel times and the current location |
| Property | Property, type, condition, income, next payment, policy |
| Factions | Known factions, standing and rank |
| Graveyard | Past characters |
| Settings | Keys, providers, requests used today, text size, Undo switch, export and import |
| Developer console | Raw game state and the log of rejected AI changes. For tuning during the build |

## Images and audio

Each place and each carded person gets one image, generated once and kept. Audio is left out for now, but the data it needs is stored from the start.

**Place backgrounds.**

- Generated the first time the player enters a place, from the place card's description plus the world's art-style line.
- Shown dimmed behind the story text so the text stays readable. It fades in when ready.
- The same image is used on every later visit.

**Portraits.**

- Generated the first time the player taps a person's name, from the fixed looks on their card.
- Shown in a pop-up window, not as a background.

**Rules for both.**

- Text always appears first. An image never holds up play.
- Each world has one fixed art-style line so all its images match.
- Every card has a "regenerate" button and an "attach your own image" button.
- Images are compressed and stored on the phone.

**Provider.** Cloudflare Workers AI free tier, through the swappable painter provider. A local generator on a home PC can be added later as a second provider.

**Not in scope yet.** Unique item art. Images of explicit scenes. Both can be added later, and attach-your-own covers them in the meantime.

**Audio hooks.** Place cards store sound tags, for example crowd, fire and bard for a busy pub. Weather and time of day are stored per day. A later sound provider can mix looping sounds from those tags with no rework. Spoken narration is a possible later addition.

## Saves and backups

The game saves to the phone after every turn, with one save slot per world.

- Saves live in the phone's browser storage. Clearing the browser's site data deletes them.
- Settings has an Export button that writes a backup file, with images optional, and an Import button that restores one.
- The save format carries a version number, so older saves can be upgraded as new systems are added.

## Build stages

The game is built in eight stages, and each one ends with something playable. Every stage finishes with a playtest and a round of tuning before the next begins.

| Stage | What gets built | What the player can do at the end |
| --- | --- | --- |
| 0. Setup | Project, Gemini key entry, provider layer, content settings, request counter, blocked-reply notices, free hosting so the phone can install the app | Send one message to the game master from the phone |
| 1. Core loop and inventory | World premise and character creation. The turn loop with referee, dice and checked changes. Person and place cards with fixed facts. Inventory with slots, size and weight. Undo and rewrite. Saves | Play a full scene in any setting, carry and hide items, undo a turn |
| 2. Time and skills | Clock, calendar, action durations, wait, sleep and skip. Skills and XP. Needs | Stake something out in one turn, watch skills grow, check the calendar |
| 3. Body and combat | Body map, wounds, bleeding, combat positions, healing stages, drugs and addiction, dying and revival | Fight, get hurt in specific ways, be treated, nearly die |
| 4. Living world | World bible, factions, reputation and who-knows-what, hidden calendar, reunion catch-up, relationships, companions, law. Journal, People, Map and Factions screens | Leave a town for a month and come back to find it changed |
| 5. Property | Ownership, rent and profit, upkeep policies, managers | Buy a building and collect rent, or let it rot |
| 6. Legacy | Children, heirs, continue-or-fresh on death, graveyard | Die and carry on as an heir |
| 7. Images | Place backgrounds, portraits, attach-your-own | See each place and person |

Audio and spoken narration come after stage 7, if wanted.

## Open questions

Nothing here blocks stage 0 or 1. Each item is checked at the stage where it first matters.

- **Gemini limits.** Free limits can change. Re-read them in AI Studio at setup.
- **Content over a long scene.** Flash-Lite passed a graphic violence test on Oct 6, 2026. Confirm explicit sex scenes hold up across a long scene, not just one message.
- **Cloudflare images.** The free allowance of about 230 images a day comes from a third-party guide. Confirm the real number and which image models are free at sign-up.
- **Where the app lives.** The code is in a public GitHub repository. Confirm free hosting from that repository (GitHub Pages) at stage 0.
- **Game name.** Not chosen yet.
- **Spoken narration.** Gemini lists voice models with a free tier. Limits not checked.
- **Tuning.** Every number in this document is a starting value.

## Working with the player

The player is not a programmer and is building and testing entirely from an Android phone.

- Explain plans and problems in plain language.
- When the player has to do something (get a key, open a link, change a setting), give one step at a time and wait.
- At the end of each stage, say exactly how to open the game on the phone and what to try.
- Never put API keys in the repository.
