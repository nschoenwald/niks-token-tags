import * as MODULE_CONFIG from "./config.js";
import { Utils } from "./utils.js";

export class ActorForm extends FormApplication {
    constructor(object, options={}) {
        super(object, options);
        this.baseActor = Utils.getBaseActor(object);
    }

    /**
     * Default Options for the form
     */
    static get defaultOptions() {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "hide-names-actor",
            title: game.i18n.localize("HNN.ActorForm.Title"),
            template: MODULE_CONFIG.DEFAULT_CONFIG.templates.actorForm,
            classes: ["sheet"],
            width: "auto",
            height: "auto",
            resizable: false,
            closeOnSubmit: true
        });
    }

    /**
     * Get data for the form
     */
    getData() {
        const baseActor = this.baseActor;
        const dispositionEnum = baseActor?.prototypeToken?.disposition;
        const disposition = Utils.getKeyByValue(CONST.TOKEN_DISPOSITIONS, dispositionEnum);
        const dispositionString = game.i18n.localize(`TOKEN.DISPOSITION.${disposition}`);
        const hideSetting = Utils.getSetting(MODULE_CONFIG.SETTING_KEYS[`hide${disposition.titleCase()}`]);
        const hideSettingString = hideSetting ? game.i18n.localize("HNN.ActorForm.Hidden") : game.i18n.localize("HNN.ActorForm.Revealed");
        const nameHiddenOverride = Utils.getModuleFlag(baseActor, MODULE_CONFIG.FLAGS.nameHiddenOverride);
        const nameHidden = nameHiddenOverride ?? hideSetting;
        const replacementSetting = Utils.getSetting(MODULE_CONFIG.SETTING_KEYS[disposition.toLowerCase() + `NameReplacement`]);
        const replacementNameOverride = Utils.getModuleFlag(baseActor, MODULE_CONFIG.FLAGS.replacementNameOverride);
        const replacementName = replacementNameOverride ?? replacementSetting;

        return {
            nameHidden,
            hideSettingString,
            dispositionString,
            replacementName
        }
    }

    /**
     * Attach listeners for events
     * @param {*} html
     */
    activateListeners(html) {
        const saveButton = html.find("button[name='save']");
        const clearButton = html.find("button[name='clear']");
        const cancelButton = html.find("button[name='cancel']");

        saveButton.on("click", event => this.onClickSave(event));
        clearButton.on("click", event => this.onClickClear(event));
        cancelButton.on("click", event => this.close());
    }

    /**
     * Save button click handler
     * @param {*} event
     */
    onClickSave(event) {
        this.submit();
    }

    /**
     * Save button click handler
     * @param {*} event
     */
    async onClickClear(event) {
        await this.baseActor.update({
            [`flags.${MODULE_CONFIG.NAME}.-=${MODULE_CONFIG.FLAGS.nameHiddenOverride}`] : null,
            [`flags.${MODULE_CONFIG.NAME}.-=${MODULE_CONFIG.FLAGS.replacementNameOverride}`] : null
        });
        this.close();
    }

    /**
     * Update the object on submit
     * @param {*} formData
     */
    async _updateObject(event, formData) {
        const hideName = formData[`hide-name`];
        const replacementName = formData[`replacement-name`];

        await this.baseActor.update({
            [`flags.${MODULE_CONFIG.NAME}.${MODULE_CONFIG.FLAGS.nameHiddenOverride}`] : hideName ?? false,
            [`flags.${MODULE_CONFIG.NAME}.${MODULE_CONFIG.FLAGS.replacementNameOverride}`] : replacementName ?? null
        });
    }
}