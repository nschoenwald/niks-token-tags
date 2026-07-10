import { MODULE, log } from './const.mjs';
import { Settings } from './settings.mjs';
import { ColorConfig } from './color-config.mjs';
import { IconGenerator } from './icon-generator.mjs';
import { CombatMarker } from './combat-marker.mjs';

log('Module loaded.');

Hooks.once('init', () => {
  Settings.registerSettings(ColorConfig);
});

Hooks.once('ready', async () => {
  // Only the GM should generate icon files
  if (game.user.isGM) {
    try {
      await IconGenerator.generateAllIcons(false);
    } catch (error) {
      console.error(`${MODULE} | Failed to generate letter icons:`, error);
    }
  }

  CombatMarker.registerHooks();
  log('Module ready.');
});
