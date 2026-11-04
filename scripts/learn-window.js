import {
	DEFAULT_IMG, DEFAULT_PROJECT_IMG, MODULE_ID, OUTCOMES, canLearn, countPaper, createCustomProject, createProject,
	deleteProject, formatMoney, getBookSpells, getBooks, getDifficulty, getMaterials, getNeeded, getProjects, getTrait,
	isBook, isMaterial, loadCards, materialValue, outcomeTable, ownTable, quantityOf, saveProject, setLearnEnabled,
	unitsValue
} from "./data.js";
import { settleStudy, study, studyState } from "./study.js";
import { SpellLibrary } from "./library.js";

const { ApplicationV2, HandlebarsApplicationMixin, DialogV2 } = foundry.applications.api;

/**
 * A character's spell learning: the spells being learnt, the books in the inventory that can be started, and the
 * learnt ones. Like brewing, the player puts in the materials they want to spend (the arrow, or dropping a material
 * here) and rolls. The GM turns spell learning on or off for the character, can drop a domain card here to give a
 * spell to learn without a book, correct the progress and remove a project.
 */
export class LearnSpellWindow extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		classes: ["mist-spell"],
		window: { icon: "fa-solid fa-wand-sparkles", resizable: true },
		position: { width: 580, height: 660 },
		actions: {
			start: LearnSpellWindow.#onStart,
			roll: LearnSpellWindow.#onRoll,
			remove: LearnSpellWindow.#onRemove,
			reopen: LearnSpellWindow.#onReopen,
			toggleEdit: LearnSpellWindow.#onToggleEdit,
			switchTab: LearnSpellWindow.#onSwitchTab,
			openCard: LearnSpellWindow.#onOpenCard,
			openLibrary: () => SpellLibrary.show(),
			place: LearnSpellWindow.#onPlace,
			unplace: LearnSpellWindow.#onUnplace,
			clearPlaced: LearnSpellWindow.#onClearPlaced,
			toggleEnabled: LearnSpellWindow.#onToggleEnabled,
			addProject: LearnSpellWindow.#onAddProject,
			toggleTable: LearnSpellWindow.#onToggleTable,
			pickImage: LearnSpellWindow.#onPickImage
		}
	};

	static PARTS = {
		body: { template: `modules/${MODULE_ID}/templates/learn.hbs` }
	};

	static #instances = new Map();

	static show(actor) {
		if (!actor) {
			return null;
		}
		let app = LearnSpellWindow.#instances.get(actor.uuid);
		if (!app) {
			app = new LearnSpellWindow(actor);
			LearnSpellWindow.#instances.set(actor.uuid, app);
		}
		app.render({ force: true });
		return app;
	}

	constructor(actor, options = {}) {
		super({ ...options, id: `${MODULE_ID}-${actor.id}` });
		this.actor = actor;
		this.busy = false;
		this.editing = new Set();
		/** "active" or "learnt" */
		this.tab = "active";
		/** The materials put in for the next attempt: item id -> units. */
		this.placed = new Map();
	}

	/** Drops what is no longer there: removed or unlisted materials, used-up quantities. */
	#prune() {
		for (const [itemId, units] of this.placed) {
			const item = this.actor.items.get(itemId);
			if (!item || !isMaterial(item)) {
				this.placed.delete(itemId);
			} else if (units > quantityOf(item)) {
				this.placed.set(itemId, quantityOf(item));
			}
		}
	}

	get title() {
		return game.i18n.format("MIST_SPELL.Title", { actor: this.actor.name });
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		this.#prune();
		const isGM = game.user.isGM;
		const all = getProjects(this.actor);
		context.isGM = isGM;
		context.enabled = canLearn(this.actor);
		context.tab = this.tab;
		context.canRoll = this.actor.isOwner && !this.busy && context.enabled;
		context.traitLabel = game.i18n.localize(`DAGGERHEART.CONFIG.Traits.${getTrait(this.actor)}.name`);
		context.activeCount = all.filter(project => !project.completed).length;
		context.learntCount = all.length - context.activeCount;

		const shown = all.filter(project => !!project.completed === (this.tab === "learnt"));
		context.projects = [];
		for (const project of shown) {
			const state = studyState(this.actor, project, this.placed);
			const cards = await loadCards(project.cards);
			const table = outcomeTable(project);
			context.projects.push({
				...project,
				...state,
				img: project.img || DEFAULT_IMG,
				// The counter counts down: what is left to learn, from the full counter to 0.
				left: Math.max(0, state.needed - state.progress),
				percent: Math.round(((state.needed - state.progress) / state.needed) * 100),
				cards: cards.map(card => ({ uuid: card.uuid, name: card.name, img: card.img, level: card.system.level })),
				editing: isGM && this.editing.has(project.id),
				hasTable: !!ownTable(project),
				baseDifficulty: getDifficulty(project, true),
				rows: OUTCOMES.map(outcome => ({
					outcome,
					label: game.i18n.localize(`MIST_SPELL.Outcome.${outcome}`),
					gain: table[outcome].gain,
					gainText: table[outcome].gain > 0 ? `+${table[outcome].gain}` : String(table[outcome].gain),
					silver: table[outcome].silver,
					paper: table[outcome].paper
				}))
			});
		}
		context.paper = countPaper(this.actor);

		// The materials: what is put in for the next attempt, and what is left in the inventory.
		context.placedText = formatMoney(unitsValue(this.actor, this.placed));
		context.placed = [];
		context.materials = [];
		for (const item of getMaterials(this.actor).sort((a, b) => materialValue(a) - materialValue(b))) {
			const units = this.placed.get(item.id) ?? 0;
			const entry = { id: item.id, name: item.name, img: item.img, worth: formatMoney(materialValue(item)), units, left: quantityOf(item) - units };
			if (units > 0) {
				context.placed.push(entry);
			}
			context.materials.push(entry);
		}

		// Books in the inventory whose spells are not being learnt or learnt yet.
		const started = new Set(all.map(project => project.source).filter(Boolean));
		const ownedCards = new Set(this.actor.items.filter(item => item.type === "domainCard").map(item => item.name));
		context.books = [];
		if (this.tab === "active") {
			for (const item of getBooks(this.actor)) {
				if (started.has(item.id)) {
					continue;
				}
				const cards = await loadCards(getBookSpells(item));
				if (!cards.length || cards.every(card => ownedCards.has(card.name))) {
					continue;
				}
				context.books.push({
					id: item.id,
					name: item.name,
					img: item.img,
					book: isBook(cards),
					cards: cards.map(card => ({ uuid: card.uuid, name: card.name, img: card.img, level: card.system.level }))
				});
			}
		}
		return context;
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		if (!game.user.isGM) {
			return;
		}
		// A cell of a project's own table: "needed", "difficulty" or "outcomes.<outcome>.<gain|silver|paper>".
		for (const field of this.element.querySelectorAll("[data-table-field]")) {
			field.addEventListener("change", () => {
				const id = field.closest("[data-project-id]").dataset.projectId;
				const path = field.dataset.tableField;
				let value = field.value.trim();
				if (field.type === "number") {
					const number = Number(value);
					const min = path === "needed" || path === "difficulty" ? 1 : (path.endsWith(".silver") ? 0 : -99);
					value = Number.isFinite(number) ? Math.max(min, path.endsWith(".silver") ? number : Math.trunc(number)) : min;
				}
				saveProject(this.actor, id, { table: foundry.utils.expandObject({ [path]: value }) })
					.then(() => settleStudy(this.actor, id));
			});
		}
		for (const field of this.element.querySelectorAll("[data-project-field]")) {
			field.addEventListener("change", () => {
				const id = field.closest("[data-project-id]").dataset.projectId;
				const key = field.dataset.projectField;
				let value;
				if (field.type === "checkbox") {
					value = field.checked;
				} else if (field.type === "number") {
					value = Math.max(key === "progress" || key === "left" ? 0 : 1, Math.floor(Number(field.value) || 0));
				} else {
					value = field.value.trim();
					if (key === "name" && !value) {
						return;
					}
				}
				const changes = { [key]: value };
				// The GM types what is left on the counter; it is stored as the progress made.
				if (key === "left") {
					const project = getProjects(this.actor).find(entry => entry.id === id);
					const needed = project ? getNeeded(project) : value;
					delete changes.left;
					changes.progress = Math.max(0, needed - Math.min(value, needed));
				}
				saveProject(this.actor, id, changes).then(() => settleStudy(this.actor, id));
			});
		}
	}

	/**
	 * A material of this character dropped on the window is put in (asks how many); for the GM a domain card becomes
	 * a spell to learn without a book.
	 */
	async #onDrop(event) {
		event.preventDefault();
		const data = foundry.applications.ux.TextEditor.implementation.getDragEventData(event);
		if (data?.type !== "Item" || !data.uuid) {
			return;
		}
		const item = await fromUuid(data.uuid);
		if (item?.parent === this.actor && isMaterial(item)) {
			await this.#place(item, { all: event.shiftKey });
			return;
		}
		if (!game.user.isGM) {
			ui.notifications.warn("MIST_SPELL.Materials.NotMaterial", { localize: true });
			return;
		}
		if (item?.type !== "domainCard") {
			ui.notifications.warn("MIST_SPELL.NotDomainCard", { localize: true });
			return;
		}
		await createProject(this.actor, [item.uuid]);
		this.tab = "active";
	}

	/** Asks how many units to put in, from 1 to max; resolves to the number or null when cancelled. */
	async #askCount(item, max) {
		const label = game.i18n.format("MIST_SPELL.Materials.HowMany", { name: foundry.utils.escapeHTML(item.name), max });
		const count = await DialogV2.prompt({
			window: { title: "MIST_SPELL.Materials.HowManyTitle" },
			content: `<div class="mist-spell-count"><p>${label}</p><input type="number" name="count" value="${max}" min="1" max="${max}" step="1" autofocus></div>`,
			ok: {
				label: "MIST_SPELL.Materials.Add",
				icon: "fa-solid fa-arrow-up",
				callback: (event, button) => Number(button.form.elements.count.value)
			},
			rejectClose: false
		});
		return Number.isFinite(count) && count >= 1 ? Math.floor(count) : null;
	}

	/** Puts units of a material in: asks how many when more than one is left; Shift puts in all. */
	async #place(item, { all = false } = {}) {
		if (!this.actor.isOwner || this.busy) {
			return;
		}
		const left = () => quantityOf(item) - (this.placed.get(item.id) ?? 0);
		const max = left();
		if (max <= 0) {
			return;
		}
		const count = max === 1 || all ? max : await this.#askCount(item, max);
		const units = Math.min(count ?? 0, left());
		if (units > 0) {
			this.placed.set(item.id, (this.placed.get(item.id) ?? 0) + units);
			this.render();
		}
	}

	_onFirstRender(context, options) {
		super._onFirstRender(context, options);
		const rerender = document => {
			const actor = document.documentName === "Actor" ? document : document.parent;
			if (actor === this.actor && !this.busy) {
				this.render();
			}
		};
		this._hooks = ["updateActor", "createItem", "updateItem", "deleteItem"].map(hook => [hook, Hooks.on(hook, rerender)]);
		this._hooks.push([`${MODULE_ID}.libraryChanged`, Hooks.on(`${MODULE_ID}.libraryChanged`, () => this.render())]);
		// GM: a domain card dropped on the window becomes a spell to learn without a book.
		this.element.addEventListener("dragover", event => event.preventDefault());
		this.element.addEventListener("drop", event => this.#onDrop(event));
	}

	_onClose(options) {
		super._onClose(options);
		for (const [hook, id] of this._hooks ?? []) {
			Hooks.off(hook, id);
		}
		this._hooks = null;
	}

	#projectFrom(target) {
		const id = target.closest("[data-project-id]")?.dataset.projectId;
		return getProjects(this.actor).find(project => project.id === id) ?? null;
	}

	static async #onPlace(event, target) {
		const item = this.actor.items.get(target.closest("[data-item-id]")?.dataset.itemId);
		if (item) {
			await this.#place(item, { all: event.shiftKey });
		}
	}

	/** Takes one unit back out (Shift: all of that material). */
	static #onUnplace(event, target) {
		const id = target.closest("[data-item-id]")?.dataset.itemId;
		const units = event.shiftKey ? 0 : (this.placed.get(id) ?? 0) - 1;
		if (units > 0) {
			this.placed.set(id, units);
		} else {
			this.placed.delete(id);
		}
		this.render();
	}

	static #onClearPlaced() {
		this.placed.clear();
		this.render();
	}

	/** GM: a project learnt like a spell (materials, paper, roll, progress) that grants no card; opens for editing. */
	static async #onAddProject() {
		if (!game.user.isGM) {
			return;
		}
		this.editing.add(await createCustomProject(this.actor));
		this.tab = "active";
		this.render();
	}

	/**
	 * GM: gives a project its own table, filled with the numbers it has now (from its level), or takes it away so the
	 * level's numbers apply again.
	 */
	static async #onToggleTable(event, target) {
		const project = this.#projectFrom(target);
		if (!game.user.isGM || !project) {
			return;
		}
		if (target.checked) {
			const rows = outcomeTable(project);
			const outcomes = Object.fromEntries(OUTCOMES.map(outcome => [outcome, {
				gain: rows[outcome].gain, silver: rows[outcome].silver, paper: rows[outcome].paper
			}]));
			await saveProject(this.actor, project.id, {
				table: { needed: getNeeded(project), difficulty: getDifficulty(project, true), outcomes }
			});
		} else {
			await this.actor.update({ [`flags.${MODULE_ID}.projects.${project.id}.-=table`]: null });
		}
		await settleStudy(this.actor, project.id);
	}

	static #onPickImage(event, target) {
		const project = this.#projectFrom(target);
		if (!game.user.isGM || !project) {
			return;
		}
		const FilePicker = foundry.applications.apps.FilePicker.implementation;
		new FilePicker({
			type: "image",
			current: project.img || DEFAULT_PROJECT_IMG,
			callback: path => saveProject(this.actor, project.id, { img: path })
		}).browse();
	}

	static async #onToggleEnabled(event, target) {
		if (game.user.isGM) {
			await setLearnEnabled(this.actor, target.checked);
		}
	}

	static async #onStart(event, target) {
		const item = this.actor.items.get(target.closest("[data-book-id]")?.dataset.bookId);
		if (!item || !this.actor.isOwner) {
			return;
		}
		await createProject(this.actor, getBookSpells(item), item);
	}

	static #onSwitchTab(event, target) {
		const tab = target.dataset.tab;
		if (tab && tab !== this.tab) {
			this.tab = tab;
			this.render();
		}
	}

	static #onToggleEdit(event, target) {
		const id = target.closest("[data-project-id]")?.dataset.projectId;
		if (!game.user.isGM || !id) {
			return;
		}
		if (this.editing.has(id)) {
			this.editing.delete(id);
		} else {
			this.editing.add(id);
		}
		this.render();
	}

	static async #onOpenCard(event, target) {
		const card = await fromUuid(target.dataset.uuid);
		card?.sheet?.render(true);
	}

	static async #onRemove(event, target) {
		const project = this.#projectFrom(target);
		// A player may drop a spell not yet started; the GM's own projects only the GM removes.
		const playerMay = this.actor.isOwner && !project?.project && !project?.progress && !project?.completed;
		if (!project || !(game.user.isGM || playerMay)) {
			return;
		}
		const confirmed = await DialogV2.confirm({
			window: { title: "MIST_SPELL.RemoveTitle" },
			content: `<p>${game.i18n.format("MIST_SPELL.RemoveConfirm", { name: foundry.utils.escapeHTML(project.name) })}</p>`
		});
		if (confirmed) {
			this.editing.delete(project.id);
			await deleteProject(this.actor, project.id);
		}
	}

	static async #onReopen(event, target) {
		const project = this.#projectFrom(target);
		if (game.user.isGM && project) {
			await saveProject(this.actor, project.id, { completed: false, progress: 0 });
		}
	}

	static async #onRoll(event, target) {
		const project = this.#projectFrom(target);
		if (!project || project.completed || this.busy || !this.actor.isOwner) {
			return;
		}
		this.busy = true;
		this.render();
		try {
			const outcome = await study(this.actor, project, this.placed);
			// The attempt was made: what was put in is spent or stays in the inventory.
			if (outcome) {
				this.placed.clear();
			}
		} catch (error) {
			console.error(`${MODULE_ID} | Study failed`, error);
			ui.notifications.error("MIST_SPELL.Failed", { localize: true });
		} finally {
			this.busy = false;
			this.render();
		}
	}
}
