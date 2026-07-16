# Changelog

## 14.1.2

### Features

- Updated the default token suffix format from ` A` to ` [A]` (e.g. `Goblin [A]`). This bracketed format is a common convention and naturally prevents 3rd party modules like `hide-npc-names` from accidentally censoring single standalone letters in chat messages.

### Bug Fixes

- **Compatibility:** Prevented `hide-npc-names` from aggressively censoring single standalone letters (like the "A" in "A pinch of sulfur") in chat messages when the speaker token has a token tag suffix.

## 14.1.1

### Bug Fixes

* Suppressed scrolling status text when applying or removing letter effects.

### Improvements

* Ensured same enemy types are grouped together sequentially when "Unique letters globally" is enabled (e.g., Bugbear A, Bugbear B, Goblin C, Goblin D).

## 14.1.0

### Features

* Made the module system-agnostic by removing the strict dependency on `dnd5e`.
* Added dedicated support for Pathfinder 2e (`pf2e`) and Shadowdark (`shadowdark`) to accurately detect their NPC actor types.

## 14.0.2

### Features

* Add a new setting (default on) that gives unique letters across all types of actors. Example: Goblin A, Goblin B, Hobgoblin C, Hobgoblin D, Hobgoblin E.
* Add a new setting (default on) to optionally include unique creatures (singletons) in the lettering.

# 14.0.1

### Features

- Added a client-scoped "Debug Logging" setting (defaulting to off) to gate console logs.

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
