export const MODULE_ID = "mist-age-learn-spell";

/*
 * Learning a spell (The Mist Age rules, "Правила/Learn Spell"):
 * - progress needed: 14 + spell level + tier × 2; a book of several spells: 16 + level + tier × 2;
 * - difficulty: 14 + spell level, +2 when the character has no paper to write on;
 * - the usual price of an attempt is 2.5 Silver × spell level in alchemy and magic materials; the outcome sets what
 *   it really costs (rounded up to whole Silver) and how much paper it takes (the table of Raise Undead, level 2):
 *     critical            +3 progress, price × 1,    1d4 paper
 *     success with Hope   +2 progress, price × 0.75, 1d4+1 paper
 *     success with Fear   +1 progress, price × 1.25, 1d6+2 paper
 *     failure with Hope    0 progress, price × 1,    1d4 paper
 *     failure with Fear    0 progress, price × 1.5,  2d4+1 paper
 *   materials are the items in the GM's list, worth their Toolkit price, 1 Silver each when they have none;
 * - a project may have its own table instead (project.table): progress needed, difficulty, and per outcome the
 *   progress, Silver and paper formula.
 *
 * Stored on the actor: flags["mist-age-learn-spell"].enabled (the GM lets the character learn spells) and
 * flags["mist-age-learn-spell"].projects =
 * { [id]: { name, img, cards: [uuid], level, book, source, progress, completed, sort, project, description } },
 * where source is the id of the book item in the inventory the spell is learnt from (null when the GM gave it).
 * A project (project: true) is the GM's own study with no cards: it is rolled and paid for like a spell of its
 * level, and finishing it grants nothing by itself.
 *
 * The GM's spell library is one world setting, like the alchemy materials, matched by item name:
 * { books: [{ name, img, spells: [uuid] }], materials: [{ name, img }], paper: [{ name, img }] }.
 * Items named Paper / Папір / Бумага count as paper even when they are not in the list.
 */

export const FLAG = "projects";
export const ENABLED_FLAG = "enabled";
export const LIBRARY = "library";
export const LIBRARY_KINDS = ["books", "materials", "paper"];
/** Where The Mist Age - Toolkit keeps an item's price, in Silver. */
export const PRICE_PATH = "flags.mist-age-prices.price";
export const DEFAULT_IMG = "icons/sundries/books/book-embossed-blue.webp";
export const DEFAULT_PROJECT_IMG = "icons/sundries/scrolls/scroll-runed-brown-purple.webp";
export const DEFAULT_TRAIT = "knowledge";
export const TRAITS = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"];

export const PROGRESS_BASE = 14;
export const PROGRESS_BASE_BOOK = 16;
export const DIFFICULTY_BASE = 14;
export const NO_PAPER_PENALTY = 2;
export const SILVER_PER_LEVEL = 2.5;

/** Roll outcomes, in the order of the tables. */
export const OUTCOMES = ["critical", "successHope", "successFear", "failureHope", "failureFear"];

/** Progress gained per outcome. */
export const GAIN = {
	critical: 3,
	successHope: 2,
	successFear: 1,
	failureHope: 0,
	failureFear: 0
};

/** What an attempt costs, by outcome, as a share of the usual price (rounded up to whole Silver). */
export const COST_MULTIPLIER = {
	critical: 1,
	successHope: 0.75,
	successFear: 1.25,
	failureHope: 1,
	failureFear: 1.5
};

/** Sheets of paper an attempt takes, by outcome. */
export const PAPER = {
	critical: "1d4",
	successHope: "1d4+1",
	successFear: "1d6+2",
	failureHope: "1d4",
	failureFear: "2d4+1"
};

/** Item names that count as paper without being in the list. */
const PAPER_NAME = /^(paper|папір|бумага|лист(ок|ки)? паперу)(?!\p{L})/iu;

/** A Codex grimoire ("Book of Ava") is a single domain card that holds several spells. */
const BOOK_NAME = /^(book of|книга|книжка)(?!\p{L})/iu;

