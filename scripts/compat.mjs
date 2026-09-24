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
        // Check if token name had duplicate numbering like (1)
        const tokenName = actor?.token?.__name ?? actor?.token?.name;
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

      if (validTerms.length === 0) {
        Hooks.callAll('hideNPCNamesChatMessageUpdated', message, html);
        return;
      }

      // Sort terms by length descending so longer phrases match first
      validTerms.sort((a, b) => b.length - a.length);

      const escapeRegExp = (s) => s.replace(/[.*+\-?^${}()|[\]\\]/g, '\\$&');
      const matchString = validTerms.map(t => escapeRegExp(t.trim())).join('|');

      const regex = `(${matchString})(?=\\s|[\\W]|s\\W|'s\\W|$)`;
      const pattern = new RegExp(regex, 'gim');

      // Do replacement on text nodes
      const elements = [html, ...html.querySelectorAll('*:not(script):not(noscript):not(style)')];
      for (const el of elements) {
        for (const node of Array.from(el.childNodes)) {
          if (node.nodeType === Node.TEXT_NODE && node.textContent) {
            node.textContent = node.textContent.replace(pattern, nameToUse);
          }
        }
        if (el.dataset?.tooltip) {
          el.dataset.tooltip = el.dataset.tooltip.replace(pattern, nameToUse);
        }
      }

      Hooks.callAll('hideNPCNamesChatMessageUpdated', message, html);
    };

    // Update public API reference
    game.hnn = game.hnn ?? {};
    game.hnn.getReplacementInfo = HideNPCNames.getReplacementInfo;

    this._hideNPCNamesPatched = true;
    log('Patched HideNPCNames class methods (getReplacementName, getReplacementInfo, updateChatMessage).');
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
    if (!token.nameplate) return;

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
    if (!combat) return;

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
      if (!nameEl) continue;

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
   * Robustly extract a single-letter tag from any entity:
   * name string, ChatMessage, Combatant, Token, TokenDocument, or Actor.
   *
   * @param {any} target
   * @param {Actor} [actor=null]
   * @returns {string|null} The uppercase letter (A-Z) or null
   */
  static extractLetter(target, actor = null) {
    if (!target && !actor) return null;

    // 1. If target is string, check suffix " [X]"
    if (typeof target === 'string') {
      const match = target.match(/\s\[([A-Z])\]$/);
      if (match) return match[1];
    }

    // 2. If target is a ChatMessage
    if (target?.speaker) {
      const speaker = target.speaker;
      if (speaker.alias) {
        const m = speaker.alias.match(/\s\[([A-Z])\]$/);
        if (m) return m[1];
      }
      if (speaker.token && speaker.scene) {
        const scene = game.scenes?.get(speaker.scene);
        const token = scene?.tokens?.get(speaker.token);
        if (token) {
          const l = this.extractLetter(token);
          if (l) return l;
        }
      }
      if (speaker.actor) {
        const act = game.actors?.get(speaker.actor);
        if (act) {
          const l = this.extractLetter(null, act);
          if (l) return l;
        }
      }
    }

    // 3. If target is a Combatant
    if (target?.documentName === 'Combatant' || (target?.actorId && target?.tokenId)) {
      const flag = target.getFlag?.(MODULE, FLAGS.COMBAT_LETTER);
      if (flag) return flag;
      if (target.__name) {
        const m = target.__name.match(/\s\[([A-Z])\]$/);
        if (m) return m[1];
      }
      if (target._source?.name) {
        const m = target._source.name.match(/\s\[([A-Z])\]$/);
        if (m) return m[1];
      }
      if (target.token) {
        const l = this.extractLetter(target.token);
        if (l) return l;
      }
      if (target.actor) {
        const l = this.extractLetter(null, target.actor);
        if (l) return l;
      }
    }

    // 4. If target is a TokenDocument or Placeable Token
    const tokenDoc = target?.document ?? (target?.documentName === 'Token' ? target : null);
    if (tokenDoc) {
      if (tokenDoc.__name) {
        const m = tokenDoc.__name.match(/\s\[([A-Z])\]$/);
        if (m) return m[1];
      }
      if (tokenDoc._source?.name) {
        const m = tokenDoc._source.name.match(/\s\[([A-Z])\]$/);
        if (m) return m[1];
      }
      const combatant = game.combat?.combatants?.find(c => c.tokenId === tokenDoc.id);
      if (combatant) {
        const flag = combatant.getFlag?.(MODULE, FLAGS.COMBAT_LETTER);
        if (flag) return flag;
      }
      if (tokenDoc.actor) {
        const l = this.extractLetter(null, tokenDoc.actor);
        if (l) return l;
      }
    }

    // 5. If actor (either passed as actor or target is an Actor)
    const act = (target?.documentName === 'Actor' || target instanceof Actor) ? target : actor;
    if (act) {
      if (act.token) {
        const l = this.extractLetter(act.token);
        if (l) return l;
      }
      const letterEffect = act.effects?.find(e => e.getFlag?.(MODULE, FLAGS.COMBAT_LETTER));
      if (letterEffect) {
        const flag = letterEffect.getFlag?.(MODULE, FLAGS.COMBAT_LETTER);
        if (flag) return flag;
      }
      const combatant = game.combat?.combatants?.find(c => c.actorId === act.id);
      if (combatant) {
        const flag = combatant.getFlag?.(MODULE, FLAGS.COMBAT_LETTER);
        if (flag) return flag;
      }
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
