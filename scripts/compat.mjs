import { MODULE, FLAGS, log } from './const.mjs';

/**
 * Handles compatibility with the hide-npc-names module.
 *
 * hide-npc-names overrides the `name` property on TokenDocument, Combatant, and
 * PrototypeToken prototypes with a NON-CONFIGURABLE descriptor. When the name is
 * hidden for a player, the getter returns the replacement name (e.g. "Unknown
 * Creature") which strips our letter suffix.
 *
 * Since we cannot redefine or wrap the non-configurable property, we instead fix
 * the display in post-rendering hooks:
 *  - Canvas nameplates: `refreshToken`
 *  - Combat tracker:    `renderCombatTracker`
 *  - Chat messages:     `renderChatMessageHTML` / `dnd5e.renderChatMessage`
 */
export class Compatibility {

  /**
   * Initialize all compatibility patches.
   * Must be called during or after the `setup` phase.
   */
  static init() {
    if (!game.modules.get('hide-npc-names')?.active) return;

    this._registerCanvasHooks();
    this._registerCombatTrackerHooks();
    this._registerChatHooks();
    this._registerSpeakerAliasPatch();
    log('Registered hide-npc-names compatibility hooks.');
  }

  /**
   * Registers a `renderChatMessageHTML` hook that runs before hide-npc-names'
   * own hook (because we register during `setup` → `init`, which fires in
   * registration order) and temporarily strips our `[X]` suffix from the
   * message speaker alias. hide-npc-names reads `speaker.alias` as the `name`
   * it censors; by removing the suffix we prevent single-letter censoring.
   *
   * The alias is restored immediately after so that our own later hook
   * (_restoreLetterInChat) can still read it normally.
   *
   * NOTE: We also attempt a direct monkey-patch at `ready` time via
   * `_tryPatchHideNPCNamesClass()`, which is more surgical. The hook approach
   * acts as a guaranteed fallback.
   */
  static _registerSpeakerAliasPatch() {
    // Deferred class patch — attempted once the module is fully initialized.
    Hooks.once('ready', () => {
      this._tryPatchHideNPCNamesClass();
    });
  }

  /**
   * Attempt to directly monkey-patch `HideNPCNames.updateChatMessage`.
   *
   * hide-npc-names does NOT expose HideNPCNames on `window`, but it does
   * expose `game.hnn.getReplacementInfo`, which is `HideNPCNames.getReplacementInfo`.
   * From that bound reference we can recover the class and patch its static method.
   *
   * Falls back to a hook-based pre-sanitization approach if the class cannot be found.
   */
  static _tryPatchHideNPCNamesClass() {
    // Try to reach HideNPCNames via game.hnn (their public API object)
    const hnn = game.hnn;
    if (!hnn) {
      log('hide-npc-names: game.hnn not found, using hook-based fallback for censor fix.');
      this._registerAliasStripHook();
      return;
    }

    // game.hnn.getReplacementInfo is HideNPCNames.getReplacementInfo (static method).
    // We can access the class via its enclosing scope by checking if the method is
    // a static method of a class that also has updateChatMessage.
    // The safest approach: fish it out of the module's Foundry module object.
    const moduleApi = game.modules.get('hide-npc-names');
    const HideNPCNamesClass = moduleApi?.api?.HideNPCNames ?? null;

    if (HideNPCNamesClass && typeof HideNPCNamesClass.updateChatMessage === 'function') {
      const originalUpdate = HideNPCNamesClass.updateChatMessage;
      HideNPCNamesClass.updateChatMessage = function(html, actor, name) {
        const sanitizedName = Compatibility._stripOurSuffix(name);
        return originalUpdate.call(this, html, actor, sanitizedName);
      };
      log('Patched HideNPCNames.updateChatMessage via module API to prevent single-letter censoring.');
    } else {
      // Class not reachable via module API — fall back to hook approach.
      log('hide-npc-names: HideNPCNames class not reachable via module API, using hook-based fallback.');
      this._registerAliasStripHook();
    }
  }

