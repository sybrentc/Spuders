import Enemy from './models/enemy.js'; // EnemyManager needs to know about Enemy
import * as PIXI from 'pixi.js'; // Import PIXI
import { processSpritesheet } from './utils/dataLoaders.js'; // <-- IMPORT THE UTILITY

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
        this.strikeManagerRef = game.strikeManager || null; // Store StrikeManager reference

        // Initialize static state (data that persists across game resets)
        this.initStaticState();
        // Initialize runtime state (data that resets with each game)
        this.initRuntimeState();
    }

    /**
     * Initializes static state variables that persist across game resets.
     * These are loaded from files and don't change during gameplay.
     */
    initStaticState() {
        // Core data structures for loaded definitions
        this.enemyTypes = {};       // Stores enemy definitions and calculated values
        this.enemySprites = {};     // Stores enemy sprites (legacy, may be removable)
        this.isLoaded = false;      // Flag indicating if data is loaded
        
        // Hit sprite and animation data
        this.sharedHitSprite = null; // Shared hit sprite for all enemies
        this.commonSpiderConfig = null; // Common configuration for spider animations
        this.allProcessedTextureArrays = []; // Stores processed texture arrays for animations
        this.cachedCriticalZoneEntryWaypointIndex = -1; // <-- ADDED for Duress Cooldown
    }

    /**
     * Initializes runtime state variables that reset with each game.
     * These are the values that change during gameplay.
     */
    initRuntimeState() {
        // Active gameplay state
        this.activeEnemies = [];    // Tracks currently active enemy instances
        
        // Death tracking data
        this.currentWaveDeathDistances = []; // Tracks death distances for current wave
        this.lastDeathInfo = { 
            distance: null, 
            originalX: null, 
            originalY: null 
        }; // Stores info about the last enemy death
    }

    // Method to load initial data (Definitions and Sprites ONLY)
    async load() {
        try {
            // Load common spider configuration first
            const spiderConfigResponse = await fetch('assets/spiderConfig.json');
            if (!spiderConfigResponse.ok) {
                throw new Error(`HTTP error! status: ${spiderConfigResponse.status} while fetching spiderConfig.json`);
            }
            this.commonSpiderConfig = await spiderConfigResponse.json();

            // Load and process common hit spritesheet
            if (this.commonSpiderConfig && this.commonSpiderConfig.hit && this.commonSpiderConfig.hit.commonHitSpriteSheetPath && this.commonSpiderConfig.display) {
                this.allProcessedTextureArrays[0] = await processSpritesheet( // <-- USE IMPORTED FUNCTION
                    this.commonSpiderConfig.hit.commonHitSpriteSheetPath,
                    this.commonSpiderConfig.display
                );
            } else {
                console.error("EnemyManager: Cannot process common hit spritesheet due to missing config (hit.commonHitSpriteSheetPath or display).");
                this.allProcessedTextureArrays[0] = []; // Ensure it's an empty array on failure
            }

            // Load main enemy definitions
            const response = await fetch(this.enemyDataPath);
             if (!response.ok) throw new Error(`HTTP error! status: ${response.status} loading ${this.enemyDataPath}`);
            this.enemyDefinitions = await response.json();
            //console.log("EnemyManager: Loaded enemy definitions:", this.enemyDefinitions);

            // Load sprites and store definitions
            // Ensure enemyDefinitions is an array before trying to map over it
            if (!Array.isArray(this.enemyDefinitions)) {
                throw new Error("EnemyManager: enemyDefinitions is not an array after loading from JSON.");
            }

            for (const enemyDef of this.enemyDefinitions) {
                // Basic validation of enemy definition structure
                if (!enemyDef || !enemyDef.id || !enemyDef.stats || typeof enemyDef.stats.hp !== 'number' || typeof enemyDef.stats.speed !== 'number') {
                    console.error('EnemyManager Load: Invalid enemy definition structure encountered:', enemyDef);
                    continue; // Skip this invalid definition
                }

                try {
                    // Store the raw definition first (without processed textures yet)
                    this.enemyTypes[enemyDef.id] = {
                        ...enemyDef,
                        originalHp: enemyDef.stats.hp, // Explicitly store original HP
                        scaledMaxHp: null,
                        healthScaleFactor: null,
                        bounty: 0,
                        // pixiTextures: [] // This will be effectively replaced by normalTextureArrayIndex
                        normalTextureArrayIndex: -1 // Initialize, will be set after processing
                    };

                    // Process normal animation frames for this enemy
                    if (enemyDef.sprite && enemyDef.sprite.path && this.commonSpiderConfig && this.commonSpiderConfig.display) {
                        const normalTextures = await processSpritesheet( // <-- USE IMPORTED FUNCTION
                            enemyDef.sprite.path,
                            this.commonSpiderConfig.display
                        );
                        if (normalTextures.length > 0) {
                            this.allProcessedTextureArrays.push(normalTextures);
                            this.enemyTypes[enemyDef.id].normalTextureArrayIndex = this.allProcessedTextureArrays.length - 1;
                            // console.log(`EnemyManager: Processed ${normalTextures.length} normal textures for ${enemyDef.id}, stored at index ${this.enemyTypes[enemyDef.id].normalTextureArrayIndex}`);
                        } else {
                            console.warn(`EnemyManager: Could not process normal textures for ${enemyDef.id} from ${enemyDef.sprite.path}.`);
                        }
                    } else {
                        console.warn(`EnemyManager: Missing sprite path or common display config for ${enemyDef.id}. Cannot process normal textures.`);
                    }

                    // The old this.enemySprites[enemyDef.id] = spriteAsset can be removed 
                    // as _processSpritesheet now handles loading the asset directly from path.
                    // We no longer need to store the raw spriteAsset in this.enemySprites if all processing is done here.
                    // However, if any other part of your code relies on this.enemySprites holding the raw PIXI.Asset objects (e.g. Spritesheet instances)
                    // then you might need to adjust. For now, assuming _processSpritesheet is the sole consumer of the raw asset for textures.

                } catch (spriteError) {
                     console.error(`Failed to load sprite for ${enemyDef.id}:`, spriteError);
                }
            }

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
        if (enemyDef.scaledMaxHp === null || enemyDef.healthScaleFactor === null) {
             console.error(`EnemyManager: Scaled health values not calculated for ${enemyTypeId}. Cannot create enemy.`);
             return null;
        }
        if (!this.commonSpiderConfig || !this.commonSpiderConfig.display || !this.commonSpiderConfig.hit) {
            console.error(`EnemyManager: commonSpiderConfig not loaded or incomplete. Cannot create enemy ${enemyTypeId}.`);
            return null;
        }

        const normalTextureIndex = enemyDef.normalTextureArrayIndex;
        if (normalTextureIndex === undefined || normalTextureIndex < 1 || !this.allProcessedTextureArrays[normalTextureIndex]) {
            console.error(`EnemyManager: Invalid normalTextureArrayIndex or missing textures for ${enemyTypeId} at index ${normalTextureIndex}.`);
            return null;
        }
        const normalTextures = this.allProcessedTextureArrays[normalTextureIndex];
        
        const frameCfg = this.commonSpiderConfig.display;
        const specificScale = enemyDef.display?.scale || 1; // Use enemy-specific scale

         // Get path data from game
         const extendedPathData = this.game.getExtendedPathData();
         if (!extendedPathData || extendedPathData.length === 0) {
             console.error(`EnemyManager: Cannot create enemy ${enemyTypeId}. Extended path is missing from game instance.`);
             return null;
         }

        const enemy = new Enemy({ 
            id: enemyTypeId,
            name: enemyDef.name,
            extendedPath: extendedPathData,
            // sprite: sprite, // No longer passing raw sprite asset
            // sharedHitSprite: null, // Deferring hit sprite logic
            // frameWidth: frameCfg.frameWidth, // Passed via frameCfg below for Enemy.js constructor
            // frameHeight: frameCfg.frameHeight,
            // framesPerRow: frameCfg.framesPerRow,
            // totalFrames: frameCfg.totalFrames,
            // frameDuration: frameCfg.frameDuration,
            // scale: specificScale, 
            // anchorX: frameCfg.anchorX,
            // anchorY: frameCfg.anchorY,

            // Pass according to Enemy.js constructor expectation
            pixiTextures: normalTextures,
            frameWidth: frameCfg.frameWidth,
            frameHeight: frameCfg.frameHeight,
            framesPerRow: frameCfg.framesPerRow,
            totalFrames: frameCfg.totalFrames,
            frameDuration: enemyDef.display.frameDuration, // Sourced from enemyDef.display
            scale: specificScale, 
            anchorX: frameCfg.anchorX,
            anchorY: frameCfg.anchorY,
            
            hp: enemyDef.scaledMaxHp,          
            bounty: enemyDef.bounty,            
            healthScaleFactor: enemyDef.healthScaleFactor, 
            speed: enemyDef.stats.speed,
            attackRate: enemyDef.stats.attackRate,
            attackStrength: enemyDef.stats.attackStrength,
            attackRange: enemyDef.stats.attackRange,
            // flashDuration: null, // Deferring hit flash logic
            flashDuration: this.commonSpiderConfig.hit.enemyFlashDurationMs, // Pass it, Enemy.js might store it
            base: this.base,
            hitTextures: this.allProcessedTextureArrays[0], // Pass the common hit textures
            game: this.game, // <-- Pass game instance
            strikeManager: this.strikeManagerRef, // <-- Pass StrikeManager reference
            criticalZoneEntryWaypointIndex: this.cachedCriticalZoneEntryWaypointIndex // <-- Pass cached index
        });

        this.activeEnemies.push(enemy);

        // --- Add PixiJS container to stage if sprite exists ---
        if (enemy.pixiSprite) {
            if (this.game && this.game.app && this.game.app.stage) { // Ensure game, app, and stage are available
                this.game.groundLayer.addChild(enemy.pixiContainer); // MODIFIED: Add to groundLayer
                // console.log(`EnemyManager: Added pixiContainer for ${enemy.id} to stage.`);
            } else {
                console.error(`EnemyManager: Cannot add pixiContainer for ${enemy.id} to stage. Game, app, or stage is missing.`);
            }
        }
        // --- End Add PixiJS container ---

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

                // --- PixiJS Cleanup for Dead Enemy ---
                if (enemy.pixiContainer) { // Check if it was a Pixi-rendered enemy
                    if (this.game && this.game.app && this.game.app.stage) {
                        this.game.app.stage.removeChild(enemy.pixiContainer);
                    } else {
                        console.warn(`EnemyManager: Could not remove pixiContainer for ${enemy.id}, game/app/stage missing.`);
                    }
                    enemy.destroyPixiObjects(); // Call enemy's own Pixi cleanup
                }
                // --- End PixiJS Cleanup ---

                // --- Remove Enemy from active list --- 
                this.activeEnemies.splice(i, 1);
                // ---------------------------------
            }
        }
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

    /**
     * Resets the EnemyManager for a new game.
     * Cleans up any active enemies and resets runtime state variables.
     */
    resetForNewGame() {
        // Clean up any active enemies
        if (this.activeEnemies && this.activeEnemies.length > 0) {
            this.activeEnemies.forEach(enemy => {
                if (enemy && typeof enemy.destroyPixiObjects === 'function') {
                    // Remove from stage if it has a container
                    if (enemy.pixiContainer && this.game?.groundLayer) {
                        this.game.groundLayer.removeChild(enemy.pixiContainer);
                    }
                    enemy.destroyPixiObjects();
                }
            });
        }

        // Reset only runtime state
        this.initRuntimeState();

        // Recalculate scaled values since they depend on game state
        this.calculateAndStoreScaledValues();
    }

    // --- ADDED: Method to cache critical waypoint index from Game.js ---
    cacheCriticalWaypointIndex(index) {
        if (typeof index === 'number') {
            this.cachedCriticalZoneEntryWaypointIndex = index;
            // console.log(`EnemyManager: Cached Critical Zone Entry Waypoint Index: ${index}`);
        } else {
            console.warn(`EnemyManager: Invalid index (${index}) received for cacheCriticalWaypointIndex.`);
        }
    }
    // --- END ADDED ---
}
