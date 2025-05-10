import Enemy from './models/enemy.js'; // EnemyManager needs to know about Enemy
import * as PIXI from 'pixi.js'; // Import PIXI

// Helper function for distance calculation
function distanceBetween(point1, point2) {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

export default class EnemyManager {
    // Note: pathDataPath parameter now expects the path to the PRE-COMPUTED extended path CSV
    constructor(enemyDataPath, base, game) {
        if (!enemyDataPath) {
            throw new Error("EnemyManager requires an enemyDataPath.");
        }
        if (!base) {
             throw new Error("EnemyManager requires a Base instance.");
        }
        if (!game || typeof game.getAlpha !== 'function' || typeof game.getBetaFactor !== 'function' || typeof game.getExtendedPathData !== 'function') {
             throw new Error("EnemyManager requires a valid Game instance with getAlpha, getBetaFactor, and getExtendedPathData methods.");
        }
        this.enemyDataPath = enemyDataPath; 
        this.base = base;                   
        this.game = game; // Store game instance

        this.enemyTypes = {};       
        this.enemySprites = {};     
        this.activeEnemies = [];    
        this.isLoaded = false;      
        this.sharedHitSprite = null; // Add property to store the shared hit sprite
        
        // --- Data for Average Death Distance Calculation ---
        this.currentWaveDeathDistances = []; 
        this.lastDeathInfo = { distance: null, originalX: null, originalY: null }; 
        // -------------------------------------------------
    }

    // Method to load initial data (Definitions and Sprites ONLY)
    async load() {
        try {
            // 1. Load Enemy Definitions
            const enemyResponse = await fetch(this.enemyDataPath);
             if (!enemyResponse.ok) throw new Error(`HTTP error! status: ${enemyResponse.status} loading ${this.enemyDataPath}`);
            const enemyDefinitions = await enemyResponse.json();

            // Load sprites and store definitions
            const spritePromises = enemyDefinitions.map(async (enemyDef) => {
                // Basic validation of enemy definition structure
                if (!enemyDef || !enemyDef.id || !enemyDef.stats || typeof enemyDef.stats.hp !== 'number' || typeof enemyDef.stats.speed !== 'number') {
                    console.error('EnemyManager Load: Invalid enemy definition structure encountered:', enemyDef);
                    return; // Skip this invalid definition
                }

                try {
                    const spriteAsset = await this.loadSprite(enemyDef.sprite.path); // Renamed to spriteAsset for clarity
                    this.enemySprites[enemyDef.id] = spriteAsset; // Store the loaded asset (could be TextureSource or Spritesheet)

                    // --- MODIFIED: Store only the BASE definition initially ---
                    // Store a clean version of the definition, keeping original HP
                    this.enemyTypes[enemyDef.id] = {
                        ...enemyDef,
                        originalHp: enemyDef.stats.hp, // Explicitly store original HP
                        // Initialize scaled values to null/zero or keep undefined until calculated
                        scaledMaxHp: null,
                        healthScaleFactor: null,
                        bounty: 0
                    };
                    // --- END MODIFIED ---

                    // --- ADDED: Extract PixiJS textures for spider_normal animation ---
                    if (enemyDef.id === "spider_normal" && spriteAsset) {
                        const textures = [];
                        // Ensure we have a base texture to work with.
                        // PIXI.Assets.load() for a simple image path returns a Texture.
                        // If it were a spritesheet definition, it might return a Spritesheet object.
                        // For now, we assume spriteAsset is or contains a TextureSource.
                        const baseTexture = spriteAsset; // Assuming spriteAsset is a PIXI.Texture

                        if (baseTexture && baseTexture.source) { // Check if baseTexture and its source are valid
                            for (let i = 0; i < enemyDef.sprite.totalFrames; i++) {
                                const frameX = (i % enemyDef.sprite.framesPerRow) * enemyDef.sprite.frameWidth;
                                const frameY = Math.floor(i / enemyDef.sprite.framesPerRow) * enemyDef.sprite.frameHeight;
                                textures.push(new PIXI.Texture({
                                    source: baseTexture.source, // Use the source from the loaded asset
                                    frame: new PIXI.Rectangle(frameX, frameY, enemyDef.sprite.frameWidth, enemyDef.sprite.frameHeight)
                                }));
                            }
                            this.enemyTypes["spider_normal"].pixiTextures = textures;
                            console.log(`EnemyManager: Extracted ${textures.length} PixiJS textures for spider_normal.`);
                        } else {
                            console.error(`EnemyManager: Could not get baseTexture or baseTexture.source for spider_normal. Path: ${enemyDef.sprite.path}`, baseTexture);
                        }
                    }
                    // --- END ADDED ---

                } catch (spriteError) {
                     console.error(`Failed to load sprite for ${enemyDef.id}:`, spriteError);
                }
            });
            // --- Load the Shared Hit Sprite ---
            try {
                this.sharedHitSprite = await this.loadSprite('assets/images/spider-hit.png');
            } catch (hitSpriteError) {
                 console.error(`Failed to load shared hit sprite:`, hitSpriteError);
                 this.sharedHitSprite = null;
            }
            // --- End Load Shared Hit Sprite ---

            await Promise.all(spritePromises); // Wait for all sprites to load (or fail)

            // --- Check if Game has loaded path data (optional sanity check) --- 
            if (this.game && this.game.getExtendedPathData().length === 0) {
                console.warn("EnemyManager Load: Game instance does not seem to have loaded path coordinate data yet.");
            }
            // -----------------------------------------------------------------

            this.isLoaded = true;
            //console.log('EnemyManager: Base definitions and sprites loaded.'); // Updated log
            return true;
        } catch (error) {
            console.error('EnemyManager: Error during loading:', error);
            this.isLoaded = false;
            throw error; 
        }
    }

    // Method to load sprites
    async loadSprite(path) { // Make async
        try {
            const asset = await PIXI.Assets.load(path); // Use PIXI.Assets.load
            return asset;
        } catch (error) {
            // It's good practice to wrap the original error for better debugging
            throw new Error(`EnemyManager: Failed to load sprite using PIXI.Assets: ${path}. ${error.message}`);
        }
    }

    // Factory method to create enemies
    async createEnemy(enemyTypeId) { // Make async to handle awaiting sprite promise
        if (!this.isLoaded) {
            console.error(`EnemyManager: Cannot create enemy ${enemyTypeId}. Manager not loaded yet.`);
            return null;
        }
        const enemyDef = this.enemyTypes[enemyTypeId]; // Get the blueprint with calculated values
        if (!enemyDef) {
            console.error(`EnemyManager: Enemy type ${enemyTypeId} not found in enemyTypes.`);
            return null;
        }
        // --- ADDED: Check if scaled values are calculated ---
        if (enemyDef.scaledMaxHp === null || enemyDef.healthScaleFactor === null) {
             console.error(`EnemyManager: Scaled health values not calculated for ${enemyTypeId}. Cannot create enemy.`);
             // This might happen if calculateAndStoreScaledValues hasn't run successfully yet.
             return null;
        }
        // --- END ADDED ---

        let spriteOrPromise = this.enemySprites[enemyTypeId];

        // --- Handle potential sprite loading promise --- 
        let sprite;
        if (spriteOrPromise instanceof Promise) {
            //console.log(`EnemyManager: Waiting for sprite promise for ${enemyTypeId}...`);
            try {
                sprite = await spriteOrPromise;
                // Store the resolved sprite for next time
                this.enemySprites[enemyTypeId] = sprite; 
            } catch (error) {
                 console.error(`EnemyManager: Error resolving sprite promise for ${enemyTypeId}:`, error);
                 return null; // Cannot create enemy if sprite failed
            }
        } else {
            sprite = spriteOrPromise; // It was already loaded or null
        }
        // --------------------------------------------- 

        if (!sprite) {
            console.error(`EnemyManager: Sprite for enemy type ${enemyTypeId} not loaded or failed to load`);
            return null;
        }
         // Get path data from game
         const extendedPathData = this.game.getExtendedPathData();
         if (!extendedPathData || extendedPathData.length === 0) {
             console.error(`EnemyManager: Cannot create enemy ${enemyTypeId}. Extended path is missing from game instance.`);
             return null;
         }

        // --- MODIFIED: Pass scaled HP, bounty, and scale factor ---
        const enemy = new Enemy({ 
            id: enemyTypeId,
            name: enemyDef.name,
            extendedPath: extendedPathData, // Use path from game
            sprite: sprite,
            sharedHitSprite: this.sharedHitSprite, // <-- Pass the shared hit sprite
            base: this.base, // Pass base 
            frameWidth: enemyDef.sprite.frameWidth,
            frameHeight: enemyDef.sprite.frameHeight,
            framesPerRow: enemyDef.sprite.framesPerRow,
            totalFrames: enemyDef.sprite.totalFrames,
            frameDuration: enemyDef.sprite.frameDuration,
            scale: enemyDef.display?.scale,
            anchorX: enemyDef.display?.anchorX,
            anchorY: enemyDef.display?.anchorY,
            // --- Pass calculated/scaled values --- 
            hp: enemyDef.scaledMaxHp,           // Pass scaled max HP as initial HP
            bounty: enemyDef.bounty,             // Pass pre-calculated bounty
            healthScaleFactor: enemyDef.healthScaleFactor, // Pass the factor itself
            // --- Pass original stats (speed, attack etc.) ---
            speed: enemyDef.stats.speed,
            attackRate: enemyDef.stats.attackRate,
            attackStrength: enemyDef.stats.attackStrength,
            attackRange: enemyDef.stats.attackRange,
            flashDuration: enemyDef.effects.flashDuration
        });
        // --- END MODIFIED ---

        this.activeEnemies.push(enemy);
        return enemy;
    }

    // Update loop for all enemies
    update(timestamp, deltaTime) {
        if (!this.isLoaded) return;
        for (let i = this.activeEnemies.length - 1; i >= 0; i--) {
            const enemy = this.activeEnemies[i];
            enemy.update(timestamp, deltaTime, this.base); 
            if (enemy.isDead) {
                // --- Record Death Distance --- 
                let totalDistance = 0;
                const targetIndex = enemy.targetWaypointIndex;
                const finalX = enemy.x;
                const finalY = enemy.y;
                // Get path data from game
                const extendedPathData = this.game.getExtendedPathData();
                if (targetIndex > 0 && targetIndex <= extendedPathData.length) { 
                    // Get metrics from Game instance
                    const cumulativeDistances = this.game.getCumulativeDistances();
                    if (!cumulativeDistances || cumulativeDistances.length === 0) {
                        console.error("Death Calc: Cannot get cumulative distances from game.");
                        totalDistance = 0;
                    } else {
                        const prevIndex = targetIndex - 1;
                        const p1 = extendedPathData[prevIndex]; // Use path from game
                        const cumulativeDistanceToP1 = (prevIndex === 0) ? 0 : (cumulativeDistances[prevIndex - 1] || 0);
                        const distanceOnSegment = distanceBetween(p1, { x: finalX, y: finalY }); 
                        totalDistance = cumulativeDistanceToP1 + distanceOnSegment;
                    }
                } else { 
                    if (extendedPathData && extendedPathData.length > 0) {
                        const p1 = extendedPathData[0]; // Use path from game
                        totalDistance = distanceBetween(p1, { x: finalX, y: finalY }); 
                    } else {
                         totalDistance = 0; 
                    }
                }
                this.currentWaveDeathDistances.push(totalDistance);
                this.lastDeathInfo = { distance: totalDistance, originalX: finalX, originalY: finalY };
                // --------------------------- 

                // --- Remove Enemy --- 
                this.activeEnemies.splice(i, 1);
                // ------------------
            }
        }
    }

    // Render loop for all enemies (no changes needed)
    render(ctx) { 
        if (!this.isLoaded) return;

        // Sort enemies by scale (smallest first) before rendering
        const sortedEnemies = [...this.activeEnemies].sort((a, b) => a.scale - b.scale);

        // Render the sorted enemies
        sortedEnemies.forEach(enemy => {
            enemy.draw(ctx);
        });
    }

    // Apply parameter updates (no changes needed)
    applyParameterUpdates(newEnemyDefinitions) { 
       if (!this.isLoaded) {
             console.warn("EnemyManager: Received parameter updates but not loaded yet. Ignoring.");
             return;
        }

        // Create a map for efficient lookup of new definitions by ID
        const newDefinitionsMap = new Map(newEnemyDefinitions.map(def => [def.id, def]));

        // --- Process ALL incoming definitions --- 
        newDefinitionsMap.forEach((newDef, enemyId) => {
            const existingDef = this.enemyTypes[enemyId];

            // Basic validation
            if (!newDef || !newDef.stats || typeof newDef.stats.hp !== 'number' || typeof newDef.stats.speed !== 'number') {
                console.error(`EnemyManager Update: Invalid new definition structure for ${enemyId}:`, newDef);
                return; // Skip this invalid definition
            }

            // --- MODIFIED: Merge new definition, keep existing calculated fields temporarily ---
            let updatedDefinitionBase = existingDef ? {
                ...existingDef, // Start with existing calculated values
                ...newDef,      // Overwrite with ALL new base values (incl. name, sprite, stats etc)
                originalHp: newDef.stats.hp // Make sure originalHp reflects the NEW stats.hp
            } : { ...newDef, originalHp: newDef.stats.hp }; // For new enemy, just use new def
            // --- END MODIFIED ---

            if (existingDef) {
                // Check if sprite path changed
                const oldSpritePath = existingDef.sprite?.path;
                const newSpritePath = newDef.sprite?.path;

                if (newSpritePath && newSpritePath !== oldSpritePath) {
                    this.enemySprites[enemyId] = this.loadSprite(newSpritePath).catch(err => {
                        console.error(`EnemyManager: Failed to reload sprite for ${enemyId} from ${newSpritePath}:`, err);
                        return null; // Store null on failure to prevent repeated attempts
                    });
                }
            } else {
                // --- Add New Enemy --- 
                console.log(`EnemyManager: Adding new enemy type: ${enemyId}`);

                // Load sprite for the new enemy, store the promise
                const newSpritePath = newDef.sprite?.path;
                if (newSpritePath) {
                    this.enemySprites[enemyId] = this.loadSprite(newSpritePath).catch(err => {
                        console.error(`EnemyManager: Failed to load sprite for new enemy ${enemyId} from ${newSpritePath}:`, err);
                        return null; // Store null on failure
                    });
                } else {
                    console.warn(`EnemyManager: New enemy type ${enemyId} has no sprite path defined.`);
                    this.enemySprites[enemyId] = null; // Ensure it's explicitly null
                }
            }

            // Update the definition in this.enemyTypes
            this.enemyTypes[enemyId] = updatedDefinitionBase;
        });

        // --- ADDED: Recalculate all scaled values AFTER processing all updates ---
        this.calculateAndStoreScaledValues();

        // --- Update Active Enemy Instances (using the updated blueprints) --- 
        this.activeEnemies.forEach(enemy => {
            const updatedDef = this.enemyTypes[enemy.id]; // Get potentially updated definition
            if (updatedDef) {
                // Call the enemy's own update method - this needs adjustment
                // Enemy.applyUpdate should ONLY update basic stats/display,
                // NOT the scaled health or bounty which are set at creation.
                enemy.applyUpdate(updatedDef); // Pass the full updated definition
            }
        });
        // ----------------------------------------------------------------

        // --- Recalculate defender durability if DefenceManager is loaded ---
        if (this.game.defenceManager?.isLoaded) {
            //console.log("EnemyManager: Enemy definitions updated, triggering defender wear parameter recalculation (k).");
            // TODO: Check if calculateWearParameters needs await in the future
            this.game.defenceManager.calculateWearParameters(); 
        } else {
             console.warn("EnemyManager: Cannot trigger defender wear recalculation - DefenceManager not ready.");
        }
        // --- END ---
    }

    // Helper to expose the data path 
    getDataPath() { 
        return this.enemyDataPath; 
    }

    // Getter for active enemies
    getActiveEnemies() { 
        return this.activeEnemies; 
    }

    // Getter for enemy definitions
    getEnemyDefinitions() { 
        if (!this.isLoaded) {
            console.warn("EnemyManager: getEnemyDefinitions called before definitions were loaded.");
            return {};
        }
        return this.enemyTypes;
    }
    
    // --- ADDED: Getter for minimum speed ---
    /**
     * Calculates and returns the minimum positive speed among all loaded enemy types.
     * @returns {number | null} The minimum speed, or null if no valid enemies exist.
     */
    getMinimumEnemySpeed() {
        if (!this.isLoaded || Object.keys(this.enemyTypes).length === 0) {
            //console.warn("EnemyManager: getMinimumEnemySpeed called before loaded or no enemy types defined.");
            return null;
        }

        let minSpeed = Infinity;
        let foundValid = false;

        for (const id in this.enemyTypes) {
            const enemyDef = this.enemyTypes[id];
            if (enemyDef?.stats?.speed && enemyDef.stats.speed > 0) {
                minSpeed = Math.min(minSpeed, enemyDef.stats.speed);
                foundValid = true;
            }
        }

        if (!foundValid) {
            console.warn("EnemyManager: No enemies with positive speed found.");
            return null;
        }

        return minSpeed;
    }
    // --- END ADDED ---

    // Method to calculate average death distance (uses EXTENDED path distances now)
    calculateAverageDeathDistance() {
        if (this.currentWaveDeathDistances.length === 0) {
            //console.log("EnemyManager: No enemy deaths recorded for the last wave.");
            this.currentWaveDeathDistances = [];
            return 0; 
        }
        const sumOfDistances = this.currentWaveDeathDistances.reduce((sum, dist) => sum + dist, 0);
        const averageDistance = sumOfDistances / this.currentWaveDeathDistances.length;
        //console.log(`EnemyManager: Average death distance for last wave: ${averageDistance.toFixed(2)} pixels (based on ${this.currentWaveDeathDistances.length} deaths, EXTENDED path).`);
        this.currentWaveDeathDistances = [];
        return averageDistance;
    }

    // Getter for last death info
    getLastDeathInfo() { 
        return this.lastDeathInfo; 
    }

    /**
     * Calculates the (x, y) coordinates at a specific distance along the EXTENDED path.
     */
    getPointAtDistance(targetDistance) {
        // DELEGATE to Game instance's method
        if (!this.game || typeof this.game.getPointAtDistance !== 'function') {
            console.error("EnemyManager: Cannot call getPointAtDistance, game instance or method missing.");
            return null;
        }
        return this.game.getPointAtDistance(targetDistance);
    }

    // --- ADDED: New method to calculate and store scaled values ---
    /**
     * Calculates scaledMaxHp, healthScaleFactor, and bounty for all loaded enemy types.
     * Should be called AFTER base definitions are loaded and AFTER game alpha/beta are available.
     */
    calculateAndStoreScaledValues() {
        if (!this.isLoaded) {
            console.error("EnemyManager: Cannot calculate scaled values - definitions not loaded.");
            return;
        }
        const alpha = this.game.getAlpha();
        const beta = this.game.getBetaFactor();

        if (alpha === null || alpha <= 0) {
            console.error(`EnemyManager CalcScaled: Invalid alpha value (${alpha}). Cannot calculate.`);
            // Optionally: Reset existing scaled values to defaults/null?
            return;
        }
        if (beta === null || beta < 0) {
            console.error(`EnemyManager CalcScaled: Invalid beta value (${beta}). Cannot calculate bounty.`);
            // Optionally: Reset existing bounty values?
            return;
        }

        //console.log(`EnemyManager: Calculating scaled values with alpha=${alpha.toFixed(4)}, beta=${beta}`);

        for (const enemyId in this.enemyTypes) {
            const enemyDef = this.enemyTypes[enemyId];

            // Use originalHp stored during load
            const originalHp = enemyDef.originalHp;
            const speed = enemyDef.stats.speed;

            if (typeof originalHp !== 'number' || typeof speed !== 'number') {
                console.warn(`EnemyManager CalcScaled: Missing originalHp or speed for ${enemyId}. Skipping.`);
                continue;
            }

            if (speed <= 0 || originalHp <= 0) {
                console.warn(`EnemyManager CalcScaled: Enemy type ${enemyId} has non-positive speed (${speed}) or HP (${originalHp}).`);
            }

            const healthScaleFactor = (speed > 0) ? (beta * speed) / alpha : 0;
            const scaledMaxHp = (originalHp > 0 && healthScaleFactor > 0) ? healthScaleFactor * originalHp : 0;
            const bounty = (originalHp > 0 && speed > 0) ? Math.round(beta * speed * originalHp) : 0;

            // Update the stored definition
            this.enemyTypes[enemyId] = {
                ...enemyDef,
                scaledMaxHp: scaledMaxHp,
                healthScaleFactor: healthScaleFactor,
                bounty: bounty
            };
        }
        //console.log("EnemyManager: Finished calculating scaled values.");
    }
    // --- END ADDED ---
}