  /**
   * Hook-based fallback: registers a `renderChatMessageHTML` hook that strips
   * our `[X]` suffix from `message.speaker.alias` before hide-npc-names' hook
   * reads it, then restores it so our own suffix-restore hook still works.
   *
   * This works because Foundry fires hooks in registration order, and we
   * registered during `setup` (before hide-npc-names' own `setup`-registered
   * hooks in most load orders). The alias mutation is synchronous and ephemeral.
   */
  static _registerAliasStripHook() {
    const patchedMessages = new WeakSet();

    Hooks.on('renderChatMessageHTML', (message, _html, _data) => {
      if (patchedMessages.has(message)) return;
      patchedMessages.add(message);

      const alias = message.speaker?.alias;
      if (!alias || !/ \[([A-Z])\]$/.test(alias)) return;

      // Temporarily strip the suffix so hide-npc-names doesn't use it as a match term.
      const stripped = Compatibility._stripOurSuffix(alias);
      // We cannot mutate the document directly (it's reactive), so we shadow
      // the property on the speaker object for this render cycle only.
      const originalSpeaker = message.speaker;
      const patchedSpeaker = Object.assign(Object.create(null), originalSpeaker, { alias: stripped });
      Object.defineProperty(message, 'speaker', {
        value: patchedSpeaker, configurable: true, enumerable: true, writable: true
      });

      // Schedule restoration after all renderChatMessageHTML hooks have run
      // by queuing a microtask (Promise.resolve) so our own restore hook sees
      // the original alias while hide-npc-names already consumed the patched one.
      Promise.resolve().then(() => {
        Object.defineProperty(message, 'speaker', {
          value: originalSpeaker, configurable: true, enumerable: true, writable: true
        });
      });
    });

    log('Registered alias-strip hook as hide-npc-names censor fallback.');
  }

  /**
   * Strips our `[X]` suffix from a name string.
   * e.g. "Goblin A" → "Goblin A" (no suffix), "Goblin [A]" → "Goblin"
   * @param {string} name
   * @returns {string}
   */
  static _stripOurSuffix(name) {
    if (typeof name !== 'string') return name;
    return name.replace(/ \[[A-Z]\]$/, '');
  }

  // ---------------------------------------------------------------------------
  // Canvas nameplates
  // ---------------------------------------------------------------------------

  static _registerCanvasHooks() {
    Hooks.on('refreshToken', (token) => {
      if (game.user.isGM) return;
      this._fixTokenNameplate(token);
    });
  }

  /**
   * After Foundry renders the nameplate text (which reads from the overridden
   * `name` getter and gets the replacement name without our suffix), re-append
   * the letter suffix from `__name` (the real name stored by hide-npc-names).
   */
  static _fixTokenNameplate(token) {
    if (!token.nameplate) return;

    const letter = this._getLetterFromRealName(token.document.__name);
    if (!letter) return;

    const suffix = ` [${letter}]`;
    if (!token.nameplate.text.endsWith(suffix)) {
      token.nameplate.text += suffix;
    }
  }

  // ---------------------------------------------------------------------------
  // Combat tracker
  // ---------------------------------------------------------------------------

  static _registerCombatTrackerHooks() {
    Hooks.on('renderCombatTracker', (app, html) => {
      if (game.user.isGM) return;
      this._fixCombatTracker(html);
    });
  }

  /**
   * The combat tracker reads `combatant.name` which goes through the
   * hide-npc-names getter and loses our suffix. Walk the rendered list items
   * and re-append the letter.
   */
  static _fixCombatTracker(html) {
    const combat = game.combat;
    if (!combat) return;

    const entries = html.querySelectorAll('li[data-combatant-id]');
    for (const entry of entries) {
      const combatantId = entry.dataset.combatantId;
      const combatant = combat.combatants.get(combatantId);
      if (!combatant) continue;

      const letter = this._getLetterFromRealName(combatant.__name);
      if (!letter) return;

      // The name is typically inside `.token-name h4` or `.token-name`
      const nameEl = entry.querySelector('.token-name h4')
        || entry.querySelector('.token-name a')
        || entry.querySelector('.token-name');
      if (!nameEl) continue;

      this._appendLetterToElement(nameEl, letter);
    }
  }

