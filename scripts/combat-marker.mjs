import { MODULE, LETTERS, FLAGS, log } from './const.mjs';
import { Settings } from './settings.mjs';
import { IconGenerator } from './icon-generator.mjs';

const SUFFIX_PATTERN = /^(.*) \[([A-Z])\]$/;

/**
 * Core logic for automatically renaming NPC tokens in combat with
 * alphabetical suffixes and applying color-coded active effects.
 *
 * All document writes for a processing pass are collected into a "plan" and committed
 * in as few database operations as possible (one Token update per scene, one Combatant
 * update per combat, and parallel per-actor effect writes). This avoids a long chain of
 * sequential round trips, each of which re-renders the combat tracker and refreshes tokens
 * on every connected client.
 */
export class CombatMarker {

  /** Pending debounce timers per combat ID. */
  static _pendingCombats = new Map();

  /** Processing lock — prevents re-entrant processing for the same combat. */
  static _processingLock = new Set();

  /** Combats that were requested again while being processed, and need another pass. */
  static _rerunRequested = new Set();

  /**
   * Register all combat-related hooks.
   */
  static registerHooks() {
    Hooks.on('createCombatant', this._onCreateCombatant.bind(this));
    Hooks.on('deleteCombatant', this._onDeleteCombatant.bind(this));
    Hooks.on('deleteCombat', this._onDeleteCombat.bind(this));
    log('Combat hooks registered.');
  }

  // ---------------------------------------------------------------------------
  // Hook Handlers
  // ---------------------------------------------------------------------------

  /**
   * When a combatant is added, debounce processing to avoid race conditions
   * when multiple combatants are added simultaneously.
   * @param {Combatant} combatant
   * @param {object} options
   * @param {string} userId
   */
  static _onCreateCombatant(combatant, options, userId) {
    if (!this._isResponsibleGM()) return;
    if (!game.settings.get(MODULE, Settings.ENABLED)) return;
    if (!this._isNPC(combatant)) return;

    const combat = combatant.combat;
    if (!combat) return;

    // Clear any existing debounce timer for this combat
    if (this._pendingCombats.has(combat.id)) {
      clearTimeout(this._pendingCombats.get(combat.id));
    }

    // Debounce: wait for all combatants to be added before processing
    this._pendingCombats.set(combat.id, setTimeout(() => {
      this._pendingCombats.delete(combat.id);
      this._processAllGroups(combat);
    }, 200));
  }

  /**
   * When a combatant is removed, handle the remaining enemy group(s).
   * If only one enemy NPC token remains in the combat, remove its suffix and effect.
   * If more than one remain, leave their existing suffixes intact (stable ordering),
   * unless includeSingletons is false and only one remains for that specific actor.
   * @param {Combatant} combatant
   * @param {object} options
   * @param {string} userId
   */
  static async _onDeleteCombatant(combatant, options, userId) {
    if (!this._isResponsibleGM()) return;
    if (!game.settings.get(MODULE, Settings.ENABLED)) return;
    if (!this._isNPC(combatant)) return;

    const combat = combatant.combat;
    if (!combat) return;

    // Remaining enemy NPCs in combat (excluding the deleted combatant)
    const remainingEnemyNPCs = combat.combatants.filter(
      c => c.id !== combatant.id && this._isEnemyNPC(c)
    );

    const plan = this._createPlan();

    // If only one (or zero) enemy NPC token remains in the combat, don't assign tags
    if (remainingEnemyNPCs.length <= 1) {
      for (const remaining of remainingEnemyNPCs) {
        this._planRemoveSuffix(plan, remaining);
      }
      await this._commitPlan(combat, plan);
      return;
    }

    const actorId = combatant.actorId;
    if (!actorId) return;

    // Get remaining combatants with the same actor (excluding the deleted one)
    const remainingForActor = remainingEnemyNPCs.filter(c => c.actorId === actorId);

    const includeSingletons = game.settings.get(MODULE, Settings.INCLUDE_SINGLETONS);

    if (remainingForActor.length === 1 && !includeSingletons) {
      // Only one left of this type, and we don't letter singletons
      this._planRemoveSuffix(plan, remainingForActor[0]);
      await this._commitPlan(combat, plan);
    }
    // If 2+ remain, keep their existing suffixes for stability (no re-lettering mid-combat)
  }

