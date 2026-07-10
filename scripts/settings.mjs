import { MODULE } from './const.mjs';

/**
 * Default color palette for letters A–Z.
 * Each entry has a background hex and text hex chosen for high contrast and visual distinction.
 */
export const DEFAULT_COLORS = {
  A: { bg: '#E53935', text: '#FFFFFF' },
  B: { bg: '#1E88E5', text: '#FFFFFF' },
  C: { bg: '#43A047', text: '#FFFFFF' },
  D: { bg: '#FB8C00', text: '#FFFFFF' },
  E: { bg: '#8E24AA', text: '#FFFFFF' },
  F: { bg: '#00ACC1', text: '#FFFFFF' },
  G: { bg: '#FFB300', text: '#000000' },
  H: { bg: '#D81B60', text: '#FFFFFF' },
  I: { bg: '#3949AB', text: '#FFFFFF' },
  J: { bg: '#7CB342', text: '#000000' },
  K: { bg: '#6D4C41', text: '#FFFFFF' },
  L: { bg: '#00897B', text: '#FFFFFF' },
  M: { bg: '#C0CA33', text: '#000000' },
  N: { bg: '#5E35B1', text: '#FFFFFF' },
  O: { bg: '#F4511E', text: '#FFFFFF' },
  P: { bg: '#039BE5', text: '#FFFFFF' },
  Q: { bg: '#757575', text: '#FFFFFF' },
  R: { bg: '#E91E63', text: '#FFFFFF' },
  S: { bg: '#00BCD4', text: '#000000' },
  T: { bg: '#FF7043', text: '#FFFFFF' },
  U: { bg: '#5C6BC0', text: '#FFFFFF' },
  V: { bg: '#66BB6A', text: '#000000' },
  W: { bg: '#AB47BC', text: '#FFFFFF' },
  X: { bg: '#26A69A', text: '#FFFFFF' },
  Y: { bg: '#FFCA28', text: '#000000' },
  Z: { bg: '#78909C', text: '#FFFFFF' },
};

export class Settings {
  static ENABLED = 'enabled';
  static RESTORE_ON_COMBAT_END = 'restoreOnCombatEnd';
  static ICON_DIRECTORY = 'iconDirectory';
  static COLORS = 'colors';

  /**
   * Register all module settings.
   * @param {typeof import('./color-config.mjs').ColorConfig} ColorConfigClass
   */
  static registerSettings(ColorConfigClass) {
    game.settings.register(MODULE, this.ENABLED, {
      name: `${MODULE}.settings.enabled.Name`,
      hint: `${MODULE}.settings.enabled.Hint`,
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE, this.RESTORE_ON_COMBAT_END, {
      name: `${MODULE}.settings.restoreOnCombatEnd.Name`,
      hint: `${MODULE}.settings.restoreOnCombatEnd.Hint`,
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(MODULE, this.ICON_DIRECTORY, {
      name: `${MODULE}.settings.iconDirectory.Name`,
      hint: `${MODULE}.settings.iconDirectory.Hint`,
      scope: 'world',
      config: true,
      type: String,
      default: 'assets/niks-token-tags',
      requiresReload: true,
    });

    game.settings.register(MODULE, this.COLORS, {
      scope: 'world',
      config: false,
      type: Object,
      default: DEFAULT_COLORS,
    });

    game.settings.registerMenu(MODULE, 'color-config-menu', {
      name: `${MODULE}.settings.colorConfigMenu.Name`,
      label: `${MODULE}.settings.colorConfigMenu.Label`,
      hint: `${MODULE}.settings.colorConfigMenu.Hint`,
      icon: 'fas fa-palette',
      type: ColorConfigClass,
      restricted: true,
    });
  }

  /**
   * Get the color configuration for a specific letter.
   * @param {string} letter - Single uppercase letter
   * @returns {{ bg: string, text: string }}
   */
  static getLetterColor(letter) {
    const colors = game.settings.get(MODULE, this.COLORS);
    return colors[letter] ?? DEFAULT_COLORS[letter] ?? { bg: '#757575', text: '#FFFFFF' };
  }

  /**
   * Get the full color map.
   * @returns {Object}
   */
  static getColors() {
    return game.settings.get(MODULE, this.COLORS);
  }

  /**
   * Get the configured icon storage directory path.
   * @returns {string}
   */
  static getIconDirectory() {
    return game.settings.get(MODULE, this.ICON_DIRECTORY);
  }
}
