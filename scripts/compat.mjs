import { MODULE, FLAGS, log } from './const.mjs';

/**
 * Handles compatibility with the hide-npc-names module.
 *
 * hide-npc-names replaces NPC names with generic placeholders (e.g. "Unknown Creature")
 * when configured to hide names from players. It also searches chat cards and censors
 * occurrences of the creature's name.
 *
 * This compatibility layer ensures that the alphabetical token tag suffix (e.g. `[A]`)
 * is NEVER censored by hide-npc-names anywhere:
 *  - Token & Combatant documents: `name` getter returns "Unknown Creature [A]" for players
 *  - Canvas nameplates: always display the tag suffix for both players and GMs
 *  - Combat tracker: shows the tag suffix on all combatants
 *  - Chat messages:
 *      * Sender alias & header displays "Unknown Creature [A]"
 *      * Message body, dice rolls, formulas, tooltips, and descriptions never have `[A]` censored
 *      * Single letters (e.g. "A") are never treated as match terms or censored
 *
 * Architecture:
 *  1. Primary: Dynamically imports `HideNPCNames` class from hide-npc-names and monkey-patches
 *     `getReplacementName`, `getReplacementInfo`, and `updateChatMessage`.
 *  2. Sync: Keeps `game.hnn.getReplacementInfo` in sync with the patched implementation.
 *  3. Fallback: Post-render hooks on canvas (`refreshToken`), combat tracker (`renderCombatTracker`),
 *     and chat messages (`renderChatMessageHTML` & `dnd5e.renderChatMessage`), plus pre-render
 *     alias sanitization if the class patch cannot be applied.
 */
export class Compatibility {

  /** Whether the compatibility hooks have been registered. */
  static _initialized = false;

  /** Whether the HideNPCNames class has been successfully patched. */
  static _hideNPCNamesPatched = false;

  /** Reference to the imported HideNPCNames class. */
  static _HideNPCNamesRef = null;

  /**
   * Lazily built lookup of combatant letter flags for the viewed combat:
   * `{ combat, byToken: Map<tokenId, letter>, byActor: Map<actorId, letter> }`.
   * Rebuilt when invalidated by a combatant change or when `game.combat` changes.
   */
  static _letterIndex = null;

  /** Cache of actor → letter from its token tag effect (null if none). */
  static _effectLetterCache = new WeakMap();

  /** Cache of compiled chat censor patterns keyed by hideParts flag and name. */
  static _chatPatternCache = new Map();

  /**
   * Initialize all compatibility patches.
   * Can be called during `init` and `setup` (idempotent).
   */
  static async init() {
    if (!game.modules.get('hide-npc-names')?.active) return;

    if (this._initialized) {
      this.sync();
      return;
    }
    this._initialized = true;

    // Register UI fallback hooks immediately
    this._registerCacheHooks();
    this._registerCanvasHooks();
    this._registerCombatTrackerHooks();
    this._registerChatHooks();
    this._registerAliasStripHooks();

    // Attempt to patch HideNPCNames class methods
    await this._patchHideNPCNames();
  }

  /**
   * Keep game.hnn API in sync with the patched methods.
   * Called during `setup` and `ready`.
   */
  static sync() {
    if (this._HideNPCNamesRef && game.hnn) {
      game.hnn.getReplacementInfo = this._HideNPCNamesRef.getReplacementInfo;
    }
  }

  // ---------------------------------------------------------------------------
  // Class Patching
  // ---------------------------------------------------------------------------