  /**
   * When combat is deleted, optionally restore all original token names and remove effects.
   * The combat and its combatants are already deleted from the DB at this point,
   * so we only update tokens and actors directly (not the combatant documents).
   * @param {Combat} combat
   * @param {object} options
   * @param {string} userId
   */
  static async _onDeleteCombat(combat, options, userId) {
    if (!this._isResponsibleGM()) return;
    if (!game.settings.get(MODULE, Settings.ENABLED)) return;
    if (!game.settings.get(MODULE, Settings.RESTORE_ON_COMBAT_END)) return;

    const plan = this._createPlan();
    for (const combatant of combat.combatants) {
      if (!this._isNPC(combatant)) continue;
      const originalName = combatant.getFlag(MODULE, FLAGS.ORIGINAL_NAME);
      if (!originalName) continue;

      // Restore original token name directly (combat/combatant is already deleted)
      this._planTokenUpdate(plan, combatant.token, { name: originalName });

      // Remove letter effects from actor directly
      this._planEffect(plan, combatant.actor, null);
    }

    await this._commitPlan(null, plan);
    log('Combat ended — restored original token names.');
  }

  // ---------------------------------------------------------------------------
  // Group Processing
  // ---------------------------------------------------------------------------

  /**
   * Process all NPC actor groups in a combat, assigning suffixes where needed.
   * Uses a processing lock to prevent re-entrant execution. A request that arrives while
   * the combat is being processed schedules one more pass once the current one finishes.
   * @param {Combat} combat
   */
  static async _processAllGroups(combat) {
    if (this._processingLock.has(combat.id)) {
      log(`Already processing combat ${combat.id} — queuing another pass.`);
      this._rerunRequested.add(combat.id);
      return;
    }
    this._processingLock.add(combat.id);

    try {
      const isGlobal = game.settings.get(MODULE, Settings.UNIQUE_LETTERS);
      const includeSingletons = game.settings.get(MODULE, Settings.INCLUDE_SINGLETONS);

      const enemyNPCs = this._getEnemyNPCs(combat);
      const plan = this._createPlan();

      // When there is only one (or zero) enemy NPC token in the combat, don't assign tags
      if (enemyNPCs.length <= 1) {
        log(`Only ${enemyNPCs.length} enemy NPC token(s) in combat — skipping tag assignment and clearing existing tags.`);
        for (const combatant of combat.combatants) {
          if (combatant.getFlag(MODULE, FLAGS.ORIGINAL_NAME) || combatant.getFlag(MODULE, FLAGS.COMBAT_LETTER)) {
            this._planRemoveSuffix(plan, combatant);
          }
        }
        await this._commitPlan(combat, plan);
        return;
      }

      // Group all enemy NPC combatants by actorId
      const actorGroups = new Map();
      for (const combatant of enemyNPCs) {
        const actorId = combatant.actorId;
        if (!actorId) continue;
        if (!actorGroups.has(actorId)) actorGroups.set(actorId, []);
        actorGroups.get(actorId).push(combatant);
      }

      const groupsToProcess = [];

      for (const group of actorGroups.values()) {
        if (group.length === 1 && !includeSingletons) {
          this._planRemoveSuffix(plan, group[0]);
        } else if (group.length > 0) {
          groupsToProcess.push(group);
        }
      }

      if (isGlobal) {
        const allNpcsToProcess = groupsToProcess.flat();
        if (allNpcsToProcess.length > 0) {
          this._planGroupSuffixes(plan, allNpcsToProcess);
        }
      } else {
        for (const group of groupsToProcess) {
          this._planGroupSuffixes(plan, group);
        }
      }

      await this._commitPlan(combat, plan);
    } catch (error) {
      console.error(`${MODULE} | Error processing combat groups:`, error);
    } finally {
      this._processingLock.delete(combat.id);
      if (this._rerunRequested.delete(combat.id) && game.combats.has(combat.id)) {
        this._processAllGroups(combat);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Suffix Management
  // ---------------------------------------------------------------------------

  /**
   * Plan suffix assignment for a group of combatants sharing a letter sequence.
   * @param {object} plan
   * @param {Combatant[]} group
   */
  static _planGroupSuffixes(plan, group) {
    const usedLetters = new Set();
    const unassigned = [];

    // First pass: identify tokens that already have a letter suffix or flag
    for (const combatant of group) {
      const tokenDoc = combatant.token;
      if (!tokenDoc) continue;

      const nameMatch = tokenDoc.name.match(SUFFIX_PATTERN);

      if (nameMatch) {
        // Token has a letter suffix in its name
        const baseName = nameMatch[1];
        const letter = nameMatch[2];
        usedLetters.add(letter);

        const flagLetter = combatant.getFlag(MODULE, FLAGS.COMBAT_LETTER);
        const originalName = combatant.getFlag(MODULE, FLAGS.ORIGINAL_NAME);

        // Update flags if they don't match the current name suffix
        if (flagLetter !== letter || originalName !== baseName) {
          plan.combatantUpdates.push({
            _id: combatant.id,
            [`flags.${MODULE}.${FLAGS.ORIGINAL_NAME}`]: baseName,
            [`flags.${MODULE}.${FLAGS.COMBAT_LETTER}`]: letter,
          });
        }

        // Check if the actor has the correct active effect and no mismatched ones
        const actor = combatant.actor;
        if (actor) {
          const effects = this._getLetterEffects(actor);
          const hasCorrectEffect = effects.some(e => e.getFlag(MODULE, FLAGS.COMBAT_LETTER) === letter);
          const hasMismatchingEffect = effects.some(e => e.getFlag(MODULE, FLAGS.COMBAT_LETTER) !== letter);

          if (!hasCorrectEffect || hasMismatchingEffect) {
            this._planEffect(plan, actor, letter);
          }
        }
      } else {
        const flagLetter = combatant.getFlag(MODULE, FLAGS.COMBAT_LETTER);
        if (flagLetter) {
          usedLetters.add(flagLetter);
        } else {
          unassigned.push(combatant);
        }
      }
    }

    if (unassigned.length === 0) return;

    // Sort unassigned combatants by Actor Name (to group same types together),
    // then by ID (proxy for creation order) for stable assignment
    unassigned.sort((a, b) => {
      const nameA = a.actor?.name || '';
      const nameB = b.actor?.name || '';
      if (nameA !== nameB) {
        return nameA.localeCompare(nameB);
      }
      return a.id.localeCompare(b.id);
    });

    // Assign letters sequentially, skipping already-used ones, wrapping at Z
    let letterIndex = 0;
    for (const combatant of unassigned) {
      // Find the next unused letter
      while (usedLetters.has(LETTERS[letterIndex % LETTERS.length])) {
        letterIndex++;
        // Safety: if we've wrapped around completely, just start double-assigning
        if (letterIndex >= LETTERS.length * 2) break;
      }
      const letter = LETTERS[letterIndex % LETTERS.length];
      usedLetters.add(letter);
      letterIndex++;

      this._planAssignSuffix(plan, combatant, letter);
    }
  }

  /**
   * Plan assigning a letter suffix to a combatant: rename the token and combatant, and apply the effect.
   * @param {object} plan
   * @param {Combatant} combatant
   * @param {string} letter
   */
  static _planAssignSuffix(plan, combatant, letter) {
    const tokenDoc = combatant.token;
    if (!tokenDoc) return;

    // Store the original name if not already stored
    const existingOriginal = combatant.getFlag(MODULE, FLAGS.ORIGINAL_NAME);
    const baseName = existingOriginal ?? tokenDoc.name;
    const newName = `${baseName} [${letter}]`;

    log(`Assigning suffix "${letter}" to "${baseName}" → "${newName}"`);

    this._planTokenUpdate(plan, tokenDoc, { name: newName });
    plan.combatantUpdates.push({
      _id: combatant.id,
      name: newName,
      [`flags.${MODULE}.${FLAGS.ORIGINAL_NAME}`]: baseName,
      [`flags.${MODULE}.${FLAGS.COMBAT_LETTER}`]: letter,
    });
    this._planEffect(plan, combatant.actor, letter);
  }

  /**
   * Plan removing the letter suffix from a combatant and restoring its original name.
   * @param {object} plan
   * @param {Combatant} combatant
   */
  static _planRemoveSuffix(plan, combatant) {
    let originalName = combatant.getFlag(MODULE, FLAGS.ORIGINAL_NAME);
    if (!originalName) {
      const match = combatant.name?.match(SUFFIX_PATTERN) ?? combatant.token?.name?.match(SUFFIX_PATTERN);
      if (match) {
        originalName = match[1];
      }
    }

    if (originalName) {
      log(`Removing suffix from "${combatant.name}" → "${originalName}"`);

      this._planTokenUpdate(plan, combatant.token, { name: originalName });
      plan.combatantUpdates.push({
        _id: combatant.id,
        name: originalName,
        [`flags.${MODULE}.-=${FLAGS.ORIGINAL_NAME}`]: null,
        [`flags.${MODULE}.-=${FLAGS.COMBAT_LETTER}`]: null,
      });
    }

    // Remove the active effect (no-op if the actor has none)
    if (combatant.actor && this._getLetterEffects(combatant.actor).length > 0) {
      this._planEffect(plan, combatant.actor, null);
    }
  }

  // ---------------------------------------------------------------------------
  // Batched Writes
  // ---------------------------------------------------------------------------

  /**
   * Create an empty write plan.
   * @returns {{ tokenUpdates: Map<Scene, object[]>, combatantUpdates: object[], effects: Map<string, {actor: Actor, letter: string|null}> }}
   */
  static _createPlan() {
    return {
      tokenUpdates: new Map(),
      combatantUpdates: [],
      effects: new Map(),
    };
  }

  /**
   * Queue a token update, grouped by parent scene.
   * @param {object} plan
   * @param {TokenDocument} tokenDoc
   * @param {object} changes
   */
  static _planTokenUpdate(plan, tokenDoc, changes) {
    const scene = tokenDoc?.parent;
    if (!scene) return;
    if (!plan.tokenUpdates.has(scene)) plan.tokenUpdates.set(scene, []);
    plan.tokenUpdates.get(scene).push({ _id: tokenDoc.id, ...changes });
  }

  /**
   * Queue the desired letter effect for an actor (null removes it).
   * Keyed by actor UUID so a linked actor shared by several tokens gets a single write.
   * @param {object} plan
   * @param {Actor} actor
   * @param {string|null} letter
   */
  static _planEffect(plan, actor, letter) {
    if (!actor) return;
    plan.effects.set(actor.uuid, { actor, letter });
  }

  /**
   * Commit a plan: token and combatant updates as single batched operations,
   * followed by per-actor effect writes in parallel.
   * @param {Combat|null} combat - Combat owning the combatant updates (null if none)
   * @param {object} plan
   */
  static async _commitPlan(combat, plan) {
    const writes = [];
    for (const [scene, updates] of plan.tokenUpdates) {
      writes.push(scene.updateEmbeddedDocuments('Token', updates).catch(e => {
        console.warn(`${MODULE} | Could not update token names:`, e);
      }));
    }
    if (combat && plan.combatantUpdates.length > 0) {
      writes.push(combat.updateEmbeddedDocuments('Combatant', plan.combatantUpdates).catch(e => {
        console.warn(`${MODULE} | Could not update combatants:`, e);
      }));
    }
    await Promise.all(writes);

    await Promise.all(Array.from(plan.effects.values(), ({ actor, letter }) => this._syncLetterEffect(actor, letter)));
  }

  // ---------------------------------------------------------------------------
  // Active Effect Management
  // ---------------------------------------------------------------------------

  /**
   * Get the token tag letter effects on an actor.
   * @param {Actor} actor
   * @returns {ActiveEffect[]}
   */
  static _getLetterEffects(actor) {
    return actor.effects.filter(e => e.getFlag(MODULE, FLAGS.COMBAT_LETTER));
  }

  /**
   * Ensure an actor carries exactly the letter effect for `letter` (or none if null).
   * An existing letter effect is updated in place rather than deleted and re-created.
   * Effects are written directly (not via toggleStatusEffect) so we can pass { animate: false }
   * and correctly suppress the scrolling text.
   * @param {Actor} actor
   * @param {string|null} letter
   */
  static async _syncLetterEffect(actor, letter) {
    const [existing, ...extra] = this._getLetterEffects(actor);

    try {
      if (!letter) {
        if (existing) {
          await actor.deleteEmbeddedDocuments('ActiveEffect', [existing.id, ...extra.map(e => e.id)], { animate: false });
        }
        return;
      }

      if (extra.length > 0) {
        await actor.deleteEmbeddedDocuments('ActiveEffect', extra.map(e => e.id), { animate: false });
      }

      const effectData = this._buildEffectData(letter);
      if (existing) {
        await existing.update(effectData, { animate: false });
      } else {
        await actor.createEmbeddedDocuments('ActiveEffect', [effectData], { animate: false });
      }
      log(`Applied letter effect "${letter}" to actor "${actor.name}" with icon "${effectData.img}"`);
    } catch (error) {
      console.error(`${MODULE} | Failed to sync status effect for letter "${letter}":`, error);
    }
  }

  /**
   * Build the ActiveEffect data for a letter.
   * @param {string} letter
   * @returns {object}
   */
  static _buildEffectData(letter) {
    const effectData = {
      name: letter,
      img: IconGenerator.getEffectIconPath(letter),
      statuses: [`${MODULE}.${letter}`],
      flags: {
        [MODULE]: {
          [FLAGS.COMBAT_LETTER]: letter
        }
      }
    };

    // V14+: Ensure the effect always displays on the token HUD even without a duration
    if (globalThis.CONST?.ACTIVE_EFFECT_SHOW_ICON) {
      effectData.showIcon = globalThis.CONST.ACTIVE_EFFECT_SHOW_ICON.ALWAYS ?? 2;
    }
    return effectData;
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Whether this client should perform document writes. With multiple GMs connected,
   * only the designated active GM processes combats so work isn't duplicated.
   * @returns {boolean}
   */
  static _isResponsibleGM() {
    if (!game.user.isGM) return false;
    const activeGM = game.users.activeGM;
    return activeGM ? activeGM.isSelf : true;
  }

  /**
   * Check if a combatant is an NPC.
   * Uses DnD5e-specific check first, falls back to system-agnostic check.
   * @param {Combatant} combatant
   * @returns {boolean}
   */
  static _isNPC(combatant) {
    const actor = combatant.actor;
    if (!actor) return false;

    // DnD5e
    if (game.system.id === 'dnd5e') {
      return actor.type === 'npc';
    }

    // PF2e
    if (game.system.id === 'pf2e') {
      return ['npc', 'hazard', 'vehicle'].includes(actor.type);
    }

    // Shadowdark
    if (game.system.id === 'shadowdark') {
      return ['npc', 'monster'].includes(actor.type?.toLowerCase());
    }

    // System-agnostic fallback: not player-owned
    return !combatant.hasPlayerOwner;
  }

  /**
   * Check if a combatant is an enemy NPC token.
   * Considers NPC status, ownership, and disposition.
   * @param {Combatant} combatant
   * @returns {boolean}
   */
  static _isEnemyNPC(combatant) {
    if (!this._isNPC(combatant)) return false;
    if (combatant.hasPlayerOwner) return false;
    const disposition = combatant.token?.disposition ?? combatant.actor?.prototypeToken?.disposition;
    const friendly = globalThis.CONST?.TOKEN_DISPOSITIONS?.FRIENDLY ?? 1;
    if (disposition === friendly) return false;
    return true;
  }

  /**
   * Get all enemy NPC combatants in a combat.
   * @param {Combat} combat
   * @returns {Combatant[]}
   */
  static _getEnemyNPCs(combat) {
    return combat.combatants.filter(c => this._isEnemyNPC(c));
  }
}
