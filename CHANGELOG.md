# Changelog

## 14.1.5

### Bug Fixes

- **Token Placement Fix:** Eliminated circular reference recursion in letter extraction between synthetic actors and unlinked token documents (`token.actor.token`), resolving a `Maximum call stack size exceeded` error that prevented NPC tokens from being placed on the canvas.
- **Getter Safety:** Ensured token duplicate number resolution inside `HideNPCNames.getReplacementName` accesses `__name` or `_source.name` directly, preventing re-invocation of the document name getter.

## 14.1.4

### Improvements & Bug Fixes

- **Compatibility (hide-npc-names):** Comprehensive compatibility overhaul to ensure token tag suffixes (e.g. `[A]`) are never censored or stripped by `hide-npc-names` anywhere:
  - **Dynamic Class Patching:** Dynamically resolves and patches `HideNPCNames.getReplacementName`, `HideNPCNames.getReplacementInfo`, and `HideNPCNames.updateChatMessage`.
  - **Token & Combatant Names:** `token.name` and `combatant.name` now properly return the replacement name *with* the letter suffix for players (e.g. `Unknown Creature [A]`), ensuring native canvas nameplates, hover tooltips, targeting, and third-party UI modules reflect the token tag.
  - **Chat Message Censor Protection:** `HideNPCNames.updateChatMessage` now matches full tagged names as a whole and isolates base name parts when `hideParts` is enabled, explicitly excluding standalone letter tags (`[A]`) and single letters from match terms. This prevents redacting formulas, tooltips, descriptions, or normal text containing the letter.
  - **Combat Tracker:** Fixed an early-return bug in the combat tracker walk and ensured the tag suffix is always displayed for all tagged combatants.
  - **Canvas Nameplates:** Handles both player views and GM views (including when `hide-npc-names` appends `[Hidden]`).
  - **Multi-layer Fallback:** Added system-wide hook fallbacks covering both core Foundry chat and `dnd5e.renderChatMessage`.

## 14.1.3

### Bug Fixes

- **Compatibility (hide-npc-names):** Fixed an issue where the `hideParts` censor option in hide-npc-names would treat an NPC's single-letter suffix (e.g. `[A]`) as a match term, causing every occurrence of that letter in chat messages to be redacted. The previous patch was silently inert because it checked `window.HideNPCNames`, which is never set by hide-npc-names. The fix uses a two-layer approach: a direct monkey-patch of `HideNPCNames.updateChatMessage` via the module API at `ready` time, with a hook-based fallback that strips the suffix from `speaker.alias` before hide-npc-names' hook reads it.

## 14.1.2

### Improvements

- Updated the default token suffix format from ` A` to ` [A]` (e.g. `Goblin [A]`).

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