  /**
   * Dynamically import and monkey-patch the HideNPCNames class.
   */
  static async _patchHideNPCNames() {
    let HideNPCNames = null;

    // Strategy 1: Dynamic import via relative URL from import.meta.url
    try {
      const moduleUrl = new URL('../../hide-npc-names/scripts/hide-npc-names.js', import.meta.url).href;
      const mod = await import(moduleUrl);
      if (mod?.HideNPCNames) {
        HideNPCNames = mod.HideNPCNames;
      }
    } catch (e) {
      log('Dynamic import via relative URL failed, trying getRoute...', e);
    }

    // Strategy 2: Dynamic import via Foundry getRoute
    if (!HideNPCNames) {
      try {
        const route = foundry.utils.getRoute('modules/hide-npc-names/scripts/hide-npc-names.js');
        const mod = await import(route);
        if (mod?.HideNPCNames) {
          HideNPCNames = mod.HideNPCNames;
        }
      } catch (e) {
        log('Dynamic import via getRoute failed:', e);
      }
    }

    // Strategy 3: Check module API or globalThis
    if (!HideNPCNames) {
      const hnnMod = game.modules.get('hide-npc-names');
      HideNPCNames = hnnMod?.api?.HideNPCNames ?? globalThis.HideNPCNames ?? null;
    }

    if (!HideNPCNames) {
      log('HideNPCNames class not reachable; using hook-based fallbacks for censor protection.');
      return;
    }

    this._HideNPCNamesRef = HideNPCNames;
    this._applyPatches(HideNPCNames);
  }

  /**
   * Apply monkey-patches to HideNPCNames static methods.
   * @param {Function} HideNPCNames
   */
  static _applyPatches(HideNPCNames) {
    const origGetReplacementName = HideNPCNames.getReplacementName;
    const origGetReplacementInfo = HideNPCNames.getReplacementInfo;

    // 1. Patch getReplacementName: preserve duplicate numbering and letter suffix
    HideNPCNames.getReplacementName = function(actor) {
      let repName = origGetReplacementName.call(this, actor);
      if (typeof repName !== 'string') return repName;

      const letter = Compatibility.extractLetter(null, actor);
      if (letter && !repName.endsWith(` [${letter}]`)) {
        // Check if token name had duplicate numbering like (1) without invoking getter on .name
        const tokenName = actor?.token?.__name || actor?.token?._source?.name || '';
        if (tokenName) {
          const numMatch = tokenName.match(/(\s\(\d+\))/);
          if (numMatch && !repName.includes(numMatch[1])) {
            repName = `${repName}${numMatch[1]}`;
          }
        }
        repName = `${repName.replace(/\s*\[[A-Z]\]$/, '')} [${letter}]`;
      }
      return repName;
    };

    // 2. Patch getReplacementInfo: ensure replacementName and displayName include the suffix
    HideNPCNames.getReplacementInfo = function(actor, defaultName) {
      const result = origGetReplacementInfo.call(this, actor, defaultName);
      if (!result) return result;

      const letter = Compatibility.extractLetter(defaultName, actor);
      if (letter) {
        const suffix = ` [${letter}]`;
        if (result.replacementName && !result.replacementName.endsWith(suffix)) {
          result.replacementName = `${result.replacementName.replace(/\s*\[[A-Z]\]$/, '')}${suffix}`;
        }
        if (result.shouldReplace && !game.user.isGM && !actor?.isOwner) {
          if (result.displayName && !result.displayName.endsWith(suffix)) {
            result.displayName = `${result.displayName.replace(/\s*\[[A-Z]\]$/, '')}${suffix}`;
          }
        }
      }
      return result;
    };

    // 3. Patch updateChatMessage: prevent single-letter and token tag censoring in chat cards
    HideNPCNames.updateChatMessage = function(message, html, actor, name) {
      if (!html) return;

      const replacementInfo = HideNPCNames.getReplacementInfo(actor, name);
      const nameToUse = replacementInfo.shouldReplace ? replacementInfo.replacementName : replacementInfo.displayName;

      const baseName = name ? name.replace(/\s*\[[A-Z]\]$/, '').trim() : '';

      let hideParts = true;
      try {
        hideParts = game.settings.get('hide-npc-names', 'hideParts');
      } catch (e) {
        hideParts = true;
      }

      const pattern = Compatibility._getChatPattern(name, baseName, hideParts);
      if (!pattern) {
        Hooks.callAll('hideNPCNamesChatMessageUpdated', message, html);
        return;
      }

      // Do replacement on text nodes (skipping script/noscript/style contents)
      const walker = document.createTreeWalker(html, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const text = node.textContent;
        if (!text || /^(SCRIPT|NOSCRIPT|STYLE)$/.test(node.parentElement?.tagName)) continue;
        const replaced = text.replace(pattern, nameToUse);
        if (replaced !== text) node.textContent = replaced;
      }

      // And on tooltips
      const tooltipEls = html.dataset?.tooltip ? [html, ...html.querySelectorAll('[data-tooltip]')] : html.querySelectorAll('[data-tooltip]');
      for (const el of tooltipEls) {
        const tooltip = el.dataset.tooltip;
        if (!tooltip) continue;
        const replaced = tooltip.replace(pattern, nameToUse);
        if (replaced !== tooltip) el.dataset.tooltip = replaced;
      }

      Hooks.callAll('hideNPCNamesChatMessageUpdated', message, html);
    };

    // Update public API reference
    game.hnn = game.hnn ?? {};
    game.hnn.getReplacementInfo = HideNPCNames.getReplacementInfo;

    this._hideNPCNamesPatched = true;
    log('Patched HideNPCNames class methods (getReplacementName, getReplacementInfo, updateChatMessage).');
  }