/* -------------------------------------------- */
/*  Spell numbers                                */
/* -------------------------------------------- */

/** Daggerheart tier of a level: 1 → 1, 2–4 → 2, 5–7 → 3, 8–10 → 4. */
export function tierOf(level) {
	const value = Math.max(1, Number(level) || 1);
	if (value <= 1) {
		return 1;
	}
	if (value <= 4) {
		return 2;
	}
	if (value <= 7) {
		return 3;
	}
	return 4;
}

export function getLevel(project) {
	return Math.max(1, Math.floor(Number(project?.level) || 1));
}

/** A project's own table, when the GM gave it one; null when the level's numbers apply. */
export function ownTable(project) {
	return project?.table && typeof project.table === "object" ? project.table : null;
}

export function getNeeded(project) {
	const own = Number(ownTable(project)?.needed);
	if (own > 0) {
		return Math.floor(own);
	}
	const level = getLevel(project);
	return (project?.book ? PROGRESS_BASE_BOOK : PROGRESS_BASE) + level + tierOf(level) * 2;
}

export function getDifficulty(project, hasPaper = true) {
	const own = Number(ownTable(project)?.difficulty);
	const base = own > 0 ? Math.floor(own) : DIFFICULTY_BASE + getLevel(project);
	return base + (hasPaper ? 0 : NO_PAPER_PENALTY);
}

/** Silver an outcome of the level costs: the usual price times the outcome's share, rounded up. */
function levelSilver(project, outcome) {
	return Math.ceil(SILVER_PER_LEVEL * getLevel(project) * (COST_MULTIPLIER[outcome] ?? 1) - 1e-9);
}

/**
 * What each outcome gives and costs: { [outcome]: { gain, silver, cost (Penny), paper (formula) } }, from the
 * project's own table where it has one, otherwise from its level.
 */
export function outcomeTable(project) {
	const own = ownTable(project)?.outcomes ?? {};
	const rate = pennyRates().handfuls;
	const table = {};
	for (const outcome of OUTCOMES) {
		const row = own[outcome] ?? {};
		const silver = Number.isFinite(Number(row.silver)) && row.silver !== "" && row.silver !== null
			? Math.max(0, Number(row.silver))
			: levelSilver(project, outcome);
		const paper = String(row.paper ?? "").trim() || PAPER[outcome];
		const gain = Number.isFinite(Number(row.gain)) && row.gain !== "" && row.gain !== null ? Math.trunc(Number(row.gain)) : GAIN[outcome];
		table[outcome] = { gain, silver, cost: Math.round(silver * rate), paper };
	}
	return table;
}

/**
 * What the player puts in before an attempt, in Penny: the price of the dearest outcome (failure with Fear), so any
 * outcome can be paid from it; what a cheaper outcome does not use stays in the inventory.
 */
export function getBaseCost(project) {
	return Math.max(...Object.values(outcomeTable(project)).map(row => row.cost));
}

/** Whether a set of domain cards makes a book: several spells, or one grimoire card. */
export function isBook(cards) {
	return cards.length > 1 || cards.some(card => BOOK_NAME.test(card?.name ?? ""));
}

/* -------------------------------------------- */
/*  Projects                                     */
/* -------------------------------------------- */

export function getProjects(actor) {
	const saved = actor?.getFlag(MODULE_ID, FLAG) ?? {};
	return Object.entries(saved)
		.map(([id, project]) => ({ id, ...project, cards: project.cards ?? [] }))
		.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
}

export function hasProjects(actor) {
	return getProjects(actor).length > 0;
}

export async function saveProject(actor, id, changes) {
	await actor.setFlag(MODULE_ID, `${FLAG}.${id}`, changes);
}

export async function deleteProject(actor, id) {
	await actor.update({ [`flags.${MODULE_ID}.${FLAG}.-=${id}`]: null });
}

