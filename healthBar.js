import { Graphics } from 'pixi.js';

/**
 * HealthBarDisplay class for managing entity health bars in the game.
 */
export default class HealthBarDisplay {
    /**
     * Creates a new HealthBarDisplay instance.
     * @param {PIXI.Container} containerParent - The PIXI.Container to add the health bar graphics to.
     * @param {PIXI.Sprite} spriteToFollow - The PIXI.Sprite whose position/dimensions the health bar should follow.
     * @param {Game} gameInstance - The game instance for accessing configuration.
     */
    constructor(containerParent, spriteToFollow, gameInstance) {
        this.containerParent = containerParent; // Renamed from parentVisual for clarity
        this.spriteToFollow = spriteToFollow;
        this.gameInstance = gameInstance;
        this.graphics = new Graphics();
        this.healthBarConfig = null;

        if (this.containerParent && typeof this.containerParent.addChild === 'function') {
            this.containerParent.addChild(this.graphics);
        } else {
            console.error('HealthBarDisplay: Invalid containerParent provided or it lacks an addChild method. Health bar will not be attached.');
            return; 
        }

        const rawConfig = this.gameInstance.getHealthBarConfig();

        if (rawConfig) {
            this.healthBarConfig = {
                width: parseInt(rawConfig.width, 10),
                height: parseInt(rawConfig.height, 10),
                borderThickness: parseInt(rawConfig.borderThickness, 10),
                borderColor: parseInt(rawConfig.borderColor.replace("#", ""), 16),
                healthyColor: parseInt(rawConfig.healthyColor.replace("#", ""), 16),
                damagedColor: parseInt(rawConfig.damagedColor.replace("#", ""), 16)
            };
        } else {
            console.error('HealthBarDisplay: Failed to get health bar configuration. Health bar will not render correctly.');
        }
    }

    /**
     * Updates the health bar display.
     * @param {number} currentHp - Current health points.
     * @param {number} maxHp - Maximum health points.
     */
    update(currentHp, maxHp) {
        if (!this.graphics || !this.healthBarConfig || !this.spriteToFollow) {
            return;
        }

        this.graphics.clear();

        if (maxHp <= 0) return;
        const saneHp = Math.max(0, Math.min(currentHp, maxHp));
        if (saneHp >= maxHp || saneHp <= 0) return;

        const targetSprite = this.spriteToFollow; // Use the explicitly passed sprite
        const config = this.healthBarConfig;

        if (typeof targetSprite.width === 'undefined' || typeof targetSprite.height === 'undefined') {
            console.warn('HealthBarDisplay.update: spriteToFollow is invalid or lacks dimensions.');
            return;
        }

        const parentDisplayWidth = targetSprite.width;
        const parentDisplayHeight = targetSprite.height;
        const parentAnchorX = targetSprite.anchor ? targetSprite.anchor.x : 0.5;
        const parentAnchorY = targetSprite.anchor ? targetSprite.anchor.y : 0.5;

        const healthBarActualWidth = config.width;
        const healthBarActualHeight = config.height;
        const padding = 5;

        // Position the graphics object itself. Drawing within it will be at 0,0.
        this.graphics.x = targetSprite.x - (healthBarActualWidth / 2) - (parentDisplayWidth * (parentAnchorX - 0.5));
        this.graphics.y = targetSprite.y - (parentDisplayHeight * parentAnchorY) - healthBarActualHeight - padding;
        
        const healthPercentage = saneHp / maxHp;

        this.graphics.rect(0, 0, healthBarActualWidth, healthBarActualHeight);
        if (config.borderThickness > 0) {
            this.graphics.stroke({ 
                width: config.borderThickness, 
                color: config.borderColor, 
                alignment: 0.5 
            });
        }
        this.graphics.fill({ color: config.damagedColor });
        
        this.graphics.rect(0, 0, healthBarActualWidth * healthPercentage, healthBarActualHeight);
        this.graphics.fill({ color: config.healthyColor });
    }

    /**
     * Sets the visibility of the health bar.
     * @param {boolean} isVisible - Whether the health bar should be visible.
     */
    setVisible(isVisible) {
        if (this.graphics) {
            this.graphics.visible = isVisible;
        }
    }

    /**
     * Destroys the health bar display.
     */
    destroy() {
        if (this.graphics) {
            if (this.containerParent && typeof this.containerParent.removeChild === 'function') {
                this.containerParent.removeChild(this.graphics);
            }
            this.graphics.destroy();
            this.graphics = null;
        }
        this.healthBarConfig = null;
        this.spriteToFollow = null;
        this.containerParent = null; 
    }
} 