import {
	LIBRARY_KINDS, MODULE_ID, addToLibrary, formatMoney, getLibrary, loadCards, materialValue, normalizeName,
	removeFromLibrary, setBookSpells
} from "./data.js";
import { bindDropZones } from "./drag.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM: the spell library, like the alchemy materials: which items are spell books (and the spells each teaches),
 * which are alchemy and magic materials that pay for the attempts, and which are paper. Items are dropped in (one
 * item or a whole folder) and matched by name, so every copy of an item counts.
 */
export class SpellLibrary extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: `${MODULE_ID}-library`,
		classes: ["mist-spell", "mist-spell-library"],
		window: { icon: "fa-solid fa-book-journal-whills", resizable: true },
		position: { width: 560, height: 640 },
		actions: {
			switchTab: SpellLibrary.#onSwitchTab,
			removeEntry: SpellLibrary.#onRemoveEntry,
			removeSpell: SpellLibrary.#onRemoveSpell,
			openCard: SpellLibrary.#onOpenCard
		}
	};

	static PARTS = {
		body: { template: `modules/${MODULE_ID}/templates/library.hbs` }
	};

	static #instance = null;

	static show() {
		if (!game.user.isGM) {
			return null;
		}
		SpellLibrary.#instance ??= new SpellLibrary();
		SpellLibrary.#instance.render({ force: true });
		return SpellLibrary.#instance;
	}

	constructor(options = {}) {
		super(options);
		/** "books", "materials" or "paper" */
		this.tab = "books";
	}

	get title() {
		return game.i18n.localize("MIST_SPELL.Library.Title");
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const library = getLibrary();
		context.tab = this.tab;
		context.tabs = LIBRARY_KINDS.map(kind => ({
			id: kind,
			active: kind === this.tab,
			label: game.i18n.format(`MIST_SPELL.Library.Tab.${kind}`, { count: library[kind].length })
		}));
		if (this.tab === "books") {
			context.entries = [];
			for (const book of library.books) {
				const cards = await loadCards(book.spells);
				context.entries.push({
					...book,
					cards: cards.map(card => ({ uuid: card.uuid, name: card.name, img: card.img, level: card.system.level }))
				});
			}
		} else {
			context.entries = library[this.tab].map(entry => ({ ...entry }));
		}
		if (this.tab === "materials") {
			// What one unit is worth, as the dropped item was priced; the price in the inventory is what counts.
			for (const entry of context.entries) {
				entry.worthText = formatMoney(entry.worth || materialValue({}));
			}
		}
		context.hint = game.i18n.localize(`MIST_SPELL.Library.Hint.${this.tab}`);
		context.drop = game.i18n.localize(`MIST_SPELL.Library.Drop.${this.tab}`);
		return context;
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		bindDropZones(this.element, "[data-drop]", (items, zone) => this.#onDrop(items, zone));
	}

	_onFirstRender(context, options) {
		super._onFirstRender(context, options);
		this._hook = Hooks.on(`${MODULE_ID}.libraryChanged`, () => this.render());
	}

	_onClose(options) {
		super._onClose(options);
		Hooks.off(`${MODULE_ID}.libraryChanged`, this._hook);
	}

	async #onDrop(items, zone) {
		const target = zone.dataset.drop;
		if (target === "spells") {
			const cards = items.filter(item => item.type === "domainCard");
			if (!cards.length) {
				ui.notifications.warn("MIST_SPELL.NotDomainCard", { localize: true });
				return;
			}
			const book = getLibrary().books.find(entry => normalizeName(entry.name) === normalizeName(zone.dataset.book));
			await setBookSpells(zone.dataset.book, [...(book?.spells ?? []), ...cards.map(card => card.uuid)]);
			return;
		}
		const usable = items.filter(item => ["consumable", "loot"].includes(item.type));
		if (!usable.length) {
			ui.notifications.warn("MIST_SPELL.Library.WrongType", { localize: true });
			return;
		}
		const added = await addToLibrary(target, usable.map(item => ({ name: item.name, img: item.img, worth: materialValue(item) })));
		if (!added) {
			ui.notifications.info("MIST_SPELL.Library.AlreadyThere", { localize: true });
		}
	}

	static #onSwitchTab(event, target) {
		if (target.dataset.tab && target.dataset.tab !== this.tab) {
			this.tab = target.dataset.tab;
			this.render();
		}
	}

	static async #onRemoveEntry(event, target) {
		await removeFromLibrary(this.tab, target.closest("[data-name]")?.dataset.name);
	}

	static async #onRemoveSpell(event, target) {
		const name = target.closest("[data-name]")?.dataset.name;
		const uuid = target.closest("[data-uuid]")?.dataset.uuid;
		const book = getLibrary().books.find(entry => normalizeName(entry.name) === normalizeName(name));
		if (book) {
			await setBookSpells(name, book.spells.filter(entry => entry !== uuid));
		}
	}

	static async #onOpenCard(event, target) {
		const card = await fromUuid(target.closest("[data-uuid]")?.dataset.uuid);
		card?.sheet?.render(true);
	}
}
