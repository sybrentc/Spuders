/**
 * Represents the player's main base.
 */
export default class Base {
    /**
     * Static factory method to create and initialize a Base instance from a config file path.
     * @param {string} path - The path to the base configuration JSON file.
     * @returns {Promise<Base>} A promise that resolves with the initialized Base instance.
     */
    static async createFromPath(path) {
        console.log(`Base: Attempting to create from path: ${path}`);
        // 1. Fetch the configuration data
        const response = await fetch(path);
        if (!response.ok) {
            throw new Error(`Base.createFromPath: Failed to fetch base config from ${path}: ${response.statusText}`);
        }
        const config = await response.json();
        console.log(`Base: Config fetched successfully.`);

        // 2. Instantiate the base using the fetched config
        // Note: Constructor now primarily validates and assigns properties.
        const baseInstance = new Base(config);
        console.log(`Base: Instance created from config.`);

        // 3. Load necessary assets (like the sprite)
        // This is kept separate from constructor for async operations.
        await baseInstance.loadAssets();
        console.log(`Base: Assets loaded.`);
        
        // 4. Return the fully initialized instance
        return baseInstance;
    }

    /**
     * Constructor for the Base.
     * Should primarily focus on validating and setting properties from config.
     * Avoid async operations here if possible (use loadAssets for that).
     * @param {object} baseConfig - Configuration object (expected to be valid).
     */
    constructor(baseConfig) {
        // Validate required configuration fields
        if (!baseConfig) throw new Error("Base constructor requires a configuration object.");
        if (!baseConfig.stats?.hp) throw new Error("Base config requires 'stats.hp'.");
        if (!baseConfig.position?.x === undefined || !baseConfig.position?.y === undefined) throw new Error("Base config requires 'position.x' and 'position.y'."); // Check existence including 0
        if (!baseConfig.sprite?.path) throw new Error("Base config requires 'sprite.path'.");
        if (!baseConfig.sprite?.frameWidth) throw new Error("Base config requires 'sprite.frameWidth'.");
        if (!baseConfig.sprite?.frameHeight) throw new Error("Base config requires 'sprite.frameHeight'.");
        // Optional fields don't need strict checks, but we will remove defaults

        this.config = baseConfig; // Store the raw config

        // --- Core Stats ---
        this.maxHp = baseConfig.stats.hp;
        this.currentHp = this.maxHp;
        this._isDestroyed = false;

        // --- Display Properties ---
        this.x = baseConfig.position.x;
        this.y = baseConfig.position.y;
        this.anchorX = baseConfig.display?.anchorX;
        this.anchorY = baseConfig.display?.anchorY;
        this.scale = baseConfig.display?.scale;

        // --- Sprite Information (requires loading) ---
        this.spriteSheet = null; // Will hold the Image object
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
            this.spriteSheet = await this.loadSprite(this.spritePath);
            this.isLoaded = true;
            console.log(`Base: Successfully loaded sprite from ${this.spritePath}`);
        } catch (error) {
            console.error(`Base: Failed to load assets: ${error}`);
            this.isLoaded = false; // Ensure isLoaded is false on error
             // Re-throw to potentially stop game initialization if base sprite fails
            throw error;
        }
    }

    /**
     * Helper to load a sprite image.
     * @param {string} path - The path to the image file.
     * @returns {Promise<Image>} A promise that resolves with the loaded Image object.
     */
    loadSprite(path) {
        return new Promise((resolve, reject) => {
            const sprite = new Image();
            sprite.onload = () => resolve(sprite);
            sprite.onerror = (e) => reject(new Error(`Failed to load sprite: ${path}`));
            sprite.src = path;
        });
    }

    /**
     * Updates the base's state.
     * Currently placeholder - could be used for animations or passive effects.
     * @param {number} timestamp - The current high-resolution timestamp.
     * @param {number} deltaTime - The time elapsed since the last update (in milliseconds).
     */
    update(timestamp, deltaTime) {
        if (!this.isLoaded || this._isDestroyed) {
            return; // Don't update if not loaded or already destroyed
        }
        // Determine currentFrame based on HP percentage and total frames
        const hpPercentage = this.currentHp / this.maxHp;
        if (hpPercentage > 0) {
            this.currentFrame = this.totalFrames - Math.ceil(hpPercentage * this.totalFrames);
        } 
    }

    /**
     * Renders the base on the canvas.
     */
    render(ctx) {
        // Don't render if destroyed
        if (this._isDestroyed) {
            return;
        }

        // Check if assets are loaded and sprite dimensions are valid
        if (!this.isLoaded || !this.spriteSheet || this.frameWidth <= 0 || this.frameHeight <= 0) {
             // REMOVE DEBUG LOGGING FOR RENDER
             // console.log('Base Render: Skipping draw due to missing assets or invalid dimensions.');
             return;
        }

        // Calculate source x/y from the spritesheet based on currentFrame
        // Assumes frames are laid out horizontally
        const sourceX = this.currentFrame * this.frameWidth;
        const sourceY = 0; // Assuming single row spritesheet for now

        // Calculate destination position based on anchor point and scale
        const drawWidth = this.frameWidth * this.scale;
        const drawHeight = this.frameHeight * this.scale;
        const drawX = this.x - (drawWidth * this.anchorX);
        const drawY = this.y - (drawHeight * this.anchorY);
        
        // REMOVE DEBUG LOGGING FOR DRAW PARAMETERS
        // console.log(`Base Render Draw: sx=${sourceX}, sy=${sourceY}, sw=${this.frameWidth}, sh=${this.frameHeight}, dx=${drawX}, dy=${drawY}, dw=${drawWidth}, dh=${drawHeight}`);

        // Draw the specific frame
        try {
            ctx.drawImage(
                this.spriteSheet,
                sourceX,
                sourceY,
                this.frameWidth,
                this.frameHeight,
                drawX,
                drawY,
                drawWidth,
                drawHeight
            );
        } catch (e) {
             // Keep this error reporting for actual draw errors
             console.error("Error during Base ctx.drawImage:", e);
             console.error("Draw arguments:", { spriteSheet: this.spriteSheet, sourceX, sourceY, frameWidth: this.frameWidth, frameHeight: this.frameHeight, drawX, drawY, drawWidth, drawHeight });
        }
    }

    /**
     * Applies damage to the base.
     * @param {number} amount - The amount of damage to inflict.
     */
    takeDamage(amount) {
        if (this._isDestroyed) {
            return; // Cannot damage a destroyed base
        }
        this.currentHp -= amount;
        console.log(`Base took ${amount} damage, HP remaining: ${this.currentHp}/${this.maxHp}`);
        if (this.currentHp <= 0) {
            this.currentHp = 0;
            this._isDestroyed = true;
            console.log("Base has been destroyed!");
            this.die(); // Call the die method
        }
    }

    /**
     * Placeholder method for when the base is destroyed.
     */
    die() {
        // TODO: Implement base destruction logic (e.g., remove from game, trigger game over)
        console.log("Base die() method called.");
    }

    /**
     * Checks if the base is destroyed.
     * @returns {boolean} True if the base's HP is 0 or less.
     */
    isDestroyed() {
        return this._isDestroyed;
    }

    /**
     * Applies parameter updates received from the TuningManager.
     * @param {object} newData - The new configuration data fetched from base.json.
     */
    applyParameterUpdates(newData) {
        let configChanged = false; // Flag to track if any relevant config changed

        // --- Update Stats (HP) --- 
        if (newData.stats) { // Check if stats object exists
            if (newData.stats.hp !== undefined && newData.stats.hp !== this.maxHp) {
                const oldMaxHp = this.maxHp;
                this.maxHp = newData.stats.hp;
                console.log(`Base Max HP updated from ${oldMaxHp} to ${this.maxHp}`);
                if (this.currentHp > this.maxHp) {
                    this.currentHp = this.maxHp; // Clamp current HP
                }
                if (this.maxHp > 0 && this.currentHp > 0 && this._isDestroyed) {
                    this._isDestroyed = false; // Revive if HP tuned above 0
                    console.log("Base revived by parameter update.");
                }
                configChanged = true;
            }
             // Add logic for other stats here if needed in the future
        } else {
            console.warn("Base received parameter update data without 'stats' object.");
        }

        // --- Update Position --- 
        if (newData.position) { // Check if position object exists
            if (newData.position.x !== undefined && newData.position.x !== this.x) {
                console.log(`Base position X updated from ${this.x} to ${newData.position.x}`);
                this.x = newData.position.x;
                configChanged = true;
            }
            if (newData.position.y !== undefined && newData.position.y !== this.y) {
                console.log(`Base position Y updated from ${this.y} to ${newData.position.y}`);
                this.y = newData.position.y;
                configChanged = true;
            }
        }

        // --- Update Display Properties --- 
        if (newData.display) { // Check if display object exists
            // Use nullish coalescing (??) to handle potential 0 values correctly
            const newAnchorX = newData.display.anchorX ?? this.anchorX;
            if (newAnchorX !== this.anchorX) {
                console.log(`Base anchorX updated from ${this.anchorX} to ${newAnchorX}`);
                this.anchorX = newAnchorX;
                configChanged = true;
            }
            const newAnchorY = newData.display.anchorY ?? this.anchorY;
             if (newAnchorY !== this.anchorY) {
                console.log(`Base anchorY updated from ${this.anchorY} to ${newAnchorY}`);
                this.anchorY = newAnchorY;
                configChanged = true;
            }
            const newScale = newData.display.scale ?? this.scale;
             if (newScale !== this.scale) {
                console.log(`Base scale updated from ${this.scale} to ${newScale}`);
                this.scale = newScale;
                configChanged = true;
            }
        }
        
        // --- Update internal config representation if anything changed --- 
        // This is important if other parts of the code might reference this.config
        if (configChanged) {
             console.log("Base: Updating internal config representation after parameter changes.");
             // Deep merge might be safer, but shallow merge is simpler for now
             this.config = { 
                 ...this.config, 
                 stats: { ...this.config.stats, ...newData.stats },
                 position: { ...this.config.position, ...newData.position },
                 display: { ...this.config.display, ...newData.display },
             };
             // Note: Does not merge sprite info as requested.
        }
    }
} 