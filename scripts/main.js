import { MODULE_ID, canLearn, getProjects, registerSettings } from "./data.js";
import { LearnSpellWindow } from "./learn-window.js";
import { SpellLibrary } from "./library.js";
import { SpellHub } from "./hub.js";
import { study } from "./study.js";

/** Who sees the spell learning of a character: the GM always, the owner when the character can learn spells. */
function canOpen(actor) {
	return game.user.isGM || (actor.isOwner && canLearn(actor));
}

/** A wand next to the rest buttons (and the alchemy flask) on a character sheet opens the spell learning. */
function addSheetButton(sheet, element) {
	const actor = sheet.document;
	if (actor?.type !== "character") {
		return;
	}
	const section = element.querySelector(".downtime-section");
	if (!section) {
		return;
	}
	const existing = section.querySelector(".mist-spell-sheet-button");
	if (!canOpen(actor)) {
		existing?.remove();
		return;
	}
	if (existing) {
		return;
	}
	const button = document.createElement("button");
	button.type = "button";
	button.classList.add("mist-spell-sheet-button");
	button.dataset.tooltip = game.i18n.localize("MIST_SPELL.Button");
	button.innerHTML = '<i class="fa-solid fa-fw fa-wand-sparkles" inert></i>';
	button.addEventListener("click", event => {
		event.preventDefault();
		event.stopPropagation();
		LearnSpellWindow.show(actor);
	});
	// Right after the alchemy flask when it is there, else at the end.
	const flask = section.querySelector(".mist-alchemy-sheet-button");
	if (flask) {
		flask.after(button);
	} else {
		section.append(button);
	}
}

/** The same entry in a character sheet's header menu. */
function addHeaderControls(app, controls) {
	const actor = app.document;
	if (actor?.documentName !== "Actor" || actor.type !== "character" || !canOpen(actor)) {
		return;
	}
	controls.unshift({
		icon: "fa-solid fa-wand-sparkles",
		label: "MIST_SPELL.Button",
		action: `${MODULE_ID}-learn`,
		onClick: () => LearnSpellWindow.show(actor)
	});
}

/** The settings menu button: opens the one spell library instead of a new window per click. */
class SpellLibraryMenu extends foundry.applications.api.ApplicationV2 {
	async render() {
		return SpellLibrary.show();
	}
}

/**
 * GM: a button in the Actors sidebar header, next to the alchemy one, opens the spell learning panel of all player
 * characters (its own button reaches the spell library).
 */
function addDirectoryButton(app, element) {
	if (!game.user.isGM) {
		return;
	}
	const root = element instanceof HTMLElement ? element : element?.[0];
	const actions = root?.querySelector(".header-actions");
	if (!actions || actions.querySelector(".mist-spell-hub-button")) {
		return;
	}
	const button = document.createElement("button");
	button.type = "button";
	button.classList.add("mist-spell-hub-button");
	button.innerHTML = `<i class="fa-solid fa-wand-sparkles" inert></i> ${game.i18n.localize("MIST_SPELL.Hub.Button")}`;
	button.addEventListener("click", event => {
		event.preventDefault();
		SpellHub.show();
	});
	actions.append(button);
}

function defaultActor() {
	return canvas.tokens?.controlled[0]?.actor ?? game.user.character ?? null;
}

Hooks.once("init", () => {
	registerSettings();
	game.settings.registerMenu(MODULE_ID, "library", {
		name: "MIST_SPELL.Library.Title",
		label: "MIST_SPELL.Library.Button",
		hint: "MIST_SPELL.Library.MenuHint",
		icon: "fa-solid fa-book-journal-whills",
		type: SpellLibraryMenu,
		restricted: true
	});
	foundry.applications.handlebars.loadTemplates([
		`modules/${MODULE_ID}/templates/learn.hbs`,
		`modules/${MODULE_ID}/templates/library.hbs`,
		`modules/${MODULE_ID}/templates/hub.hbs`
	]);
});

Hooks.once("ready", () => {
	game.modules.get(MODULE_ID).api = {
		/** Opens a character's spell learning (default: the selected token's or the user's character). */
		show: (actor = defaultActor()) => LearnSpellWindow.show(actor),
		/** GM: the spell library (books, materials, paper). */
		library: () => SpellLibrary.show(),
		/** GM: the spell learning panel of all player characters. */
		hub: () => SpellHub.show(),
		/** One attempt on a project by id. */
		study: (actor, projectId, placed = new Map()) => {
			const project = getProjects(actor).find(entry => entry.id === projectId);
			return project ? study(actor, project, placed) : null;
		},
		projects: actor => getProjects(actor)
	};
});

Hooks.on("renderActorSheetV2", addSheetButton);
Hooks.on("getHeaderControlsActorSheetV2", addHeaderControls);
Hooks.on("renderActorDirectory", addDirectoryButton);