  /**
   * Build (or fetch from cache) the censor RegExp for a speaker name.
   * Returns null if there are no valid terms to censor.
   * @param {string} name - Full speaker name (may include the `[X]` suffix)
   * @param {string} baseName - Name without the suffix
   * @param {boolean} hideParts - Whether to also censor parts of the name
   * @returns {RegExp|null}
   */
  static _getChatPattern(name, baseName, hideParts) {
    const cacheKey = `${hideParts ? 1 : 0}|${name ?? ''}`;
    if (this._chatPatternCache.has(cacheKey)) return this._chatPatternCache.get(cacheKey);

    // Collect all terms to search and replace
    const termsSet = new Set();

    // Full name with suffix (e.g. "Goblin [A]")
    if (name && name.trim().length > 0) {
      termsSet.add(name.trim());
    }

    // Base name without suffix (e.g. "Goblin")
    if (baseName && baseName.length > 0) {
      termsSet.add(baseName);
    }

    // If hideParts is true, split baseName into parts (NEVER including the suffix in the split)
    if (hideParts && baseName.includes(' ')) {
      const parts = baseName.split(/\s+/).filter(w => w.length > 0);
      const rejectTerms = new Set(['of', 'its', 'the', 'a', "it's", 'if', 'in', 'for', 'on', 'by', 'and']);
      for (let i = 0; i < parts.length; i++) {
        const len = parts.length - i;
        for (let p = 0; p <= i; p++) {
          const part = parts.slice(p, p + len);
          if (part.length === 1 && rejectTerms.has(part[0].toLowerCase())) {
            continue;
          }
          termsSet.add(part.join(' '));
        }
      }
    }

    // Filter terms:
    // CRITICAL: NEVER allow standalone letter tags like "[A]", "A", or "[X]" to be censored!
    const validTerms = Array.from(termsSet).filter(term => {
      const trimmed = term.trim();
      if (trimmed.length === 0) return false;
      // Exclude single letters or isolated bracketed tags: e.g. "A", "[A]"
      if (/^\[?[A-Za-z0-9]\]?$/.test(trimmed)) return false;
      return true;
    });

    let pattern = null;
    if (validTerms.length > 0) {
      // Sort terms by length descending so longer phrases match first
      validTerms.sort((a, b) => b.length - a.length);

      const matchString = validTerms.map(t => this._escapeRegExp(t.trim())).join('|');
      pattern = new RegExp(`(${matchString})(?=\\s|[\\W]|s\\W|'s\\W|$)`, 'gim');
    }

    // Keep the cache bounded; speaker names are few, so a simple reset is enough
    if (this._chatPatternCache.size >= 200) this._chatPatternCache.clear();
    this._chatPatternCache.set(cacheKey, pattern);
    return pattern;
  }

  // ---------------------------------------------------------------------------
  // Lookup Caches
  // ---------------------------------------------------------------------------

