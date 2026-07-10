# Nik's Token Tags

A [Foundry VTT](https://foundryvtt.com/) module that automatically renames duplicate NPC tokens in combat with alphabetical suffixes and applies color-coded letter effects for easy identification.

## Features

- **Automatic alphabetical suffixes** — When two or more tokens of the same NPC actor are in combat, they are renamed with letter suffixes (e.g., "Goblin A", "Goblin B", "Goblin C").
- **Color-coded active effects** — Each letter gets a distinct, high-contrast colored icon applied as an active effect on the token, making it easy to tell them apart at a glance.
- **Stable ordering** — Letters don't shift when a combatant is removed. If "Goblin B" is killed, "Goblin A" and "Goblin C" keep their letters.
- **Late additions supported** — Adding a new token of the same actor to an existing combat automatically assigns the next available letter.
- **Suffix cleanup** — If all but one duplicate is removed from combat, the remaining token's suffix and effect are automatically removed.
- **Optional name restoration** — A world setting allows restoring original token names when combat ends (enabled by default).
- **Customizable colors** — All 26 letter colors (background + text) can be configured per-world via the module settings.
- **DnD5e + system-agnostic** — Uses `actor.type === "npc"` for DnD5e, falls back to `!combatant.hasPlayerOwner` for other systems.

## Compatibility

- **Foundry VTT:** V13 – V14
- **Game System:** DnD5e 5.2+ (with system-agnostic fallback for other systems)

## Installation

### Via Manifest URL

1. In Foundry VTT, go to **Settings → Manage Modules → Install Module**
2. Paste the following manifest URL:
   ```
   https://github.com/nschoenwald/niks-token-tags/releases/latest/download/module.json
   ```
3. Click **Install**

### Manual Installation

1. Download the latest release from the [Releases page](https://github.com/nschoenwald/niks-token-tags/releases)
2. Extract the archive into your `Data/modules/` directory
3. Enable the module in your world

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| **Enable Token Tags** | ✅ On | Master toggle for the module |
| **Restore Names on Combat End** | ✅ On | Restore original token names and remove letter effects when combat is deleted |
| **Icon Storage Directory** | `assets/niks-token-tags` | Directory in user data where generated letter icons are stored |
| **Configure Colors** | — | Opens a configuration menu to customize the background and text color for each letter A–Z |

## How It Works

1. When a combatant is added to combat, the module checks if there are now ≥2 NPC combatants sharing the same base actor.
2. If so, each token in the group is renamed with an alphabetical suffix (A, B, C…Z, then wrapping back to A for 26+ duplicates).
3. A matching active effect with a colored letter icon is applied to each token for visual identification.
4. Both the token name (on the canvas) and the combatant name (in the combat tracker) are updated.

## Credits

The icon generation and active effect system in this module is inspired by and adapted from [Token Color Marker](https://github.com/Gundancer/foundryvtt-token-color-marker) by **Gundancer**. Thank you for the excellent reference implementation!

## License

This module is licensed under the [MIT License](LICENSE).