/** Loads the domain cards behind uuids, skipping the ones that are gone. */
export async function loadCards(uuids) {
	const cards = [];
	for (const uuid of uuids ?? []) {
		const card = await fromUuid(uuid);
		if (card?.type === "domainCard") {
			cards.push(card);
		}
	}
	return cards;
}

/**
 * Starts a project from domain cards. With a source book the name and icon come from the book, else from the card.
 * Returns the project id, or null when there is nothing to learn.
 */
export async function createProject(actor, uuids, sourceItem = null) {
	const cards = await loadCards(uuids);
	if (!cards.length) {
		return null;
	}
	const id = foundry.utils.randomID();
	const sort = getProjects(actor).reduce((max, project) => Math.max(max, project.sort ?? 0), 0) + 1;
	await saveProject(actor, id, {
		name: sourceItem?.name ?? cards[0].name,
		img: sourceItem?.img ?? cards[0].img ?? DEFAULT_IMG,
		cards: cards.map(card => card.uuid),
		level: Math.max(...cards.map(card => Number(card.system?.level) || 1)),
		book: isBook(cards),
		source: sourceItem?.id ?? null,
		progress: 0,
		completed: false,
		sort
	});
	return id;
}

/** GM: a project of the character's own, learnt like a spell of its level but granting no card. Returns its id. */
export async function createCustomProject(actor) {
	const id = foundry.utils.randomID();
	const sort = getProjects(actor).reduce((max, project) => Math.max(max, project.sort ?? 0), 0) + 1;
	await saveProject(actor, id, {
		name: game.i18n.localize("MIST_SPELL.Project.NewName"),
		img: DEFAULT_PROJECT_IMG,
		description: "",
		cards: [],
		level: 1,
		book: false,
		source: null,
		project: true,
		progress: 0,
		completed: false,
		sort
	});
	return id;
}

/* -------------------------------------------- */
/*  The GM's spell library                       */
/* -------------------------------------------- */

export function registerSettings() {
	game.settings.register(MODULE_ID, LIBRARY, {
		scope: "world",
		config: false,
		type: Object,
		default: { books: [], materials: [], paper: [] },
		onChange: () => Hooks.callAll(`${MODULE_ID}.libraryChanged`)
	});
}

export function normalizeName(name) {
	return String(name ?? "").trim().toLocaleLowerCase();
}

export function getLibrary() {
	const saved = game.settings.get(MODULE_ID, LIBRARY) ?? {};
	return Object.fromEntries(LIBRARY_KINDS.map(kind => [kind, foundry.utils.deepClone(saved[kind] ?? [])]));
}

export async function saveLibrary(library) {
	for (const kind of LIBRARY_KINDS) {
		library[kind].sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
	}
	await game.settings.set(MODULE_ID, LIBRARY, library);
}

function findEntry(kind, item) {
	const key = normalizeName(item?.name);
	return key ? getLibrary()[kind].find(entry => normalizeName(entry.name) === key) ?? null : null;
}

/** Adds items (by name) to one of the lists; books start with no spells. Returns how many were new. */
export async function addToLibrary(kind, items) {
	const library = getLibrary();
	let added = 0;
	for (const item of items) {
		const key = normalizeName(item.name);
		if (!key || library[kind].some(entry => normalizeName(entry.name) === key)) {
			continue;
		}
		const entry = { name: item.name, img: item.img };
		if (kind === "books") {
			entry.spells = [];
		} else if (kind === "materials") {
			entry.worth = item.worth;
		}
		library[kind].push(entry);
		added += 1;
	}
	if (added) {
		await saveLibrary(library);
	}
	return added;
}

export async function removeFromLibrary(kind, name) {
	const library = getLibrary();
	const key = normalizeName(name);
	library[kind] = library[kind].filter(entry => normalizeName(entry.name) !== key);
	await saveLibrary(library);
}

/** Sets the spells (domain card uuids) a book in the library teaches. */
export async function setBookSpells(name, uuids) {
	const library = getLibrary();
	const book = library.books.find(entry => normalizeName(entry.name) === normalizeName(name));
	if (book) {
		book.spells = [...new Set(uuids)];
		await saveLibrary(library);
	}
}

