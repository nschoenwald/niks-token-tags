import { MODULE, LETTERS, FLAGS, log } from './const.mjs';
import { Settings } from './settings.mjs';
import { IconGenerator } from './icon-generator.mjs';

/**
 * Core logic for automatically renaming NPC tokens in combat with
 * alphabetical suffixes and applying color-coded active effects.
 */
export class CombatMarker {

  /** Pending debounce timers per combat ID. */
  static _pendingCombats = new Map();

  /** Processing lock — prevents re-entrant processing for the same combat. */
  static _processingLock = new Set();

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
    if (!game.user.isGM) return;
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
   * When a combatant is removed, handle the remaining group.
   * If only one remains, remove its suffix and effect.
   * If more than one remain, leave their existing suffixes intact (stable ordering).
   * @param {Combatant} combatant
   * @param {object} options
   * @param {string} userId
   */
  static async _onDeleteCombatant(combatant, options, userId) {
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE, Settings.ENABLED)) return;
    if (!this._isNPC(combatant)) return;

    const combat = combatant.combat;
    if (!combat) return;

    const actorId = combatant.actorId;
    if (!actorId) return;

    // Get remaining combatants with the same actor (excluding the deleted one)
    const remainingForActor = this._getActorGroup(combat, actorId)
      .filter(c => c.id !== combatant.id);

    const includeSingletons = game.settings.get(MODULE, Settings.INCLUDE_SINGLETONS);

    if (remainingForActor.length === 1 && !includeSingletons) {
      // Only one left of this type, and we don't letter singletons
      await this._removeSuffix(remainingForActor[0]);
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
    if (!game.user.isGM) return;
    if (!game.settings.get(MODULE, Settings.ENABLED)) return;
    if (!game.settings.get(MODULE, Settings.RESTORE_ON_COMBAT_END)) return;

    for (const combatant of combat.combatants) {
      if (!this._isNPC(combatant)) continue;
      const originalName = combatant.getFlag(MODULE, FLAGS.ORIGINAL_NAME);
      if (!originalName) continue;

      // Restore original token name directly (combat/combatant is already deleted)
      const tokenDoc = combatant.token;
      if (tokenDoc) {
        try {
          await tokenDoc.update({ name: originalName });
          log(`Restored token name "${originalName}"`);
        } catch (e) {
          console.warn(`${MODULE} | Could not restore token name:`, e);
        }
      }

      // Remove letter effects from actor directly
      const actor = combatant.actor;
      if (actor) {
        try {
          const effectIds = actor.effects
            .filter(e => e.getFlag(MODULE, FLAGS.COMBAT_LETTER))
            .map(e => e.id);
          if (effectIds.length > 0) {
            await actor.deleteEmbeddedDocuments('ActiveEffect', effectIds);
          }
        } catch (e) {
          console.warn(`${MODULE} | Could not remove letter effects:`, e);
        }
      }
    }
    log('Combat ended — restored original token names.');
  }

  // ---------------------------------------------------------------------------
  // Group Processing
  // ---------------------------------------------------------------------------

  /**
   * Process all NPC actor groups in a combat, assigning suffixes where needed.
   * Uses a processing lock to prevent re-entrant execution.
   * @param {Combat} combat
   */
  static async _processAllGroups(combat) {
    if (this._processingLock.has(combat.id)) {
      log(`Skipping — already processing combat ${combat.id}`);
      return;
    }
    this._processingLock.add(combat.id);

    try {
      const isGlobal = game.settings.get(MODULE, Settings.UNIQUE_LETTERS);
      const includeSingletons = game.settings.get(MODULE, Settings.INCLUDE_SINGLETONS);

      // Group all NPC combatants by actorId
      const actorGroups = new Map();
      for (const combatant of combat.combatants) {
        if (!this._isNPC(combatant)) continue;
        const actorId = combatant.actorId;
        if (!actorId) continue;
        if (!actorGroups.has(actorId)) actorGroups.set(actorId, []);
        actorGroups.get(actorId).push(combatant);
      }

      const groupsToProcess = [];
      const singletonsToRemove = [];

      for (const group of actorGroups.values()) {
        if (group.length === 1 && !includeSingletons) {
          singletonsToRemove.push(group[0]);
        } else if (group.length > 0) {
          groupsToProcess.push(group);
        }
      }

      for (const combatant of singletonsToRemove) {
        await this._removeSuffix(combatant);
      }

      if (isGlobal) {
        const allNpcsToProcess = groupsToProcess.flat();
        if (allNpcsToProcess.length > 0) {
          await this._applySuffixesToGroup(allNpcsToProcess);
        }
      } else {
        for (const group of groupsToProcess) {
          await this._applySuffixesToGroup(group);
        }
      }
    } catch (error) {
      console.error(`${MODULE} | Error processing combat groups:`, error);
    } finally {
      this._processingLock.delete(combat.id);
    }
  }

  // ---------------------------------------------------------------------------
  // Suffix Management
  // ---------------------------------------------------------------------------

  static async _applySuffixesToGroup(group) {
    const usedLetters = new Set();
    const unassigned = [];

    // First pass: identify tokens that already have a letter suffix or flag
    for (const combatant of group) {
      const tokenDoc = combatant.token;
      if (!tokenDoc) continue;

      const nameMatch = tokenDoc.name.match(/^(.*) ([A-Z])$/);

      if (nameMatch) {
        // Token has a letter suffix in its name
        const baseName = nameMatch[1];
        const letter = nameMatch[2];
        usedLetters.add(letter);

        const flagLetter = combatant.getFlag(MODULE, FLAGS.COMBAT_LETTER);
        const originalName = combatant.getFlag(MODULE, FLAGS.ORIGINAL_NAME);

        // Update flags if they don't match the current name suffix
        if (flagLetter !== letter || originalName !== baseName) {
          await combatant.update({
            [`flags.${MODULE}.${FLAGS.ORIGINAL_NAME}`]: baseName,
            [`flags.${MODULE}.${FLAGS.COMBAT_LETTER}`]: letter,
          });
        }

        // Check if the actor has the correct active effect and no mismatched ones
        const actor = combatant.actor;
        if (actor) {
          const effects = actor.effects.filter(e => e.getFlag(MODULE, FLAGS.COMBAT_LETTER));
          const hasCorrectEffect = effects.some(e => e.getFlag(MODULE, FLAGS.COMBAT_LETTER) === letter);
          const hasMismatchingEffect = effects.some(e => e.getFlag(MODULE, FLAGS.COMBAT_LETTER) !== letter);

          if (!hasCorrectEffect || hasMismatchingEffect) {
            await this._applyLetterEffect(combatant, letter);
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

    // Sort unassigned combatants by ID (proxy for creation order) for stable assignment
    unassigned.sort((a, b) => a.id.localeCompare(b.id));

    if (unassigned.length === 0) return;

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

      await this._assignSuffix(combatant, letter);
    }
  }

  /**
   * Assign a letter suffix to a combatant: rename the token and combatant, and apply the effect.
   * @param {Combatant} combatant
   * @param {string} letter
   */
  static async _assignSuffix(combatant, letter) {
    const tokenDoc = combatant.token;
    if (!tokenDoc) return;

    // Store the original name if not already stored
    const existingOriginal = combatant.getFlag(MODULE, FLAGS.ORIGINAL_NAME);
    const baseName = existingOriginal ?? tokenDoc.name;
    const newName = `${baseName} ${letter}`;

    log(`Assigning suffix "${letter}" to "${baseName}" → "${newName}"`);

    // Update the token name
    await tokenDoc.update({ name: newName });

    // Update the combatant name and set flags in one call
    await combatant.update({
      name: newName,
      [`flags.${MODULE}.${FLAGS.ORIGINAL_NAME}`]: baseName,
      [`flags.${MODULE}.${FLAGS.COMBAT_LETTER}`]: letter,
    });

    // Apply the color-coded letter effect
    await this._applyLetterEffect(combatant, letter);
  }

  /**
   * Remove the letter suffix from a combatant and restore its original name.
   * @param {Combatant} combatant
   */
  static async _removeSuffix(combatant) {
    const originalName = combatant.getFlag(MODULE, FLAGS.ORIGINAL_NAME);
    if (!originalName) return;

    const tokenDoc = combatant.token;

    log(`Removing suffix from "${combatant.name}" → "${originalName}"`);

    // Restore token name
    if (tokenDoc) {
      await tokenDoc.update({ name: originalName });
    }

    // Restore combatant name and clear flags
    await combatant.update({
      name: originalName,
      [`flags.${MODULE}.-=${FLAGS.ORIGINAL_NAME}`]: null,
      [`flags.${MODULE}.-=${FLAGS.COMBAT_LETTER}`]: null,
    });

    // Remove the active effect
    await this._removeLetterEffect(combatant);
  }

  // ---------------------------------------------------------------------------
  // Active Effect Management
  // ---------------------------------------------------------------------------

  /**
   * Apply a color-coded letter active effect to a combatant's token actor.
   * Uses toggleStatusEffect (same approach as token-color-marker) which correctly
   * sets up status effects for token display in both V13 and V14.
   * @param {Combatant} combatant
   * @param {string} letter
   */
  static async _applyLetterEffect(combatant, letter) {
    const actor = combatant.actor;
    if (!actor) return;

    // Remove any existing token tag effects first
    await this._removeLetterEffect(combatant);

    const statusId = `${MODULE}.${letter}`;
    const iconPath = IconGenerator.getEffectIconPath(letter);

    // Temporarily register in CONFIG.statusEffects so toggleStatusEffect can find it
    CONFIG.statusEffects.push({
      id: statusId,
      name: letter,
      label: letter,
      img: iconPath,
    });

    try {
      await actor.toggleStatusEffect(statusId, { overlay: false });
      log(`Applied letter effect "${letter}" to actor "${actor.name}" with icon "${iconPath}"`);
    } catch (error) {
      console.error(`${MODULE} | Failed to toggle status effect for letter "${letter}":`, error);
    } finally {
      // Always clean up CONFIG.statusEffects to avoid global pollution
      const configIdx = CONFIG.statusEffects.findIndex(e => e.id === statusId);
      if (configIdx !== -1) CONFIG.statusEffects.splice(configIdx, 1);
    }

    // Set our module flag on the newly created effect for later identification
    const effect = actor.effects.find(e => e.statuses?.has(statusId));
    if (effect) {
      await effect.setFlag(MODULE, FLAGS.COMBAT_LETTER, letter);
    }
  }

  /**
   * Remove any token tag letter effects from the combatant's actor.
   * Only removes effects that have our module flag set.
   * @param {Combatant} combatant
   */
  static async _removeLetterEffect(combatant) {
    const actor = combatant.actor;
    if (!actor) return;

    const effectIds = actor.effects
      .filter(e => e.getFlag(MODULE, FLAGS.COMBAT_LETTER))
      .map(e => e.id);

    if (effectIds.length > 0) {
      await actor.deleteEmbeddedDocuments('ActiveEffect', effectIds);
    }
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Check if a combatant is an NPC.
   * Uses DnD5e-specific check first, falls back to system-agnostic check.
   * @param {Combatant} combatant
   * @returns {boolean}
   */
  static _isNPC(combatant) {
    const actor = combatant.actor;
    if (!actor) return false;

    // DnD5e-specific: check actor type
    if (game.system.id === 'dnd5e') {
      return actor.type === 'npc';
    }

    // System-agnostic fallback: not player-owned
    return !combatant.hasPlayerOwner;
  }

  /**
   * Get all NPC combatants in a combat that share the given actorId.
   * @param {Combat} combat
   * @param {string} actorId
   * @returns {Combatant[]}
   */
  static _getActorGroup(combat, actorId) {
    return combat.combatants.filter(c => c.actorId === actorId && this._isNPC(c));
  }
}