  // ---------------------------------------------------------------------------
  // Chat messages
  // ---------------------------------------------------------------------------

  /**
   * Register hooks for chat message rendering. hide-npc-names does aggressive
   * regex replacement on all text nodes in the chat HTML, which strips our
   * suffix. We run after it and re-append the letter.
   *
   * For DnD5e, hide-npc-names skips `renderChatMessageHTML` and only uses
   * `dnd5e.renderChatMessage`. We hook both for full coverage.
   */
  static _registerChatHooks() {
    Hooks.on('renderChatMessageHTML', (message, html, _data) => {
      this._restoreLetterInChat(message, html);
    });
    Hooks.on('dnd5e.renderChatMessage', (message, html) => {
      this._restoreLetterInChat(message, html);
    });
  }

  /**
   * Find the sender name element in the chat card and re-append the letter.
   * @param {ChatMessage} message
   * @param {HTMLElement} html  — raw DOM element in V13+
   */
  static _restoreLetterInChat(message, html) {
    if (game.user.isGM) return;

    const letter = this._getSpeakerLetter(message);
    if (!letter) return;

    // Try to find the sender name element.
    // Foundry core: `.message-sender` contains the name directly or in children.
    // DnD5e 5.x:   `.message-sender > .name-stacked > .title`
    const senderEl = html.querySelector?.('.message-sender')
      ?? html.querySelector?.('header')?.firstElementChild;
    if (!senderEl) return;

    const nameEl = senderEl.querySelector('.title')
      || senderEl.querySelector('.name')
      || senderEl;

    this._appendLetterToElement(nameEl, letter);
  }

  // ---------------------------------------------------------------------------
  // Utility
  // ---------------------------------------------------------------------------

  /**
   * Extract a single-letter suffix from a real token/combatant name.
   * e.g. "Blade of Kyuss B" → "B", "Goblin" → null
   * @param {string} realName - the unmodified name (from `__name`)
   * @returns {string|null}
   */
  static _getLetterFromRealName(realName) {
    if (!realName || typeof realName !== 'string') return null;
    const match = realName.match(/ \[([A-Z])\]$/);
    return match ? match[1] : null;
  }

  /**
   * Walk text nodes inside an element and append the letter suffix to the first
   * non-empty text node that doesn't already end with it.
   * @param {HTMLElement} el
   * @param {string} letter
   */
  static _appendLetterToElement(el, letter) {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    let node;
    const suffix = `[${letter}]`;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim();
      if (text.length > 0 && !text.endsWith(suffix)) {
        node.textContent = `${node.textContent.trimEnd()} ${suffix}`;
        return;
      }
    }
  }

  /**
   * Get the letter suffix for a chat message's speaker token.
   * Uses `__name` (the real name, bypassing hide-npc-names' getter), with
   * a fallback to the combatant flag.
   * @param {ChatMessage} message
   * @returns {string|null}
   */
  static _getSpeakerLetter(message) {
    const speaker = message.speaker;
    if (!speaker?.token || !speaker?.scene) return null;

    const scene = game.scenes.get(speaker.scene);
    const token = scene?.tokens.get(speaker.token);
    if (!token) return null;

    // Primary: extract from the real name stored by hide-npc-names
    const letterFromName = this._getLetterFromRealName(token.__name);
    if (letterFromName) return letterFromName;

    // Fallback: look up the active combat's combatant flag
    const combat = game.combat;
    if (combat) {
      const combatant = combat.combatants.find(c => c.tokenId === token.id);
      if (combatant) {
        return combatant.getFlag(MODULE, FLAGS.COMBAT_LETTER) ?? null;
      }
    }

    return null;
  }
}
