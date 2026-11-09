import {
	DEFAULT_IMG, MODULE_ID, canLearn, countPaper, formatMoney, freeMaterials, getBaseCost, getDifficulty, getLevel,
	getNeeded, getTrait, loadCards, materialValue, outcomeTable, pickUnits, quantityOf, saveProject, spendPaper,
	spendUnits, tierOf, unitsValue
} from "./data.js";

const { DialogV2 } = foundry.applications.api;

function outcomeOf(roll) {
	if (roll.isCritical) {
		return "critical";
	}
	const hope = roll.result?.duality === 1;
	if (roll.success) {
		return hope ? "successHope" : "successFear";
	}
	return hope ? "failureHope" : "failureFear";
}

/** The book a project is learnt from, when it still is in the inventory; null for a spell the GM gave. */
export function sourceOf(actor, project) {
	return project.source ? actor.items.get(project.source) ?? null : null;
}

/**
 * What a project needs right now: numbers for the window and whether an attempt can be made with the materials the
 * player put in (item id → units).
 */
export function studyState(actor, project, placed = new Map()) {
	const paper = countPaper(actor);
	const cost = getBaseCost(project);
	const materials = unitsValue(actor, placed);
	const missingBook = !!project.source && !sourceOf(actor, project);
	const level = getLevel(project);
	return {
		level,
		tier: tierOf(level),
		needed: getNeeded(project),
		progress: Math.min(Number(project.progress) || 0, getNeeded(project)),
		difficulty: getDifficulty(project, paper > 0),
		paper,
		cost,
		costText: formatMoney(cost),
		materials,
		materialsText: formatMoney(materials),
		enoughMaterials: materials >= cost,
		missingBook,
		ready: canLearn(actor) && !project.completed && !missingBook && materials >= cost
	};
}

/** Adds the learnt spells as domain cards: into the loadout while there is room, else into the vault. */
export async function grantCards(actor, uuids) {
	const cards = await loadCards(uuids);
	const owned = new Set(actor.items.filter(item => item.type === "domainCard").map(item => item.name));
	const created = [];
	for (const card of cards) {
		if (owned.has(card.name)) {
			continue;
		}
		const data = card.toObject();
		delete data._id;
		data.system.inVault = !actor.system.loadoutSlot?.available;
		foundry.utils.setProperty(data, "_stats.compendiumSource", card.uuid);
		const [item] = await actor.createEmbeddedDocuments("Item", [data]);
		if (item) {
			created.push(item);
		}
		owned.add(card.name);
	}
	return created;
}

/**
 * Asks the player which more materials to spend when the outcome made the attempt cost more than they put in.
 * Every free material is listed with a number, pre-filled with the cheapest that cover the rest. Resolves to
 * item id → units (empty when cancelled or nothing is left).
 */
async function askExtra(actor, placed, short) {
	const pool = freeMaterials(actor, placed);
	if (!pool.size) {
		return new Map();
	}
	const suggested = pickUnits(actor, pool, short);
	const escape = foundry.utils.escapeHTML;
	const rows = [...pool].map(([itemId, left]) => {
		const item = actor.items.get(itemId);
		return `
			<label class="mist-spell-extra-row">
				<img src="${escape(item.img)}" alt=""> <span>${escape(item.name)}</span>
				<span class="hint">${formatMoney(materialValue(item))} · ${game.i18n.format("MIST_SPELL.Materials.Have", { count: left })}</span>
				<input type="number" name="${itemId}" value="${suggested.get(itemId) ?? 0}" min="0" max="${left}" step="1">
			</label>`;
	}).join("");
	const chosen = await DialogV2.prompt({
		window: { title: "MIST_SPELL.Materials.ExtraTitle" },
		content: `<div class="mist-spell-extra"><p>${game.i18n.format("MIST_SPELL.Materials.ExtraQuestion", { value: formatMoney(short) })}</p>${rows}</div>`,
		ok: {
			label: "MIST_SPELL.Materials.ExtraOk",
			icon: "fa-solid fa-check",
			callback: (event, button) => {
				const units = new Map();
				for (const [itemId, left] of pool) {
					const count = Math.min(left, Math.max(0, Math.floor(Number(button.form.elements[itemId]?.value) || 0)));
					if (count > 0) {
						units.set(itemId, count);
					}
				}
				return units;
			}
		},
		rejectClose: false
	});
	return chosen instanceof Map ? chosen : new Map();
}

