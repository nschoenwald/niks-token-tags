import { MODULE, LETTERS } from './const.mjs';
import { Settings, DEFAULT_COLORS } from './settings.mjs';
import { IconGenerator } from './icon-generator.mjs';

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * Settings form for configuring the background and text colors for each letter A–Z.
 */
export class ColorConfig extends HandlebarsApplicationMixin(ApplicationV2) {
  static DEFAULT_OPTIONS = {
    id: 'niks-tt-color-config',
    tag: 'form',
    classes: ['standard-form'],

    form: {
      closeOnSubmit: false,
      submitOnChange: true,
    },

    position: {
      width: 520,
      height: 700,
    },

    window: {
      title: `${MODULE}.colorConfig.title`,
      resizable: true,
    },
  };

  static PARTS = {
    form: {
      template: `modules/${MODULE}/templates/color-config.hbs`,
      scrollable: ['.scroll-region'],
    },
  };

  /**
   * Prepare the template context with current color settings.
   * Uses client-side data URLs for preview icons (no dependency on uploaded files).
   */
  async _prepareContext(options) {
    const context = await super._prepareContext(options);
    const colors = Settings.getColors();

    context.letters = LETTERS.map(letter => {
      const color = colors[letter] ?? DEFAULT_COLORS[letter];
      return {
        letter,
        bg: color.bg,
        text: color.text,
        // Generate preview as data URL — always works, no file dependency
        iconDataUrl: IconGenerator.generateDataUrl(letter, color),
      };
    });

    return context;
  }

  /**
   * Set up event listeners after rendering.
   */
  _onRender(context, options) {
    super._onRender(context, options);

    // Color input change handlers
    this.element.querySelectorAll('input[data-field]').forEach(input => {
      input.addEventListener('change', this._onColorChange.bind(this));
    });

    // Reset to defaults button
    this.element.querySelector('#niks-tt-reset-defaults')?.addEventListener('click', this._onResetDefaults.bind(this));
  }

  /**
   * Handle a color input change — update the setting and regenerate the icon.
   * @param {Event} event
   */
  async _onColorChange(event) {
    const input = event.currentTarget;
    const letter = input.dataset.letter;
    const field = input.dataset.field; // 'bg' or 'text'
    const value = input.value;

    const colors = Settings.getColors();
    if (!colors[letter]) colors[letter] = { ...DEFAULT_COLORS[letter] };
    colors[letter][field] = value;

    await game.settings.set(MODULE, Settings.COLORS, colors);

    // Re-upload the icon file for use in active effects
    try {
      await IconGenerator.saveLetterIcon(letter, colors[letter], true);
      IconGenerator.refreshImages();
    } catch (e) {
      console.warn(`${MODULE} | Failed to regenerate icon for letter "${letter}":`, e);
    }

    this.render();
  }

  /**
   * Reset all colors to defaults and regenerate all icons.
   * @param {Event} event
   */
  async _onResetDefaults(event) {
    event.preventDefault();
    await game.settings.set(MODULE, Settings.COLORS, DEFAULT_COLORS);

    try {
      await IconGenerator.generateAllIcons(true);
    } catch (e) {
      console.warn(`${MODULE} | Failed to regenerate icons on reset:`, e);
    }

    this.render();
  }
}
