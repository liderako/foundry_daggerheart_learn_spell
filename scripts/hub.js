import {
	MODULE_ID, canLearn, countPaper, formatMoney, getBooks, getMaterials, getProjects, materialValue, quantityOf,
	setLearnEnabled
} from "./data.js";
import { LearnSpellWindow } from "./learn-window.js";
import { SpellLibrary } from "./library.js";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * The GM's spell learning panel, like the alchemy one: every player character in one list, with spell learning on
 * or off, what they are learning and have learnt, their books, materials and paper, and buttons to their Learn
 * Spell window and sheet.
 */
export class SpellHub extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: `${MODULE_ID}-hub`,
		classes: ["mist-spell", "mist-spell-hub"],
		window: { title: "MIST_SPELL.Hub.Title", icon: "fa-solid fa-wand-sparkles", resizable: true },
		position: { width: 640, height: "auto" },
		actions: {
			openLibrary: () => SpellLibrary.show(),
			openLearn: SpellHub.#onOpenLearn,
			openSheet: SpellHub.#onOpenSheet
		}
	};

	static PARTS = {
		body: { template: `modules/${MODULE_ID}/templates/hub.hbs` }
	};

	static #instance = null;

	static show() {
		if (!game.user.isGM) {
			return null;
		}
		SpellHub.#instance ??= new SpellHub();
		SpellHub.#instance.render({ force: true });
		return SpellHub.#instance;
	}

	/** Player characters, and any other character with spell learning turned on. */
	static #characters() {
		return game.actors
			.filter(actor => actor.type === "character" && (actor.hasPlayerOwner || canLearn(actor)))
			.sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang));
	}

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.characters = SpellHub.#characters().map(actor => {
			const projects = getProjects(actor);
			const active = projects.filter(project => !project.completed).length;
			const materials = getMaterials(actor).reduce((sum, item) => sum + quantityOf(item) * materialValue(item), 0);
			return {
				id: actor.id,
				name: actor.name,
				img: actor.img,
				enabled: canLearn(actor),
				active,
				learnt: projects.length - active,
				books: getBooks(actor).length,
				materials: materials ? formatMoney(materials) : "—",
				paper: countPaper(actor)
			};
		});
		return context;
	}

	async _onRender(context, options) {
		await super._onRender(context, options);
		for (const input of this.element.querySelectorAll("input[data-enable]")) {
			input.addEventListener("change", () => {
				const actor = game.actors.get(input.dataset.enable);
				if (actor) {
					setLearnEnabled(actor, input.checked);
				}
			});
		}
	}

	_onFirstRender(context, options) {
		super._onFirstRender(context, options);
		const refresh = () => {
			if (this.rendered) {
				this.render();
			}
		};
		const ofCharacter = document => {
			const actor = document.documentName === "Actor" ? document : document.parent;
			if (actor?.documentName === "Actor" && actor.type === "character") {
				refresh();
			}
		};
		this._hooks = [
			[`${MODULE_ID}.libraryChanged`, Hooks.on(`${MODULE_ID}.libraryChanged`, refresh)],
			["updateActor", Hooks.on("updateActor", ofCharacter)],
			["createItem", Hooks.on("createItem", ofCharacter)],
			["updateItem", Hooks.on("updateItem", ofCharacter)],
			["deleteItem", Hooks.on("deleteItem", ofCharacter)],
			["createActor", Hooks.on("createActor", refresh)],
			["deleteActor", Hooks.on("deleteActor", refresh)]
		];
	}

	_onClose(options) {
		super._onClose(options);
		for (const [hook, id] of this._hooks ?? []) {
			Hooks.off(hook, id);
		}
		this._hooks = null;
	}

	static #actorFrom(target) {
		return game.actors.get(target.closest("[data-actor-id]")?.dataset.actorId);
	}

	static #onOpenLearn(event, target) {
		LearnSpellWindow.show(SpellHub.#actorFrom(target));
	}

	static #onOpenSheet(event, target) {
		SpellHub.#actorFrom(target)?.sheet?.render(true);
	}
}