/**
 * After the GM changed a study by hand (its progress, level, progress needed or own table): when the progress now
 * reaches what it needs, the study is learnt like after a roll (it moves to the learnt tab, a spell's cards are
 * added); when the GM lowered the progress of a learnt one below that, it is active again.
 */
export async function settleStudy(actor, projectId) {
	const project = actor.getFlag(MODULE_ID, "projects")?.[projectId];
	if (!project) {
		return;
	}
	const full = { id: projectId, ...project, cards: project.cards ?? [] };
	const needed = getNeeded(full);
	const done = (Number(full.progress) || 0) >= needed;
	if (done === !!full.completed) {
		return;
	}
	await saveProject(actor, projectId, { completed: done });
	if (!done) {
		return;
	}
	const granted = full.project ? [] : await grantCards(actor, full.cards);
	const escape = foundry.utils.escapeHTML;
	const i18n = game.i18n;
	let text;
	if (full.project) {
		text = i18n.format("MIST_SPELL.Chat.ProjectDone", { actor: escape(actor.name), name: escape(full.name) });
	} else if (granted.length) {
		text = i18n.format("MIST_SPELL.Chat.Learnt", { actor: escape(actor.name), spells: granted.map(card => escape(card.name)).join(", ") });
	} else {
		text = i18n.format("MIST_SPELL.Chat.LearntNothingNew", { actor: escape(actor.name), name: escape(full.name) });
	}
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		content: `<div class="mist-spell-chat critical"><header><img src="${escape(full.img || DEFAULT_IMG)}" alt=""><div><h3>${i18n.format("MIST_SPELL.Chat.Title", { name: escape(full.name) })}</h3></div></header><p>${text}</p></div>`
	});
}

/**
 * One attempt: the player puts in materials worth at least the usual price (and has the book, when learnt from one).
 * The action roll with their spellcasting trait goes against the difficulty, +2 without paper. Then the outcome's row
 * of the table sets the progress, the materials and the paper: a cheaper outcome takes only part of what was put in
 * (the cheapest first), a dearer one takes all of it and asks the player what else to add. Once the progress is
 * reached the spells are added as domain cards (a project grants none). Returns the outcome, or null when nothing
 * happened.
 */
