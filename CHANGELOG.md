# Changelog

## 14.0.1

### Bug Fixes

- When a token already has a letter suffix, the module now correctly detects and uses that suffix, ensuring the correct active effect is applied and removing any mismatching active effects to prevent double-applying letters.
- **Compatibility:** Added a built-in patch for the `hide-npc-names` module so that letter suffixes are preserved alongside hidden names on the canvas, in the combat tracker, and in chat messages.

## 14.0.0

Initial release.

### Features

- Automatic alphabetical suffix renaming for duplicate NPC tokens in combat
- Color-coded active effects with letter icons (A–Z) for visual identification
- Stable letter ordering — letters don't shift when combatants are removed
- Support for late additions to combat
- Optional name restoration on combat end (enabled by default)
- Customizable letter colors via settings menu (26 distinct high-contrast defaults)
- Configurable icon storage directory (defaults to `assets/niks-token-tags`)
- DnD5e-specific NPC detection with system-agnostic fallback
- Foundry VTT V13 and V14 compatible