/** The spells an item teaches: the library's book of that name. */
export function getBookSpells(item) {
	return findEntry("books", item)?.spells ?? [];
}

/** Items of the character that teach spells. */
export function getBooks(actor) {
	return actor?.items.filter(item => getBookSpells(item).length > 0) ?? [];
}

/* -------------------------------------------- */
/*  Paper                                        */
/* -------------------------------------------- */

export function isPaper(item) {
	if (!["consumable", "loot"].includes(item?.type)) {
		return false;
	}
	return !!findEntry("paper", item) || PAPER_NAME.test(item.name.trim());
}

export function quantityOf(item) {
	const quantity = item.system?.quantity;
	return Number.isFinite(quantity) ? Math.max(0, quantity) : 1;
}

export function countPaper(actor) {
	return actor?.items.filter(isPaper).reduce((sum, item) => sum + quantityOf(item), 0) ?? 0;
}

/** Spends up to `amount` sheets of paper; returns how many were spent. */
export async function spendPaper(actor, amount) {
	let left = amount;
	const updates = [];
	const deletions = [];
	for (const item of actor.items.filter(isPaper)) {
		if (left <= 0) {
			break;
		}
		const have = quantityOf(item);
		const take = Math.min(have, left);
		left -= take;
		if (have - take > 0 && Number.isFinite(item.system?.quantity)) {
			updates.push({ _id: item.id, "system.quantity": have - take });
		} else {
			deletions.push(item.id);
		}
	}
	if (updates.length) {
		await actor.updateEmbeddedDocuments("Item", updates);
	}
	if (deletions.length) {
		await actor.deleteEmbeddedDocuments("Item", deletions);
	}
	return amount - left;
}

/* -------------------------------------------- */
/*  Sums in Penny                                */
/* -------------------------------------------- */

const CURRENCIES = ["chests", "bags", "handfuls", "coins"];
// Sums are counted in Penny. The Mist Age's: 10 Penny = 1 Silver, 100 Silver = 1 Gold, 10 Gold = 1 Gold Bar. The Toolkit's rates win when set.
const RATE_DEFAULTS = { coinsPerHandful: 10, handfulsPerBag: 100, bagsPerChest: 10 };

function toolkitRate(key) {
	try {
		const value = Number(game.settings.get("mist-age-toolkit", key));
		return value > 0 ? value : RATE_DEFAULTS[key];
	} catch {
		return RATE_DEFAULTS[key];
	}
}

/** Worth of one unit of each currency in Penny. */
export function pennyRates() {
	const handfuls = toolkitRate("coinsPerHandful");
	const bags = handfuls * toolkitRate("handfulsPerBag");
	return { coins: 1, handfuls, bags, chests: bags * toolkitRate("bagsPerChest") };
}

function currencySettings() {
	return game.settings.get("daggerheart", "Homebrew")?.currency ?? {};
}

/** The enabled currencies, largest first. */
function enabledCurrencies() {
	const settings = currencySettings();
	const enabled = CURRENCIES.filter(key => settings[key]?.enabled !== false);
	return enabled.length ? enabled : ["handfuls"];
}

/* -------------------------------------------- */
/*  Spell materials                              */
/* -------------------------------------------- */

/** Items in the GM's list of alchemy and magic materials for learning spells. */
export function isMaterial(item) {
	return ["consumable", "loot"].includes(item?.type) && !!findEntry("materials", item);
}

/** Worth of one unit of a material in Penny: its Toolkit price (in Silver), 1 Silver when it has none. */
export function materialValue(item) {
	const price = Number(foundry.utils.getProperty(item, PRICE_PATH)) || 0;
	return Math.max(1, Math.round((price > 0 ? price : 1) * pennyRates().handfuls));
}

export function getMaterials(actor) {
	return actor?.items.filter(isMaterial) ?? [];
}

