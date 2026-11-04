# The Mist Age - Learn Spell

A Daggerheart module for Foundry VTT: learning new spells as a project. A character studies a spell book from their inventory (or a spell the GM gives); every attempt costs materials and paper, the progress moves with Hope and Fear, and once it is reached the spells are added to the character as domain cards.

## Opening

The wand button next to the rest buttons on the character sheet (right after the alchemy flask when The Mist Age - Alchemy is active), or *Learn Spell* in the sheet's header menu. Like brewing in alchemy, spell learning is turned on per character: in the GM's panel (*Spells* in the Actors sidebar header), or with *Can learn spells* at the top of the character's Learn Spell window. Players see the button only when it is on; the GM always sees it.

## Rules

| | |
|---|---|
| Progress needed | 14 + spell level + tier × 2 |
| Progress needed, book of several spells | 16 + spell level + tier × 2 |
| Difficulty | 14 + spell level, **+2 without paper** |
| Usual price of an attempt | alchemy and magic materials worth 2.5 Silver × spell level |
| What the player puts in before rolling | at least the price of the dearest outcome (failure with Fear) |

Tier by level: 1 → 1, 2–4 → 2, 5–7 → 3, 8–10 → 4. A book uses its highest spell level.

The counter counts down: it shows what is left to learn, full at the start (20 / 20 for a level 2 spell), every bit of progress lowers it, and at 0 the spell or project is learnt. The GM's pencil edits this same number.

The outcome sets what the attempt gives and really costs. Silver is the usual price times the share, rounded up to whole Silver; the paper is rolled:

| Outcome | Progress | Silver | Paper |
|---|---|---|---|
| Critical success | +3 | × 1 | 1d4 |
| Success with Hope | +2 | × 0.75 | 1d4+1 |
| Success with Fear | +1 | × 1.25 | 1d6+2 |
| Failure with Hope | 0 | × 1 | 1d4 |
| Failure with Fear | 0 | × 1.5 | 2d4+1 |

For a level 2 spell that is 5 / 4 / 7 / 5 / 8 Silver; level 1: 3 / 2 / 4 / 3 / 4; level 3: 8 / 6 / 10 / 8 / 12. Every study shows its own table under the progress bar.

The roll is a Daggerheart action roll with the character's spellcasting trait (Knowledge when they have none). Without paper nothing is spent on paper and the difficulty is +2.

## Choosing the materials

As with the ingredients when brewing, the player chooses what to spend. The window lists the spell materials in the inventory (cheapest first, with their worth); the arrow next to one, or dragging it onto the window, puts units in (asks how many, Shift puts in all). A put-in material is taken back with a click (Shift: all of it). The roll is possible once what is put in is worth at least the price of the dearest outcome (failure with Fear: 8 Silver for a level 2 spell), so whatever the dice say can be paid.

After the roll the outcome's price is spent out of what was put in, the cheapest units first, and the rest stays in the inventory. Should a put-in material be gone by then, the player is asked which other materials to add (pre-filled with the cheapest that cover the rest); whatever is still short is noted in the chat for the GM.

## The GM's panel

*Spells* in the Actors sidebar header opens a panel like the alchemy one: every player character in one table, with a checkbox that turns spell learning on or off, how many spells they are learning and have learnt, their spell books, the worth of their materials and their paper, and buttons to their Learn Spell window and sheet. Its *Spell Library* button opens the library.

## Setting up (GM): the Spell Library

Like the alchemy materials, everything is set up in one place: the **Spell Library**, opened from the GM's panel, from the module settings, or from the button at the bottom of a Learn Spell window. Nothing is added to the item sheets. Items are dropped in (one item or a whole folder, from the world or a compendium) and matched by name, so every copy of an item counts. Three tabs:

- **Books.** A book or scroll item, with a drop zone under it for the domain cards it teaches. A character with that item in the inventory sees it under *Books in the inventory* and can start learning. A book with several cards, or a Codex grimoire card (*Book of …*), counts as a book of several spells; finishing it grants all its cards. The book has to stay in the inventory to keep studying.
- **Materials.** The alchemy and magic materials that pay for the attempts; the character's money is not touched. A unit is worth its price from The Mist Age - Toolkit (in Silver), or 1 Silver when it has none. Whole units only, so an attempt may use a little more than its exact price.
- **Paper.** Items to write on. Items named *Paper*, *Папір* or *Бумага* (such as *Paper (HB)*) count as paper even when not listed.

A spell can also be given without a book: drop a domain card onto a character's Learn Spell window.

**Projects.** *Add a project* (GM, at the bottom of a character's Learn Spell window) creates a study with no domain card: the GM gives it a name, an icon, a description and a level. It works exactly like learning a spell of that level — the same progress needed, difficulty and outcome table — but finishing it grants no card; it just moves to *Learnt* and the chat says the project is finished. Only the GM removes a project.

A project can also have its **own table**: in its editing (pencil) tick *Own table*, and the progress needed, the difficulty and every outcome's progress, Silver and paper formula become editable (they start from the level's numbers). The player then puts in materials worth its dearest outcome. Unticking it brings the level's numbers back. The pencil on a study lets the GM change its level, what is left on its counter and the book flag; a learnt study can be started over. A study whose progress reaches what it needs is learnt and moves to the *Learnt* tab, whether by a roll or by the GM's hand (a spell's cards are added then too); lowering a learnt study's progress below that makes it active again.

Learnt cards go into the loadout while there is room, otherwise into the vault. Cards the character already has (by name) are skipped.

Sums are counted in Penny. Exchange rates come from The Mist Age - Toolkit's settings when it is active, otherwise 10 Penny = 1 Silver, 100 Silver = 1 Gold, 10 Gold = 1 Gold Bar.

## Data

- Turned on: `flags["mist-age-learn-spell"].enabled` on the actor.
- Studies: `flags["mist-age-learn-spell"].projects` on the actor — `{ [id]: { name, img, cards, level, book, source, progress, completed, sort, project, description, table } }` (`project: true` with no cards for a GM project; `table` = `{ needed, difficulty, outcomes: { critical: { gain, silver, paper }, … } }` for its own table).
- The library: world setting `mist-age-learn-spell.library` — `{ books: [{ name, img, spells: [uuid] }], materials: [{ name, img, worth }], paper: [{ name, img }] }`, matched by item name. A material's worth in the inventory comes from `flags["mist-age-prices"].price` (Silver); `worth` is only what the library shows.

## Macro API

```js
const api = game.modules.get("mist-age-learn-spell").api;
api.show(actor);              // open a character's spell learning
api.library();                // GM: the spell library
api.hub();                    // GM: the panel of all player characters
api.study(actor, projectId, placed); // one attempt; placed = Map of item id → units put in
api.projects(actor);          // the character's studies
```