export async function study(actor, project, placed = new Map()) {
	const i18n = game.i18n;
	if (!canLearn(actor)) {
		ui.notifications.warn("MIST_SPELL.Disabled", { localize: true });
		return null;
	}
	const before = studyState(actor, project, placed);
	if (before.missingBook) {
		ui.notifications.warn(i18n.localize("MIST_SPELL.MissingBook"));
		return null;
	}
	if (!before.enoughMaterials) {
		ui.notifications.warn(i18n.format("MIST_SPELL.NoMaterials", { cost: before.costText, value: before.materialsText }));
		return null;
	}
	const trait = getTrait(actor);
	const result = await actor.rollTrait(trait, {
		title: i18n.format("MIST_SPELL.RollTitle", { name: project.name }),
		headerTitle: i18n.format("MIST_SPELL.RollHeader", { actor: actor.name }),
		roll: { trait, type: "trait", difficulty: before.difficulty }
	});
	if (!result) {
		return null;
	}
	const costs = result.costs?.filter(cost => cost.enabled).map(cost => ({ ...cost, value: -cost.value })) ?? [];
	result.resourceUpdates?.addResources(costs);
	await result.resourceUpdates?.updateResources();
	await freeActions()?.spend(actor, i18n.format("MIST_SPELL.SpendReason", { name: project.name }));

	const outcome = outcomeOf(result.roll);
	const row = outcomeTable(project)[outcome];

	// Materials: the outcome's price, out of what the player put in; whatever is short is noted.
	const materialsDue = row.cost;
	const put = new Map([...placed].filter(([itemId]) => actor.items.get(itemId)).map(([itemId, count]) => [itemId, Math.min(count, quantityOf(actor.items.get(itemId)))]));
	let use = pickUnits(actor, put, materialsDue);
	const short = materialsDue - unitsValue(actor, use);
	if (short > 0) {
		const extra = await askExtra(actor, put, short);
		use = new Map(put);
		for (const [itemId, count] of extra) {
			use.set(itemId, (use.get(itemId) ?? 0) + count);
		}
	}
	const materials = await spendUnits(actor, use);

	// Paper: the outcome's formula, as much as there is.
	// A formula the GM mistyped counts as no paper rather than breaking the attempt.
	const paperFormula = globalThis.Roll?.validate?.(row.paper) === false ? "0" : row.paper;
	const paperRoll = before.paper > 0 ? await new Roll(paperFormula).evaluate() : null;
	const paperDue = paperRoll ? Math.max(0, Math.round(paperRoll.total)) : 0;
	const paperSpent = paperDue ? await spendPaper(actor, paperDue) : 0;

	const gain = row.gain;
	const progress = Math.max(0, (Number(project.progress) || 0) + gain);
	const learnt = progress >= before.needed;
	await saveProject(actor, project.id, { progress: Math.min(progress, before.needed), completed: learnt });
	const granted = learnt && !project.project ? await grantCards(actor, project.cards) : [];

	const escape = foundry.utils.escapeHTML;
	const spentText = materials.spent.map(entry => `${escape(entry.name)} ×${entry.count}`).join(", ") || "—";
	const lines = [
		i18n.format("MIST_SPELL.Chat.Materials", { items: spentText, value: formatMoney(materials.value) }),
		before.paper > 0
			? i18n.format("MIST_SPELL.Chat.Paper", { count: paperSpent, roll: `${row.paper} = ${paperRoll.total}` })
			: i18n.localize("MIST_SPELL.Chat.NoPaper")
	];
	if (materials.value < materialsDue) {
		lines.push(i18n.format("MIST_SPELL.Chat.MaterialsShort", { value: formatMoney(materialsDue - materials.value) }));
	}
	if (paperSpent < paperDue) {
		lines.push(i18n.format("MIST_SPELL.Chat.PaperShort", { count: paperDue - paperSpent }));
	}
	let learntText;
	if (project.project) {
		learntText = i18n.format("MIST_SPELL.Chat.ProjectDone", { actor: escape(actor.name), name: escape(project.name) });
	} else if (granted.length) {
		learntText = i18n.format("MIST_SPELL.Chat.Learnt", { actor: escape(actor.name), spells: granted.map(card => escape(card.name)).join(", ") });
	} else {
		learntText = i18n.format("MIST_SPELL.Chat.LearntNothingNew", { actor: escape(actor.name), name: escape(project.name) });
	}
	await ChatMessage.create({
		speaker: ChatMessage.getSpeaker({ actor }),
		content: `
			<div class="mist-spell-chat ${outcome}">
				<header>
					<img src="${escape(project.img || DEFAULT_IMG)}" alt="">
					<div>
						<h3>${i18n.format("MIST_SPELL.Chat.Title", { name: escape(project.name) })}</h3>
						<span>${i18n.format("MIST_SPELL.DifficultyValue", { difficulty: before.difficulty })}${before.paper > 0 ? "" : ` (${i18n.localize("MIST_SPELL.NoPaperShort")})`}</span>
					</div>
				</header>
				<p class="mist-spell-outcome">${i18n.localize(`MIST_SPELL.Outcome.${outcome}`)}: ${gain > 0 ? `+${gain}` : gain}</p>
				<p>${learnt ? learntText : i18n.format("MIST_SPELL.ProgressValue", { progress: Math.max(0, before.needed - progress), needed: before.needed })}</p>
				<p class="mist-spell-spent">${lines.join("<br>")}</p>
			</div>`
	});
	return outcome;
}

/** The Mist Age - Free Actions, when it is active: every downtime roll spends one free action (none at 0). */
export function freeActions() {
	const module = game.modules.get("mist-age-free-actions");
	return module?.active ? module.api ?? null : null;
}

/** "Free actions: 19" for the roll buttons, or null without the module. */
export function freeActionsLine(actor) {
	const api = freeActions();
	return api ? game.i18n.format("MIST_FREE.Line", { count: api.get(actor) }) : null;
}