/** What all the character's materials are worth, in Penny. */
export function getMaterialsValue(actor) {
	return getMaterials(actor).reduce((sum, item) => sum + quantityOf(item) * materialValue(item), 0);
}

/** What the chosen units (item id → units) are worth, in Penny; units of items that are gone count for nothing. */
export function unitsValue(actor, units) {
	let value = 0;
	for (const [itemId, count] of units ?? []) {
		const item = actor.items.get(itemId);
		if (item && isMaterial(item)) {
			value += Math.min(count, quantityOf(item)) * materialValue(item);
		}
	}
	return value;
}

/**
 * Picks units out of a pool (item id → units available) worth at least `amount` Penny: cheapest first, whole units,
 * so it may cover a little more. Takes the whole pool when it is not enough. Returns item id → units.
 */
export function pickUnits(actor, pool, amount) {
	let left = Math.max(0, Math.round(amount));
	const picked = new Map();
	const entries = [...pool]
		.map(([itemId, count]) => ({ item: actor.items.get(itemId), count }))
		.filter(entry => entry.item && entry.count > 0)
		.sort((a, b) => materialValue(a.item) - materialValue(b.item));
	for (const { item, count } of entries) {
		if (left <= 0) {
			break;
		}
		const unit = materialValue(item);
		const take = Math.min(count, Math.ceil(left / unit));
		picked.set(item.id, take);
		left -= take * unit;
	}
	return picked;
}

/** Every material of the character not already in `used`: item id → units left. */
export function freeMaterials(actor, used = new Map()) {
	const pool = new Map();
	for (const item of getMaterials(actor)) {
		const left = quantityOf(item) - (used.get(item.id) ?? 0);
		if (left > 0) {
			pool.set(item.id, left);
		}
	}
	return pool;
}

/** Spends the chosen units of materials. Returns { value, spent: [{ name, count }] }. */
export async function spendUnits(actor, units) {
	let value = 0;
	const spent = [];
	const updates = [];
	const deletions = [];
	for (const [itemId, count] of units) {
		const item = actor.items.get(itemId);
		if (!item || count <= 0) {
			continue;
		}
		const have = quantityOf(item);
		const take = Math.min(have, count);
		value += take * materialValue(item);
		spent.push({ name: item.name, count: take });
		if (have - take > 0 && Number.isFinite(item.system?.quantity)) {
			updates.push({ _id: item.id, "system.quantity": have - take });
		} else {
			deletions.push(item.id);
		}
	}
	if (updates.length) {
		await actor.updateEmbeddedDocuments("Item", updates);
	}
	if (deletions.length) {
		await actor.deleteEmbeddedDocuments("Item", deletions);
	}
	return { value, spent };
}

/** A sum in Penny as text, such as "1 Silver 5 Penny". */
export function formatMoney(amount) {
	const settings = currencySettings();
	const rates = pennyRates();
	let left = Math.max(0, Math.round(amount));
	const parts = [];
	for (const key of enabledCurrencies()) {
		const count = Math.floor(left / rates[key]);
		left -= count * rates[key];
		if (count > 0) {
			parts.push(`${count} ${game.i18n.localize(settings[key]?.label ?? key)}`);
		}
	}
	return parts.join(" ") || `0 ${game.i18n.localize(settings.handfuls?.label ?? "Silver")}`;
}

/* -------------------------------------------- */
/*  Trait                                        */
/* -------------------------------------------- */

/** The trait a character studies spells with: their spellcasting trait, else Knowledge. */
export function getTrait(actor) {
	const key = actor?.system?.spellcastModifierTrait?.key;
	return TRAITS.includes(key) ? key : DEFAULT_TRAIT;
}

/** Whether the GM turned spell learning on for the character (like brewing in alchemy). */
export function canLearn(actor) {
	return actor?.type === "character" && !!actor.getFlag(MODULE_ID, ENABLED_FLAG);
}

export async function setLearnEnabled(actor, enabled) {
	await actor.setFlag(MODULE_ID, ENABLED_FLAG, !!enabled);
}
