import Enemy from './models/enemy.js'; // EnemyManager needs to know about Enemy

// Helper function for distance calculation
function distanceBetween(point1, point2) {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

export default class EnemyManager {
    // Note: pathDataPath parameter now expects the path to the PRE-COMPUTED extended path CSV
    constructor(enemyDataPath, pathDataPath, pathStatsPath, base) {
        if (!enemyDataPath) {
            throw new Error("EnemyManager requires an enemyDataPath.");
        }
        if (!pathDataPath) {
             throw new Error("EnemyManager requires a pathDataPath (to the extended path CSV).");
        }
        if (!pathStatsPath) {
             throw new Error("EnemyManager requires a pathStatsPath.");
        }
        if (!base) {
             throw new Error("EnemyManager requires a Base instance.");
        }
        this.enemyDataPath = enemyDataPath;
        this.pathDataPath = pathDataPath; // Store the path to the extended path CSV
        this.pathStatsPath = pathStatsPath; // Store the path to the stats file
        this.base = base;

        this.enemyTypes = {};
        this.enemySprites = {};
        this.activeEnemies = [];
        this.isLoaded = false;

        // --- Path Metrics (will be loaded from path-stats.json) ---
        this.extendedPathData = [];
        this.totalPathLength = null; // Added property for pre-calculated length
        this.segmentLengths = [];    // Will be loaded
        this.cumulativeDistances = []; // Will be loaded
        // ----------------------------------------------------

        // --- Data for Average Death Distance Calculation ---
        this.currentWaveDeathDistances = [];
        this.lastDeathInfo = { distance: null, originalX: null, originalY: null };
        // -------------------------------------------------
    }

    // --- Helper to load CSV Path Data ---
    async _loadCsvPath(filePath) {
        try {
            const response = await fetch(filePath);
            if (!response.ok) {
                 throw new Error(`HTTP error! status: ${response.status} loading ${filePath}`);
            }
            const data = await response.text();
            const lines = data.trim().split('\n');
            return lines.map(line => {
                const [x, y] = line.split(',').map(Number);
                if (isNaN(x) || isNaN(y)) {
                    console.warn(`Invalid data in CSV line: "${line}" from ${filePath}. Skipping.`);
                    return null; // Return null for invalid lines
                }
                return { x, y };
            }).filter(p => p !== null); // Filter out invalid entries
        } catch (error) {
            console.error(`Error loading CSV path from ${filePath}:`, error);
            throw error; // Re-throw after logging
        }
    }
    // --- End Helper ---

    // --- Helper to load JSON Stats Data ---
     async _loadJsonStats(filePath) {
         try {
             const response = await fetch(filePath);
             if (!response.ok) {
                  throw new Error(`HTTP error! status: ${response.status} loading ${filePath}`);
             }
             const stats = await response.json();
             // Basic validation
             if (typeof stats.totalPathLength !== 'number' || !Array.isArray(stats.segmentLengths) || !Array.isArray(stats.cumulativeDistances)) {
                 throw new Error(`Invalid format in path stats file: ${filePath}`);
             }
             return stats;
         } catch (error) {
             console.error(`Error loading path stats from ${filePath}:`, error);
             throw error; // Re-throw after logging
         }
     }
    // --- End Helper ---

    // Method to load initial data
    async load() {
        try {
            // 1. Load Enemy Definitions and Sprites
            const enemyResponse = await fetch(this.enemyDataPath);
             if (!enemyResponse.ok) throw new Error(`HTTP error! status: ${enemyResponse.status} loading ${this.enemyDataPath}`);
            const enemyDefinitions = await enemyResponse.json();

            console.log(`EnemyManager: Loading ${enemyDefinitions.length} enemy types from ${this.enemyDataPath}`);

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
            await Promise.all(spritePromises); // Wait for all sprites to load (or fail)

            // 2. Load Pre-computed Extended Path Data
            console.log(`EnemyManager: Loading pre-computed extended path from ${this.pathDataPath}`);
            this.extendedPathData = await this._loadCsvPath(this.pathDataPath);
            if (!this.extendedPathData || this.extendedPathData.length < 2) {
                 throw new Error(`Failed to load a valid extended path (needs >= 2 points) from ${this.pathDataPath}`);
            }
             console.log(`EnemyManager: Loaded ${this.extendedPathData.length} waypoints for the extended path.`);

            // 3. Load Pre-computed Path Statistics
            console.log(`EnemyManager: Loading pre-computed path stats from ${this.pathStatsPath}`);
            const pathStats = await this._loadJsonStats(this.pathStatsPath);
            this.totalPathLength = pathStats.totalPathLength;
            this.segmentLengths = pathStats.segmentLengths;
            this.cumulativeDistances = pathStats.cumulativeDistances;
             if (this.segmentLengths.length !== this.extendedPathData.length - 1) {
                 console.warn(`EnemyManager: Mismatch between loaded segment lengths (${this.segmentLengths.length}) and path waypoints (${this.extendedPathData.length}).`);
                 // Decide if this is fatal or just a warning
             }
             console.log(`EnemyManager: Loaded path stats - Total Length: ${this.totalPathLength.toFixed(2)}`);

            this.isLoaded = true;
            console.log('EnemyManager: All enemy types, extended path, and path stats loaded.');
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

    // Factory method to create enemies
    createEnemy(enemyTypeId) { // Removed startIndex parameter
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
         if (!this.extendedPathData || this.extendedPathData.length === 0) {
            console.error(`EnemyManager: Cannot create enemy ${enemyTypeId}. Extended path is missing.`);
            return null;
        }

        const enemy = new Enemy({ // Pass extended path here
            id: enemyTypeId,
            name: enemyDef.name,
            extendedPath: this.extendedPathData, // Pass the calculated extended path
            sprite: sprite,
            // startIndex: 0, // Enemy always starts at index 0 of extended path
            base: this.base, 
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
            bounty: enemyDef.stats.bounty,
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
                let totalDistance = 0;
                const targetIndex = enemy.targetWaypointIndex;
                const finalX = enemy.x;
                const finalY = enemy.y;

                // Use EXTENDED path data and metrics now
                if (targetIndex > 0 && targetIndex <= this.extendedPathData.length) { 
                    const prevIndex = targetIndex - 1;
                    const p1 = this.extendedPathData[prevIndex]; 
                    const cumulativeDistanceToP1 = (prevIndex === 0) ? 0 : (this.cumulativeDistances[prevIndex - 1] || 0);
                    const distanceOnSegment = distanceBetween(p1, { x: finalX, y: finalY }); 
                    totalDistance = cumulativeDistanceToP1 + distanceOnSegment;
                } else { 
                    if (this.extendedPathData && this.extendedPathData.length > 0) {
                        const p1 = this.extendedPathData[0]; 
                        totalDistance = distanceBetween(p1, { x: finalX, y: finalY }); 
                    } else {
                         totalDistance = 0; 
                    }
                }
                this.currentWaveDeathDistances.push(totalDistance);
                this.lastDeathInfo = { distance: totalDistance, originalX: finalX, originalY: finalY };
                this.activeEnemies.splice(i, 1);
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
    
    // Method to get the calculated extended path data
    getExtendedPath() {
        if (!this.isLoaded) {
            console.warn("EnemyManager: getExtendedPath called before path was generated.");
            return [];
        }
        return this.extendedPathData;
    }

    // Method to calculate average death distance (uses EXTENDED path distances now)
    calculateAverageDeathDistance() {
        if (this.currentWaveDeathDistances.length === 0) {
            console.log("EnemyManager: No enemy deaths recorded for the last wave.");
            this.currentWaveDeathDistances = [];
            return 0; 
        }
        const sumOfDistances = this.currentWaveDeathDistances.reduce((sum, dist) => sum + dist, 0);
        const averageDistance = sumOfDistances / this.currentWaveDeathDistances.length;
        console.log(`EnemyManager: Average death distance for last wave: ${averageDistance.toFixed(2)} pixels (based on ${this.currentWaveDeathDistances.length} deaths, EXTENDED path).`);
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
        if (targetDistance < 0 || !this.cumulativeDistances || this.cumulativeDistances.length === 0 || !this.segmentLengths || this.segmentLengths.length === 0) {
            console.warn(`getPointAtDistance: Called with invalid targetDistance (${targetDistance}) or path metrics not loaded.`);
            return null; 
        }
        let targetSegmentIndex = -1;
        for (let i = 0; i < this.cumulativeDistances.length; i++) {
            if (targetDistance <= this.cumulativeDistances[i]) {
                targetSegmentIndex = i;
                break;
            }
        }
        if (targetSegmentIndex === -1) {
             if(this.extendedPathData && this.extendedPathData.length > 0) {
                 const lastPoint = this.extendedPathData[this.extendedPathData.length - 1];
                 return { ...lastPoint }; // Return copy of end point
             } else {
                 return null; 
             }
        }
        // Use EXTENDED path data and loaded metrics
        const p1 = this.extendedPathData[targetSegmentIndex]; 
        const p2 = this.extendedPathData[targetSegmentIndex + 1]; 
        const distanceToStartOfSegment = (targetSegmentIndex === 0) ? 0 : this.cumulativeDistances[targetSegmentIndex - 1];
        const distanceIntoSegment = targetDistance - distanceToStartOfSegment;
        const segmentLength = this.segmentLengths[targetSegmentIndex]; // Use loaded metric
        // Avoid division by zero for zero-length segments
        const factor = (segmentLength > 1e-6) ? (distanceIntoSegment / segmentLength) : 0;
        const x = p1.x + (p2.x - p1.x) * factor;
        const y = p1.y + (p2.y - p1.y) * factor;
        return { x, y };
    }
}
