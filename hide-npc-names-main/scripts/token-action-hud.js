import * as MODULE_CONFIG from "./config.js";
import { HideNPCNames } from "./hide-npc-names.js";

export class HNNTokenActionHud {

    static createTokenActionHudClasses(module) {
        game.hnn.HNNActionHandlerExtender = class HNNActionHandlerExtender extends module.api.ActionHandlerExtender {
            constructor(actionHandler) {
                super(actionHandler)
                this.actionHandler = actionHandler;
                this.actor = this.actionHandler.actor;
            }

            /**
             * @override
             */
            extendActionHandler() {
                // Update actor and token with current action handler context
                this.actor = this.actionHandler.actor;

                if (!game.user.isGM && !this.actor.isOwner) return;

                if (this.actor) {
                    const replacementInfo = HideNPCNames.getReplacementInfo(this.actor, this.actor.name);
                    const title = `${replacementInfo.shouldReplace
                        ? `${game.i18n.localize(`HNN.TAH.Hidden`)} (${replacementInfo.replacementName})`
                        : game.i18n.localize(`HNN.TAH.NotHidden`)}`;

                    let actionsData = [{
                        id: "hnnToggleHidden",
                        name: title,
                        img: `${MODULE_CONFIG.PATH}/assets/mask-solid.svg`,
                        encodedValue: MODULE_CONFIG.NAME,
                    }];
                    this.actionHandler.addActions(actionsData, { id: MODULE_CONFIG.NAME, type: 'system' })
                }

            }
        }

        game.hnn.HNNRollHandlerExtender = class HNNRollHandlerExtender extends module.api.RollHandlerExtender {
            /** @override */
            handleActionClick(event, encodedValue, actionHandler) {
                if (encodedValue !== MODULE_CONFIG.NAME) return false;
                HideNPCNames.toggleActorHidden(actionHandler.actor);
                return true;
            }
        }
    }

    static registerDefaults(defaults) {
        defaults.groups.push({
            id: MODULE_CONFIG.NAME,
            name: MODULE_CONFIG.TITLE,
            listName: `Group: ${MODULE_CONFIG.TITLE}`,
            type: "system"
        });
    }
}