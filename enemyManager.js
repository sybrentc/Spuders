import Enemy from './models/enemy.js'; // EnemyManager needs to know about Enemy

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
        if (!game || typeof game.getBetaFactor !== 'function') {
             throw new Error("EnemyManager requires a valid Game instance.");
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

    // Method to load initial data
    async load() {
        try {
            // 1. Load Enemy Definitions and Sprites
            const enemyResponse = await fetch(this.enemyDataPath);
             if (!enemyResponse.ok) throw new Error(`HTTP error! status: ${enemyResponse.status} loading ${this.enemyDataPath}`);
            const enemyDefinitions = await enemyResponse.json();

            //console.log(`EnemyManager: Loading ${enemyDefinitions.length} enemy types from ${this.enemyDataPath}`);

            // Load sprites and store definitions
            const spritePromises = enemyDefinitions.map(async (enemyDef) => {
                try {
                const sprite = await this.loadSprite(enemyDef.sprite.path);
                this.enemySprites[enemyDef.id] = sprite;
                this.enemyTypes[enemyDef.id] = enemyDef;
                } catch (spriteError) {
                     console.error(`Failed to load sprite for ${enemyDef.id}:`, spriteError);
                     // Optionally, handle this: skip enemy, use placeholder, etc.
                     // For now, it will prevent the enemy type from being fully loaded.
                }
            });
            // --- Load the Shared Hit Sprite ---
            try {
                this.sharedHitSprite = await this.loadSprite('assets/images/spider-hit.png');
            } catch (hitSpriteError) {
                 console.error(`Failed to load shared hit sprite:`, hitSpriteError);
                 // Decide how to handle this - game might break visually without it.
                 // Maybe throw error or set a flag? For now, log and continue.
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
            //console.log('EnemyManager: All enemy types loaded. Path data/stats loaded by Game.'); // Updated log
            return true;
        } catch (error) {
            console.error('EnemyManager: Error during loading:', error);
            this.isLoaded = false;
            throw error; 
        }
    }

    // Method to load sprites
    loadSprite(path) {
        return new Promise((resolve, reject) => {
            const sprite = new Image();
            sprite.onload = () => resolve(sprite);
            sprite.onerror = (e) => reject(new Error(`EnemyManager: Failed to load sprite: ${path}`));
            sprite.src = path;
        });
    }

    /**
     * Calculates the bounty for a given enemy type based on current stats and global factor.
     * @param {string} enemyTypeId 
     * @returns {number} The calculated bounty value.
     */
    getCalculatedBounty(enemyTypeId) {
        const enemyDef = this.enemyTypes[enemyTypeId];
        const beta = this.game.getBetaFactor();

        if (!enemyDef || !enemyDef.stats || beta === null || beta < 0) {
            return 0; // No definition or factor
        }

        const hp = enemyDef.stats.hp ?? 0;
        const speed = enemyDef.stats.speed ?? 0;

        if (hp <= 0 || speed <= 0) {
            return 0; // No bounty for invalid stats
        }

        const rawBounty = beta * hp * speed;
        const finalBounty = Math.max(0, rawBounty); // Ensure non-negative
        return Math.round(finalBounty); // Round to nearest integer
    }

    // Factory method to create enemies
    async createEnemy(enemyTypeId) { // Make async to handle awaiting sprite promise
        if (!this.isLoaded) {
            console.error(`EnemyManager: Cannot create enemy ${enemyTypeId}. Manager not loaded yet.`);
            return null;
        }
        if (!this.enemyTypes[enemyTypeId]) {
            console.error(`EnemyManager: Enemy type ${enemyTypeId} not found`);
            return null;
        }
        const enemyDef = this.enemyTypes[enemyTypeId];
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

        const enemy = new Enemy({ 
            id: enemyTypeId,
            name: enemyDef.name,
            extendedPath: extendedPathData, // Use path from game
            sprite: sprite,
            sharedHitSprite: this.sharedHitSprite, // <-- Pass the shared hit sprite
            base: this.base, // Pass base for bounty calculation
            frameWidth: enemyDef.sprite.frameWidth,
            frameHeight: enemyDef.sprite.frameHeight,
            framesPerRow: enemyDef.sprite.framesPerRow,
            totalFrames: enemyDef.sprite.totalFrames,
            frameDuration: enemyDef.sprite.frameDuration,
            scale: enemyDef.display?.scale,
            anchorX: enemyDef.display?.anchorX,
            anchorY: enemyDef.display?.anchorY,
            hp: enemyDef.stats.hp,
            speed: enemyDef.stats.speed,
            attackRate: enemyDef.stats.attackRate,
            attackStrength: enemyDef.stats.attackStrength,
            attackRange: enemyDef.stats.attackRange,
            flashDuration: enemyDef.effects.flashDuration
        });
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
                // --- Calculate and Award Bounty --- 
                const bounty = this.getCalculatedBounty(enemy.id);
                if (bounty > 0 && this.base) {
                    this.base.addFunds(bounty);
                }
                // ----------------------------------

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

        // --- ADDED: Check if min speed changes ---
        const previousMinSpeed = this.getMinimumEnemySpeed();
        // --- END ADDED ---

        // Create a map for efficient lookup of new definitions by ID
        const newDefinitionsMap = new Map(newEnemyDefinitions.map(def => [def.id, def]));

        // --- Store a copy of old definitions for comparison ---
        const oldEnemyTypesString = JSON.stringify(this.enemyTypes);
        // -----------------------------------------------------

        // --- Process ALL incoming definitions --- 
        newDefinitionsMap.forEach((newDef, enemyId) => {
            const existingDef = this.enemyTypes[enemyId];

            if (existingDef) {
                // --- Update Existing Enemy --- 
                // Merge definition updates (shallow merge, consider deep merge if needed)
                this.enemyTypes[enemyId] = { ...existingDef, ...newDef }; 
                
                // Check if sprite path changed
                const oldSpritePath = existingDef.sprite?.path;
                const newSpritePath = newDef.sprite?.path;

                if (newSpritePath && newSpritePath !== oldSpritePath) {
                    //console.log(`EnemyManager: Sprite path changed for ${enemyId}. Reloading sprite from ${newSpritePath}`);
                    // Start loading new sprite, store the promise
                    // Overwrite existing sprite or promise
                    this.enemySprites[enemyId] = this.loadSprite(newSpritePath).catch(err => {
                        console.error(`EnemyManager: Failed to reload sprite for ${enemyId} from ${newSpritePath}:`, err);
                        return null; // Store null on failure to prevent repeated attempts
                    });
                }
                // //console.log(`EnemyManager: Updated blueprint for ${enemyId}`);
            } else {
                // --- Add New Enemy --- 
                //console.log(`EnemyManager: Adding new enemy type: ${enemyId}`);
                this.enemyTypes[enemyId] = newDef; // Add the new definition

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
        });

        // --- Update Active Enemy Instances (using the updated blueprints) --- 
        this.activeEnemies.forEach(enemy => {
            const updatedDef = this.enemyTypes[enemy.id]; // Get potentially updated definition
            if (updatedDef) {
                // Call the enemy's own update method
                enemy.applyUpdate(updatedDef);
                 // //console.log(`EnemyManager: Applied update to active enemy ${enemy.id}`);
            }
        });
        // ----------------------------------------------------------------

        // --- ADDED: Recalculate alpha factor if min speed changed ---
        const currentMinSpeed = this.getMinimumEnemySpeed();
        // Check if the speed value actually changed (handle null cases)
        if (previousMinSpeed !== currentMinSpeed) {
             console.log(`EnemyManager: Minimum speed changed from ${previousMinSpeed} to ${currentMinSpeed}. Triggering alpha factor recalculation.`);
             this.game.recalculateAlphaFactor(); // Call game's method
        }
        // --- END ADDED ---

        // --- ADDED: Recalculate defender durability ONLY if enemy stats ACTUALLY changed ---
        const newEnemyTypesString = JSON.stringify(this.enemyTypes);
        if (oldEnemyTypesString !== newEnemyTypesString) { // Compare before/after strings
            if (this.game.defenceManager?.isLoaded) {
                console.log("EnemyManager: Enemy definitions updated, triggering defender wear parameter recalculation (k).");
                // TODO: Check if calculateWearParameters needs await in the future
                this.game.defenceManager.calculateWearParameters(); 
            } else {
                 console.warn("EnemyManager: Cannot trigger defender wear recalculation - DefenceManager not ready.");
            }
        }
        // --- END ADDED ---
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
}