  /**
   * Invalidate the letter lookups whenever the data they are derived from changes.
   * These hooks fire on every client, so players' caches stay current too.
   */
  static _registerCacheHooks() {
    const invalidateIndex = () => { this._letterIndex = null; };
    for (const hook of ['createCombatant', 'updateCombatant', 'deleteCombatant', 'deleteCombat']) {
      Hooks.on(hook, invalidateIndex);
    }

    const invalidateEffects = () => { this._effectLetterCache = new WeakMap(); };
    for (const hook of ['createActiveEffect', 'updateActiveEffect', 'deleteActiveEffect', 'updateActor']) {
      Hooks.on(hook, invalidateEffects);
    }
    // Synthetic (unlinked) actor effects live in the token's delta
    Hooks.on('updateToken', (tokenDoc, changes) => {
      if ('delta' in changes || 'actorLink' in changes || 'actorId' in changes) invalidateEffects();
    });
  }

  /**
   * Get (building if needed) the combatant letter index for the viewed combat.
   * @returns {{ combat: Combat|null, byToken: Map<string, string>, byActor: Map<string, string> }}
   */
  static _getLetterIndex() {
    const combat = globalThis.game?.combat ?? null;
    if (this._letterIndex?.combat === combat) return this._letterIndex;

    const byToken = new Map();
    const byActor = new Map();
    for (const combatant of combat?.combatants ?? []) {
      const letter = combatant.getFlag?.(MODULE, FLAGS.COMBAT_LETTER);
      if (!letter) continue;
      if (combatant.tokenId) byToken.set(combatant.tokenId, letter);
      if (combatant.actorId && !byActor.has(combatant.actorId)) byActor.set(combatant.actorId, letter);
    }

    this._letterIndex = { combat, byToken, byActor };
    return this._letterIndex;
  }

  /**
   * Get the letter of an actor's token tag effect, cached per actor instance.
   * @param {Actor} actor
   * @returns {string|null}
   */
  static _getEffectLetter(actor) {
    if (!actor || typeof actor !== 'object') return null;
    let letter = this._effectLetterCache.get(actor);
    if (letter === undefined) {
      const effect = actor.effects?.find(e => e.getFlag?.(MODULE, FLAGS.COMBAT_LETTER));
      letter = effect?.getFlag(MODULE, FLAGS.COMBAT_LETTER) ?? null;
      this._effectLetterCache.set(actor, letter);
    }
    return letter;
  }

  // ---------------------------------------------------------------------------
  // Canvas Nameplates
  // ---------------------------------------------------------------------------

  static _registerCanvasHooks() {
    Hooks.on('refreshToken', (token) => {
      this._fixTokenNameplate(token);
    });
  }

  /**
   * Ensure the canvas nameplate includes the letter tag suffix.
   * @param {Token} token
   */
  static _fixTokenNameplate(token) {
    if (!token?.nameplate || typeof token.nameplate.text !== 'string') return;

    const letter = this.extractLetter(token);
    if (!letter) return;

    const suffix = `[${letter}]`;
    if (token.nameplate.text.includes(suffix)) return;

    // If GM view and hide-npc-names added " [Hidden]"
    let hiddenSuffix = '';
    try {
      hiddenSuffix = game.settings.get('hide-npc-names', 'tokenHiddenSuffix') || '';
    } catch (e) {}

    if (hiddenSuffix && token.nameplate.text.endsWith(` ${hiddenSuffix}`)) {
      token.nameplate.text = token.nameplate.text.replace(
        new RegExp(`\\s*${this._escapeRegExp(hiddenSuffix)}$`),
        ` [${letter}] ${hiddenSuffix}`
      );
    } else {
      token.nameplate.text = `${token.nameplate.text.trimEnd()} [${letter}]`;
    }
  }

  // ---------------------------------------------------------------------------
  // Combat Tracker
  // ---------------------------------------------------------------------------

  static _registerCombatTrackerHooks() {
    Hooks.on('renderCombatTracker', (app, html) => {
      this._fixCombatTracker(html);
    });
  }

