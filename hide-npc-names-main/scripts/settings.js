import * as MODULE_CONFIG from "./config.js";
import { Utils } from "./utils.js";

export function registerSettings() {

    Utils.registerSetting(MODULE_CONFIG.SETTING_KEYS.hideHostile, {
        name: "HNN.Settings.HideHostileN",
        hint: "HNN.Settings.HideHostileH",
        scope: "world",
        type: Boolean,
        default: MODULE_CONFIG.DEFAULT_CONFIG.hideHostile,
        config: true,
        requiresReload: true
    });

    Utils.registerSetting(MODULE_CONFIG.SETTING_KEYS.hideNeutral, {
        name: "HNN.Settings.HideNeutralN",
        hint: "HNN.Settings.HideNeutralH",
        scope: "world",
        type: Boolean,
        default: MODULE_CONFIG.DEFAULT_CONFIG.hideNeutral,
        config: true,
        requiresReload: true
    });

    Utils.registerSetting(MODULE_CONFIG.SETTING_KEYS.hideFriendly, {
        name: "HNN.Settings.HideFriendlyN",
        hint: "HNN.Settings.HideFriendlyH",
        scope: "world",
        type: Boolean,
        default: MODULE_CONFIG.DEFAULT_CONFIG.hideFriendly,
        config: true,
        requiresReload: true
    });

    Utils.registerSetting(MODULE_CONFIG.SETTING_KEYS.hideSecret, {
        name: "HNN.Settings.HideSecretN",
        hint: "HNN.Settings.HideSecretH",
        scope: "world",
        type: Boolean,
        default: MODULE_CONFIG.DEFAULT_CONFIG.hideSecret,
        config: true,
        requiresReload: true
    });

    Utils.registerSetting(MODULE_CONFIG.SETTING_KEYS.hideParts, {
        name: "HNN.Settings.HidePartsN",
        hint: "HNN.Settings.HidePartsH",
        scope: "world",
        type: Boolean,
        default: MODULE_CONFIG.DEFAULT_CONFIG.hideParts,
        config: true,
        requiresReload: true
    });

    Utils.registerSetting(MODULE_CONFIG.SETTING_KEYS.showOnActorDirectory, {
        name: "HNN.Settings.ShowOnActorDirectoryN",
        hint: "HNN.Settings.ShowOnActorDirectoryH",
        scope: "world",
        type: Boolean,
        default: MODULE_CONFIG.DEFAULT_CONFIG.showOnActorDirectory,
        config: true,
        onChange: s => {
            ui.actors.render(true);
        }
    });

    Utils.registerSetting(MODULE_CONFIG.SETTING_KEYS.showOnTokenHUD, {
        name: "HNN.Settings.ShowOnTokenHUDN",
        hint: "HNN.Settings.ShowOnTokenHUDH",
        scope: "world",
        type: Boolean,
        default: MODULE_CONFIG.DEFAULT_CONFIG.showOnTokenHUD,
        config: true,
    });

    Utils.registerSetting(MODULE_CONFIG.SETTING_KEYS.hostileNameReplacement, {
        name: "HNN.Settings.HostileReplacementN",
        hint: "HNN.Settings.HostileReplacementH",
        scope: "world",
        type: String,
        default: game.i18n.localize(MODULE_CONFIG.DEFAULT_CONFIG.nameReplacement),
        config: true,
        requiresReload: true
    });

    Utils.registerSetting(MODULE_CONFIG.SETTING_KEYS.neutralNameReplacement, {
        name: "HNN.Settings.NeutralReplacementN",
        hint: "HNN.Settings.NeutralReplacementH",
        scope: "world",
        type: String,
        default: game.i18n.localize(MODULE_CONFIG.DEFAULT_CONFIG.nameReplacement),
        config: true,
        requiresReload: true
    });

    Utils.registerSetting(MODULE_CONFIG.SETTING_KEYS.friendlyNameReplacement, {
        name: "HNN.Settings.FriendlyReplacementN",
        hint: "HNN.Settings.FriendlyReplacementH",
        scope: "world",
        type: String,
        default: game.i18n.localize(MODULE_CONFIG.DEFAULT_CONFIG.nameReplacement),
        config: true,
        requiresReload: true
    });

    Utils.registerSetting(MODULE_CONFIG.SETTING_KEYS.secretNameReplacement, {
        name: "HNN.Settings.SecretReplacementN",
        hint: "HNN.Settings.SecretReplacementH",
        scope: "world",
        type: String,
        default: game.i18n.localize(MODULE_CONFIG.DEFAULT_CONFIG.nameReplacement),
        config: true,
        requiresReload: true
    });

    Utils.registerSetting(MODULE_CONFIG.SETTING_KEYS.tokenHiddenSuffix, {
        name: "HNN.Settings.TokenNameHiddenSuffixN",
        hint: "HNN.Settings.TokenNameHiddenSuffixH",
        scope: "world",
        type: String,
        default: game.i18n.localize(MODULE_CONFIG.DEFAULT_CONFIG.tokenHiddenSuffix),
        config: true,
        requiresReload: true
    });
}