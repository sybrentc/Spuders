import { Assets, Texture, Sprite, Rectangle, Graphics, Container, TextureSource } from 'pixi.js';
// import { drawHealthBar } from '../utils/renderUtils.js'; // REMOVED OLD IMPORT
import HealthBarDisplay from '../healthBar.js'; // Import the new HealthBarDisplay class

/**
 * Represents the player's main base.
 */
export default class Base extends EventTarget {
    /**
     * Static factory method to create and initialize a Base instance from a config file path.
     * @param {string} path - The path to the base configuration JSON file.
     * @param {Game} gameInstance - The main game instance.
     * @returns {Promise<Base>} A promise that resolves with the initialized Base instance.
     */
    static async createFromPath(path, gameInstance) {
        //console.log(`Base: Attempting to create from path: ${path}`);
        // 1. Fetch the configuration data
        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`Base.createFromPath: Failed to fetch base config from ${path}: ${response.statusText}`);
        }
        const config = await response.json();
        //console.log(`Base: Config fetched successfully.`);

        // 2. Instantiate the base using the fetched config, passing gameInstance
        const baseInstance = new Base(config, gameInstance);
        //console.log(`Base: Instance created from config.`);

        // 3. Load necessary assets (like the sprite)
        await baseInstance.loadAssets();
        //console.log(`Base: Assets loaded.`);
        
        // 4. Return the fully initialized instance
        return baseInstance;
    }

    /**
     * Constructor for the Base.
     * Should primarily focus on validating and setting properties from config.
     * Avoid async operations here if possible (use loadAssets for that).
     * @param {object} baseConfig - Configuration object (expected to be valid).
     * @param {Game} gameInstance - The main game instance.
     */
    constructor(baseConfig, gameInstance) {
        super(); // Call EventTarget constructor
        this.game = gameInstance; // Store the game instance
        // Validate required configuration fields
        if (!baseConfig) throw new Error("Base constructor requires a configuration object.");
        if (!baseConfig.stats?.hp) throw new Error("Base config requires 'stats.hp'.");
        if (baseConfig.stats?.money === undefined) throw new Error("Base config requires 'stats.money'."); // Add money validation
        if (!baseConfig.position?.x === undefined || !baseConfig.position?.y === undefined) throw new Error("Base config requires 'position.x' and 'position.y'."); // Check existence including 0
        if (!baseConfig.sprite?.path) throw new Error("Base config requires 'sprite.path'.");
        if (!baseConfig.sprite?.frameWidth) throw new Error("Base config requires 'sprite.frameWidth'.");
        if (!baseConfig.sprite?.frameHeight) throw new Error("Base config requires 'sprite.frameHeight'.");
        // Optional fields don't need strict checks, but we will remove defaults

        this.config = baseConfig; // Store the raw config

        // --- Core Stats ---
        this.stats = baseConfig.stats; // Assign the whole stats object
        this.maxHp = this.stats.hp;
        this.currentHp = this.maxHp;
        this._isDestroyed = false;
        this.startingFunds = this.stats.money; // Use this.stats now
        this.currentFunds = this.startingFunds;

        // --- Display Properties ---
        this.x = baseConfig.position.x;
        this.y = baseConfig.position.y;
        this.anchorX = baseConfig.display?.anchorX;
        this.anchorY = baseConfig.display?.anchorY;
        this.scale = baseConfig.display?.scale;

        // --- Sprite Information (requires loading) ---
        this.pixiSprite = null; // Will hold the PIXI.Sprite
        this.textures = []; // Will hold individual frame Textures
        // this.healthBarGraphic = null; // REMOVED OLD PROPERTY
        this.healthBarDisplay = null; // Will hold HealthBarDisplay instance (NEW)
        this.pixiContainer = null; // Will hold the main PIXI.Container for the base

        this.spritePath = baseConfig.sprite.path;
        this.frameWidth = baseConfig.sprite.frameWidth;
        this.frameHeight = baseConfig.sprite.frameHeight;
        this.currentFrame = 0;
        this.totalFrames = baseConfig.sprite.totalFrames; // Store total frames
        this.isLoaded = false;
    }

    /**
     * Loads the necessary assets for the base (e.g., sprite sheet).
     */
    async loadAssets() {
        // No sprite path check needed due to constructor validation
        try {
            const loadedAsset = await Assets.load(this.spritePath);
            let baseImageTextureSource = null;

            // Determine the TextureSource from the loaded asset
            if (loadedAsset instanceof Texture) {
                baseImageTextureSource = loadedAsset.source;
            } else if (loadedAsset.source && loadedAsset.source instanceof TextureSource) {
                baseImageTextureSource = loadedAsset.source;
            } else if (loadedAsset instanceof TextureSource) { // Assets.load might return TextureSource directly for some image types
                baseImageTextureSource = loadedAsset;
            } else {
                console.error("Base: Loaded asset for spritesheet is not a Texture or does not have a usable TextureSource.", loadedAsset);
                throw new Error("Base asset loading failed: Unexpected asset type for spritesheet processing.");
            }

            if (baseImageTextureSource) {
                for (let i = 0; i < this.totalFrames; i++) {
                    const frameX = i * this.frameWidth;
                    const frameY = 0; // Assuming single row
                    const frameRectangle = new Rectangle(frameX, frameY, this.frameWidth, this.frameHeight);
                    try {
                        // Create a new Texture for each frame
                        this.textures.push(new Texture({
                            source: baseImageTextureSource,
                            frame: frameRectangle
                        }));
                    } catch (texError) {
                        console.error(`Error creating texture for base frame ${i}:`, texError);
                    }
                }
            }

            if (this.textures.length === 0 && this.totalFrames > 0) { // Check if textures array is empty despite expecting frames
                console.error(`Base: No textures were created from spritesheet ${this.spritePath}. totalFrames: ${this.totalFrames}`);
                this.isLoaded = false;
                throw new Error(`Base asset loading failed: no textures from ${this.spritePath}`);
            }

            // Create and Configure PIXI.Container
            this.pixiContainer = new Container();
            this.pixiContainer.x = this.x;
            this.pixiContainer.y = this.y;

            // Create and Configure PIXI.Sprite
            if (this.textures.length > 0) {
                this.pixiSprite = new Sprite(this.textures[0]);
                this.pixiSprite.anchor.set(this.anchorX || 0.5, this.anchorY || 0.5);
                this.pixiSprite.scale.set(this.scale || 1.0);
                this.pixiContainer.addChild(this.pixiSprite);
            } else {
                console.error("Base: Cannot create pixiSprite, no textures loaded.");
                this.isLoaded = false;
                throw new Error("Base asset loading failed: Cannot create pixiSprite, no textures.");
            }

            // Initialize NEW HealthBarDisplay (NEW)
            if (this.game && this.pixiContainer && this.pixiSprite) {
                this.healthBarDisplay = new HealthBarDisplay(this.pixiContainer, this.pixiSprite, this.game);
            } else {
                console.error("Base.loadAssets: Cannot initialize HealthBarDisplay. Game instance, pixiContainer, or pixiSprite is missing.");
            }

            this.isLoaded = true;
            //console.log(`Base: Successfully loaded sprite from ${this.spritePath}`);
        } catch (error) {
            console.error(`Base: Failed to load assets: ${error}`);
            this.isLoaded = false; // Ensure isLoaded is false on error
             // Re-throw to potentially stop game initialization if base sprite fails
            throw error;
        }
    }

    /**
     * Updates the base's state.
     * Currently placeholder - could be used for animations or passive effects.
     * @param {number} timestamp - The current high-resolution timestamp.
     * @param {number} deltaTime - The time elapsed since the last update (in milliseconds).
     */
    update(timestamp, deltaTime) {
        if (!this.isLoaded || this._isDestroyed || !this.pixiSprite || !this.textures || this.textures.length === 0) { 
            return; 
        }
        // Determine currentFrame based on HP percentage and total frames
        const hpPercentage = this.currentHp / this.maxHp;
        let newFrame = 0;
        if (hpPercentage > 0) {
            newFrame = this.totalFrames - Math.ceil(hpPercentage * this.totalFrames);
        } else {
            newFrame = this.totalFrames -1; // Show most damaged frame if HP is 0 or less
        }

        this.currentFrame = Math.max(0, Math.min(newFrame, this.textures.length - 1)); // Use textures.length for bounds

        // Update the sprite's texture
        if (this.textures[this.currentFrame]) { 
            this.pixiSprite.texture = this.textures[this.currentFrame]; // Revert to assigning texture from array
        } else {
            console.warn(`Base.update: Texture not found for frame index ${this.currentFrame}`);
        }

        // --- REMOVED OLD Health Bar Drawing ---
        // if (this.healthBarGraphic) { ... }
        // --- END REMOVED OLD Health Bar Drawing ---

        // --- NEW HealthBarDisplay Update (NEW) ---
        if (this.healthBarDisplay) {
            this.healthBarDisplay.update(this.currentHp, this.maxHp);
        }
        // --- END NEW HealthBarDisplay Update ---
    }

    /**
     * Applies damage to the base.
     * @param {number} amount - The amount of damage to inflict.
     */
    takeDamage(amount) {
        if (this._isDestroyed) {
            return;
        }
        this.currentHp -= amount;
        if (this.currentHp <= 0) {
            this.currentHp = 0;
            if (!this._isDestroyed) {
                this.dispatchEvent(new CustomEvent('gameOver'));
            }
            this._isDestroyed = true;
            this.die();
            // Hide the entire base container (sprite + health bar)
            if (this.pixiContainer) {
                this.pixiContainer.visible = false;
            }
        }
    }

    /**
     * Placeholder method for when the base is destroyed.
     */
    die() {
        // console.log("Base die() method called.");
        // If we want to hide the sprite itself, we can do:
        // if (this.pixiContainer) this.pixiContainer.visible = false;
        // The old health bar graphic (this.healthBarGraphic) is part of pixiContainer,
        // so it would be hidden too. If we only want to hide the sprite but keep health bar:
        // if (this.pixiSprite) this.pixiSprite.visible = false;

        // For now, ensure the NEW health bar is explicitly hidden/destroyed if needed.
        // setVisible(false) is handled in takeDamage. If die() means permanent removal,
        // then destroy() would be more appropriate here, or in a separate cleanup method.
    }

    /**
     * Checks if the base is destroyed.
     * @returns {boolean} True if the base's HP is 0 or less.
     */
    isDestroyed() {
        return this._isDestroyed;
    }

    /**
     * Checks if the base has enough funds for a given cost.
     * @param {number} amount - The cost to check against.
     * @returns {boolean} True if funds are sufficient, false otherwise.
     */
    canAfford(amount) {
        return this.currentFunds >= amount;
    }

    /**
     * Attempts to spend funds if sufficient funds are available.
     * @param {number} amount - The amount to spend.
     * @returns {boolean} True if funds were spent successfully, false otherwise.
     */
    spendFunds(amount) {
        if (this.canAfford(amount)) {
            this.currentFunds -= amount;
            // Dispatch event AFTER funds are updated
            this.dispatchEvent(new CustomEvent('fundsUpdated'));
            // console.log(`Base: Spent ${amount} funds. Current: ${this.currentFunds}`);
            return true;
        }
        return false;
    }

    /**
     * Adds funds to the base's current total.
     * @param {number} amount - The amount to add.
     */
    addFunds(amount) {
        this.currentFunds += amount;
        // Dispatch event AFTER funds are updated
        this.dispatchEvent(new CustomEvent('fundsUpdated'));
        // console.log(`Base: Added ${amount} funds. Current: ${this.currentFunds}`);
    }

    /**
     * Resets the base to its initial state (full HP, starting funds).
     */
    reset() {
        // Make the base container visible again
        if (this.pixiContainer) {
            this.pixiContainer.visible = true;
        }
        this.currentHp = this.maxHp;
        this.currentFunds = this.startingFunds;
        this._isDestroyed = false;
        this.dispatchEvent(new CustomEvent('fundsUpdated')); 
        // Update the health bar display (its internal logic will show/hide based on HP)
        if (this.healthBarDisplay) {
            this.healthBarDisplay.update(this.currentHp, this.maxHp); 
        }
    }

    /**
     * Call this method when the Base instance is being permanently removed from the game.
     */
    destroySelf() {
        if (this.healthBarDisplay) {
            this.healthBarDisplay.destroy();
            this.healthBarDisplay = null;
        }
        if (this.pixiContainer) {
            this.pixiContainer.destroy({ children: true });
            this.pixiContainer = null;
        }
        this.textures = [];
        this.pixiSprite = null;
        // this.healthBarGraphic = null; // REMOVED OLD PROPERTY CLEANUP
        //console.log("Base: destroySelf() called and cleaned up.");
    }

    /**
     * Applies parameter updates received from the TuningManager.
     * @param {object} newData - The new configuration data fetched from base.json.
     */
    applyParameterUpdates(newData) {
        let configChanged = false; // Flag to track if any relevant config changed

        // --- Update Stats (HP, Money, Exchange Rate etc.) --- 
        if (newData.stats) { // Check if stats object exists
            // --- HP Update --- 
            if (newData.stats.hp !== undefined && newData.stats.hp !== this.stats.hp) { // Compare with this.stats.hp
                const oldMaxHp = this.maxHp;
                // Update both maxHp and the value within this.stats
                this.stats.hp = newData.stats.hp;
                this.maxHp = this.stats.hp; 
                //console.log(`Base Max HP updated from ${oldMaxHp} to ${this.maxHp}`);
                if (this.currentHp > this.maxHp) {
                    this.currentHp = this.maxHp; // Clamp current HP
                }
                if (this.maxHp > 0 && this.currentHp > 0 && this._isDestroyed) {
                    this._isDestroyed = false; // Revive if HP tuned above 0
                    //console.log("Base revived by parameter update.");
                }
                configChanged = true;
            }
            
            // --- Money Update --- 
             if (newData.stats.money !== undefined && newData.stats.money !== this.stats.money) { // Compare with this.stats.money
                 const oldStartingFunds = this.startingFunds;
                 // Update both startingFunds and the value within this.stats
                 this.stats.money = newData.stats.money;
                 const newStartingFunds = this.stats.money;
                 const delta = newStartingFunds - oldStartingFunds;

                 //console.log(`Base startingFunds updated from ${oldStartingFunds} to ${newStartingFunds} (Delta: ${delta})`);
                 
                 this.startingFunds = newStartingFunds; // Update the stored starting funds value
                 this.currentFunds += delta; // Apply the difference to the actual current funds

                 // Ensure currentFunds don't drop below zero due to tuning, though unlikely
                 if (this.currentFunds < 0) {
                    console.warn(`Base currentFunds dropped below zero (${this.currentFunds}) after tuning adjustment. Clamping to 0.`);
                    this.currentFunds = 0;
                 }
                 //console.log(`Base currentFunds adjusted by ${delta}. New currentFunds: ${this.currentFunds}`);
                 
                 configChanged = true;
             }

             // --- Cost Factor Update (Renamed from Exchange Rate) --- 
             if (newData.stats.costFactor !== undefined && newData.stats.costFactor !== this.stats.costFactor) {
                 const oldFactor = this.stats.costFactor;
                 this.stats.costFactor = newData.stats.costFactor; // Update the value in this.stats
                 //console.log(`Base costFactor updated from ${oldFactor} to ${this.stats.costFactor}`);
                 configChanged = true;
             }

             // --- Bounty Factor Update ---
             if (newData.stats.bountyFactor !== undefined && newData.stats.bountyFactor !== this.stats.bountyFactor) {
                 const oldFactor = this.stats.bountyFactor;
                 this.stats.bountyFactor = newData.stats.bountyFactor; // Update the value in this.stats
                 //console.log(`Base bountyFactor updated from ${oldFactor} to ${this.stats.bountyFactor}`);
                 configChanged = true;
                 // Note: EnemyManager/PriceManager will pick this up automatically.
             }

             // Add other stats updates here...

        } else {
            console.warn("Base received parameter update data without 'stats' object.");
        }

        // --- Update Position --- 
        if (newData.position) { // Check if position object exists
            if (newData.position.x !== undefined && newData.position.x !== this.x) {
                //console.log(`Base position X updated from ${this.x} to ${newData.position.x}`);
                this.x = newData.position.x;
                configChanged = true;
            }
            if (newData.position.y !== undefined && newData.position.y !== this.y) {
                //console.log(`Base position Y updated from ${this.y} to ${newData.position.y}`);
                this.y = newData.position.y;
                configChanged = true;
            }
        }

        // --- Update Display Properties --- 
        if (newData.display) { // Check if display object exists
            // Use nullish coalescing (??) to handle potential 0 values correctly
            const newAnchorX = newData.display.anchorX ?? this.anchorX;
            if (newAnchorX !== this.anchorX) {
                //console.log(`Base anchorX updated from ${this.anchorX} to ${newAnchorX}`);
                this.anchorX = newAnchorX;
                configChanged = true;
            }
            const newAnchorY = newData.display.anchorY ?? this.anchorY;
             if (newAnchorY !== this.anchorY) {
                //console.log(`Base anchorY updated from ${this.anchorY} to ${newAnchorY}`);
                this.anchorY = newAnchorY;
                configChanged = true;
            }
            const newScale = newData.display.scale ?? this.scale;
             if (newScale !== this.scale) {
                //console.log(`Base scale updated from ${this.scale} to ${newScale}`);
                this.scale = newScale;
                configChanged = true;
            }
        }
        
        // --- Update internal config representation if anything changed --- 
        // This section is now LESS critical as we update this.stats directly,
        // but keep it if other parts rely on this.config
        if (configChanged) {
             //console.log("Base: Updating internal config representation after parameter changes.");
             // Deep merge might be safer, but shallow merge is simpler for now
             this.config = { 
                 ...this.config, 
                 // Ensure the stats object within config is also updated
                 stats: { ...this.stats }, // Use the updated this.stats
                 position: { ...this.config.position, ...newData.position },
                 display: { ...this.config.display, ...newData.display },
             };
             // Note: Does not merge sprite info as requested.
        }
    }
} 