  /**
   * Walk combat tracker entries and ensure each lettered NPC displays its suffix.
   * @param {HTMLElement} html
   */
  static _fixCombatTracker(html) {
    const combat = game.combat;
    if (!combat || !html) return;

    const entries = html.querySelectorAll('li[data-combatant-id]');
    for (const entry of entries) {
      const combatantId = entry.dataset.combatantId;
      const combatant = combat.combatants.get(combatantId);
      if (!combatant) continue;

      const letter = this.extractLetter(combatant);
      if (!letter) continue;

      const suffix = `[${letter}]`;
      const nameEl = entry.querySelector('.token-name h4')
        || entry.querySelector('.token-name a')
        || entry.querySelector('.token-name');
      if (!nameEl || typeof nameEl.textContent !== 'string') continue;

      if (!nameEl.textContent.includes(suffix)) {
        this._appendLetterToElement(nameEl, letter);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Chat Messages
  // ---------------------------------------------------------------------------

  /**
   * Hook chat message rendering across core Foundry and system-specific hooks.
   */
  static _registerChatHooks() {
    const restoreChat = (message, html) => {
      this._restoreLetterInChat(message, html);
    };

    Hooks.on('renderChatMessageHTML', restoreChat);
    Hooks.on('dnd5e.renderChatMessage', restoreChat);
  }

  /**
   * Ensure sender name in chat message card retains the letter suffix.
   * @param {ChatMessage} message
   * @param {HTMLElement} html
   */
  static _restoreLetterInChat(message, html) {
    if (!html) return;
    const letter = this.extractLetter(message);
    if (!letter) return;

    const suffix = `[${letter}]`;

    // Try to find the sender name element
    const senderEl = html.querySelector?.('.message-sender')
      ?? html.querySelector?.('header')?.firstElementChild;
    if (!senderEl) return;

    const nameEl = senderEl.querySelector('.title')
      || senderEl.querySelector('.name')
      || senderEl;

    if (!nameEl || typeof nameEl.textContent !== 'string') return;

    if (!nameEl.textContent.includes(suffix)) {
      this._appendLetterToElement(nameEl, letter);
    }
  }

  /**
   * Fallback pre-render hook: strips the `[X]` suffix from `message.speaker.alias`
   * before unpatched hide-npc-names reads it, preventing single-letter censoring.
   * Only active if the direct HideNPCNames class patch was not applied.
   */
  static _registerAliasStripHooks() {
    const stripAlias = (message) => {
      if (this._hideNPCNamesPatched) return;

      const alias = message.speaker?.alias;
      if (!alias || !/\s\[[A-Z]\]$/.test(alias)) return;

      const stripped = Compatibility._stripOurSuffix(alias);
      const originalSpeaker = message.speaker;
      const patchedSpeaker = Object.assign(Object.create(null), originalSpeaker, { alias: stripped });

      Object.defineProperty(message, 'speaker', {
        value: patchedSpeaker, configurable: true, enumerable: true, writable: true
      });

      Promise.resolve().then(() => {
        Object.defineProperty(message, 'speaker', {
          value: originalSpeaker, configurable: true, enumerable: true, writable: true
        });
      });
    };

    Hooks.on('renderChatMessageHTML', stripAlias);
    Hooks.on('dnd5e.renderChatMessage', stripAlias);
  }

  // ---------------------------------------------------------------------------
  // Utility & Letter Extraction
  // ---------------------------------------------------------------------------

  /**
   * Helper to extract letter from a name string (e.g. "Goblin [A]" -> "A").
   * @param {string} str
   * @returns {string|null}
   */
  static _matchLetterString(str) {
    if (typeof str !== 'string' || !str) return null;
    const match = str.match(/\s\[([A-Z])\]$/);
    return match ? match[1] : null;
  }

  /**
   * Robustly extract a single-letter tag from any entity WITHOUT recursion:
   * name string, ChatMessage, Combatant, Token, TokenDocument, or Actor.
   *
   * Called from very hot paths (every `refreshToken`, every combat tracker render, and every
   * hide-npc-names name lookup), so combatant and effect lookups go through cached indexes
   * instead of scanning collections.
   *
   * @param {any} target
   * @param {Actor} [actor=null]
   * @returns {string|null} The uppercase letter (A-Z) or null
   */
  static extractLetter(target, actor = null) {
    if (!target && !actor) return null;

    // 1. If target is string, check suffix " [X]"
    if (typeof target === 'string') {
      return this._matchLetterString(target);
    }

    // 2. If target is a ChatMessage
    if (target?.speaker) {
      const speaker = target.speaker;
      const aliasLetter = this._matchLetterString(speaker.alias);
      if (aliasLetter) return aliasLetter;

      if (speaker.token && speaker.scene && globalThis.game?.scenes) {
        const scene = game.scenes.get(speaker.scene);
        const token = scene?.tokens?.get(speaker.token);
        if (token) {
          const l = this._matchLetterString(token.__name) || this._matchLetterString(token._source?.name);
          if (l) return l;
        }
      }
      if (speaker.actor && globalThis.game?.actors) {
        const l = this._getEffectLetter(game.actors.get(speaker.actor));
        if (l) return l;
      }
    }

    // 3. If target is a Combatant
    if (target?.documentName === 'Combatant' || (target?.actorId && target?.tokenId)) {
      const flag = target.getFlag?.(MODULE, FLAGS.COMBAT_LETTER);
      if (flag) return flag;

      const nameLetter = this._matchLetterString(target.__name) || this._matchLetterString(target._source?.name);
      if (nameLetter) return nameLetter;

      if (target.token) {
        const tLetter = this._matchLetterString(target.token.__name) || this._matchLetterString(target.token._source?.name);
        if (tLetter) return tLetter;
      }

      const effectLetter = this._getEffectLetter(target.actor);
      if (effectLetter) return effectLetter;
    }

    // 4. If target is a TokenDocument or Placeable Token
    const tokenDoc = target?.document ?? (target?.documentName === 'Token' ? target : null);
    if (tokenDoc) {
      const nameLetter = this._matchLetterString(tokenDoc.__name) || this._matchLetterString(tokenDoc._source?.name);
      if (nameLetter) return nameLetter;

      const flag = this._getLetterIndex().byToken.get(tokenDoc.id);
      if (flag) return flag;

      const effectLetter = this._getEffectLetter(tokenDoc.actor);
      if (effectLetter) return effectLetter;
    }

    // 5. If actor (either target is Actor or passed as actor parameter)
    const act = (target?.documentName === 'Actor' || (target && typeof target.hasPlayerOwner === 'boolean')) ? target : actor;
    if (act) {
      const effectLetter = this._getEffectLetter(act);
      if (effectLetter) return effectLetter;

      if (act.token) {
        const nameLetter = this._matchLetterString(act.token.__name) || this._matchLetterString(act.token._source?.name);
        if (nameLetter) return nameLetter;
      }

      const index = this._getLetterIndex();
      const flag = (act.token && index.byToken.get(act.token.id)) || index.byActor.get(act.id);
      if (flag) return flag;
    }

    return null;
  }

  /**
   * Strips our `[X]` suffix from a name string.
   * @param {string} name
   * @returns {string}
   */
  static _stripOurSuffix(name) {
    if (typeof name !== 'string') return name;
    return name.replace(/\s*\[[A-Z]\]$/, '');
  }

  /**
   * Walk text nodes inside an element and append the letter suffix to the first
   * non-empty text node that doesn't already contain it.
   * @param {HTMLElement} el
   * @param {string} letter
   */
  static _appendLetterToElement(el, letter) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    const suffix = `[${letter}]`;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (text.length > 0 && !text.includes(suffix)) {
        node.textContent = `${node.textContent.trimEnd()} ${suffix}`;
        return;
      }
    }
  }

  /**
   * Escape RegExp special characters.
   * @param {string} string
   * @returns {string}
   */
  static _escapeRegExp(string) {
    return string.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&');
  }
}
