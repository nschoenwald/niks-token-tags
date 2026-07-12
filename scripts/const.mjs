export const MODULE = 'niks-token-tags';

export const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

export const FLAGS = {
  ORIGINAL_NAME: 'originalName',
  COMBAT_LETTER: 'combatLetter',
};

/**
 * Log a message to the console, prefixed with the module name.
 * @param  {...any} args
 */
export function log(...args) {
  try {
    if (!game?.settings?.get(MODULE, 'debug')) return;
  } catch (e) {
    return; // Don't log if settings aren't initialized yet
  }
  console.log(`${MODULE} |`, ...args);
}
