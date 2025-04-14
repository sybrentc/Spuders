import Enemy from './models/enemy.js'; // EnemyManager needs to know about Enemy

export default class EnemyManager {
    constructor(enemyDataPath, pathData, base) {
        if (!enemyDataPath) {
            throw new Error("EnemyManager requires an enemyDataPath.");
        }
        if (!pathData) {
            // Or handle this more gracefully depending on whether pathData is always expected
            console.warn("EnemyManager created without pathData. Waypoints might be missing for enemies.");
        }
        if (!base) {
             throw new Error("EnemyManager requires a Base instance.");
        }
        this.enemyDataPath = enemyDataPath; // Path to load definitions
        this.pathData = pathData;           // Waypoints for enemies
        this.base = base;                   // Store reference to the Base instance

        this.enemyTypes = {};       // Stores enemy definitions/blueprints
        this.enemySprites = {};     // Stores loaded sprite Images keyed by enemyTypeId
        this.activeEnemies = [];    // Stores active Enemy instances on the map
        this.isLoaded = false;      // Flag to indicate if definitions are loaded
    }

    // Method to load initial data (was loadEnemyTypes in Game.js)
    async load() {
        // Renamed from loadEnemyTypes, uses this.enemyDataPath
        try {
            const response = await fetch(this.enemyDataPath);
            const enemyDefinitions = await response.json();

            console.log(`EnemyManager: Loading ${enemyDefinitions.length} enemy types from ${this.enemyDataPath}`);

            // Load sprites and store definitions
            for (const enemyDef of enemyDefinitions) {
                // Load sprite image for this enemy type
                const sprite = await this.loadSprite(enemyDef.sprite.path);
                this.enemySprites[enemyDef.id] = sprite;

                // Store the enemy definition
                this.enemyTypes[enemyDef.id] = enemyDef;

                // console.log(`EnemyManager: Loaded enemy type: ${enemyDef.name}`); // Less verbose
            }

            this.isLoaded = true;
            console.log('EnemyManager: All enemy types loaded successfully.');
            return true;
        } catch (error) {
            console.error('EnemyManager: Error loading enemy types:', error);
            this.isLoaded = false;
            throw error; // Re-throw so Game.initialize can catch it if needed
        }
    }

    // Method to load sprites (moved from Game.js)
    loadSprite(path) {
        return new Promise((resolve, reject) => {
            const sprite = new Image();
            sprite.onload = () => resolve(sprite);
            sprite.onerror = (e) => reject(new Error(`EnemyManager: Failed to load sprite: ${path}`));
            sprite.src = path;
        });
    }

    // Factory method to create enemies (moved from Game.js)
    createEnemy(enemyTypeId, startIndex = 0) {
        if (!this.isLoaded) {
            console.error(`EnemyManager: Cannot create enemy ${enemyTypeId}. Manager not loaded yet.`);
            return null;
        }
        if (!this.enemyTypes[enemyTypeId]) {
            console.error(`EnemyManager: Enemy type ${enemyTypeId} not found`);
            return null;
        }

        const enemyDef = this.enemyTypes[enemyTypeId];
        const sprite = this.enemySprites[enemyTypeId];

        if (!sprite) {
            console.error(`EnemyManager: Sprite for enemy type ${enemyTypeId} not loaded`);
            return null;
        }
         if (!this.pathData) {
            console.error(`EnemyManager: Cannot create enemy ${enemyTypeId}. PathData is missing.`);
            return null;
        }

        // Create a new Enemy instance using definitions and path data stored in the manager
        const enemy = new Enemy({
            id: enemyTypeId,
            name: enemyDef.name,
            waypoints: this.pathData, // Use pathData from manager
            sprite: sprite,
            startIndex: startIndex,
            base: this.base, // Pass the base instance
            // Pass all configuration from the enemy definition
            frameWidth: enemyDef.sprite.frameWidth,
            frameHeight: enemyDef.sprite.frameHeight,
            framesPerRow: enemyDef.sprite.framesPerRow,
            totalFrames: enemyDef.sprite.totalFrames,
            frameDuration: enemyDef.sprite.frameDuration,
            scale: enemyDef.sprite.scale,
            // Pass all stats
            hp: enemyDef.stats.hp,
            speed: enemyDef.stats.speed,
            attackRate: enemyDef.stats.attackRate,
            attackStrength: enemyDef.stats.attackStrength,
            attackRange: enemyDef.stats.attackRange,
            bounty: enemyDef.stats.bounty,
            // Pass all effects
            flashDuration: enemyDef.effects.flashDuration
        });

        // Add to active enemies list managed by this manager
        this.activeEnemies.push(enemy);

        return enemy;
    }

    // Update loop for all enemies (logic moved from Game.update)
    update(timestamp, deltaTime) {
        if (!this.isLoaded) return;

        for (let i = this.activeEnemies.length - 1; i >= 0; i--) {
            const enemy = this.activeEnemies[i];
            enemy.update(timestamp, deltaTime, this.base);

            // Remove dead enemies
            if (enemy.isDead) {
                // TODO: Handle bounty/score increase here?
                this.activeEnemies.splice(i, 1);
            }
        }
    }

    // Render loop for all enemies (logic moved from Game.render)
    render(ctx) {
        if (!this.isLoaded) return;

        // Sort enemies by scale (smallest first) before rendering
        const sortedEnemies = [...this.activeEnemies].sort((a, b) => a.scale - b.scale);

        // Render the sorted enemies
        sortedEnemies.forEach(enemy => {
            enemy.draw(ctx);
        });
    }

    // Apply parameter updates (logic moved from Game.applyParameterUpdates)
    // Called by TuningManager
    applyParameterUpdates(newEnemyDefinitions) {
        if (!this.isLoaded) {
             console.warn("EnemyManager: Received parameter updates but not loaded yet. Ignoring.");
             return;
        }

        // Create a map for efficient lookup of new definitions by ID
        const newDefinitionsMap = new Map(newEnemyDefinitions.map(def => [def.id, def]));

        // 1. Update Blueprints (this.enemyTypes)
        newDefinitionsMap.forEach((newDef, enemyId) => {
            // Only update existing blueprints, don't add new ones via tuning
            if (this.enemyTypes.hasOwnProperty(enemyId)) {
                // Note: This doesn't reload sprites, only definition data.
                // A full reload might be needed if sprite paths change, but that's complex.
                this.enemyTypes[enemyId] = { ...this.enemyTypes[enemyId], ...newDef }; // Merge updates
                // console.log(`EnemyManager: Updated blueprint for ${enemyId}`);
            } else {
                console.warn(`EnemyManager: TuningManager update contained unknown enemyId: ${enemyId}. Ignoring.`);
            }
        });

        // 2. Update Active Enemy Instances
        this.activeEnemies.forEach(enemy => {
            const updatedDef = newDefinitionsMap.get(enemy.id);
            if (updatedDef) {
                // Call the enemy's own update method
                enemy.applyUpdate(updatedDef);
                 // console.log(`EnemyManager: Applied update to active enemy ${enemy.id}`);
            }
        });
    }

     // Helper to expose the data path for TuningManager registration
    getDataPath() {
        return this.enemyDataPath;
    }

    getActiveEnemies() {
        return this.activeEnemies; // Simply return the array of active instances
    }
}
