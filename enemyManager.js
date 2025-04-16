import Enemy from './models/enemy.js'; // EnemyManager needs to know about Enemy

// Helper function for distance calculation
function distanceBetween(point1, point2) {
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

export default class EnemyManager {
    constructor(enemyDataPath, pathData, base) {
        if (!enemyDataPath) {
            throw new Error("EnemyManager requires an enemyDataPath.");
        }
        if (!pathData || pathData.length < 2) {
            console.warn("EnemyManager created with invalid original pathData. Path extension and metrics calculation might fail.");
            this.originalPathData = []; 
        } else {
            this.originalPathData = pathData; // Store original path temporarily
        }
        if (!base) {
             throw new Error("EnemyManager requires a Base instance.");
        }
        this.enemyDataPath = enemyDataPath; 
        this.base = base;                   

        this.enemyTypes = {};       
        this.enemySprites = {};     
        this.activeEnemies = [];    
        this.isLoaded = false;      

        // --- Path Metrics (will be based on EXTENDED path) ---
        this.extendedPathData = [];      // Stores the final path including spawn/despawn
        this.segmentLengths = [];        
        this.cumulativeDistances = []; 
        // ----------------------------------------------------
        
        // --- Data for Average Death Distance Calculation ---
        this.currentWaveDeathDistances = []; 
        this.lastDeathInfo = { distance: null, originalX: null, originalY: null }; 
        // -------------------------------------------------

        // Note: Path metrics calculation is deferred until after enemy types are loaded
    }

    // --- Method to calculate path metrics (NOW uses extended path) ---
    _calculatePathMetrics() {
        if (!this.extendedPathData || this.extendedPathData.length < 2) {
            console.error("EnemyManager: Cannot calculate path metrics, extendedPathData is invalid.");
            this.segmentLengths = [];
            this.cumulativeDistances = [];
            return;
        }

        this.segmentLengths = [];
        this.cumulativeDistances = [];
        let currentCumulativeDistance = 0;

        for (let i = 0; i < this.extendedPathData.length - 1; i++) {
            const p1 = this.extendedPathData[i];
            const p2 = this.extendedPathData[i+1];
            const length = distanceBetween(p1, p2);
            
            this.segmentLengths.push(length);
            currentCumulativeDistance += length;
            this.cumulativeDistances.push(currentCumulativeDistance);
        }
        console.log(`EnemyManager: Calculated metrics for ${this.segmentLengths.length} extended path segments.`);
        // console.log("Extended Cumulative Distances:", this.cumulativeDistances);
    }
    // -------------------------------------------

    // Method to load initial data
    async load() {
        try {
            const response = await fetch(this.enemyDataPath);
            const enemyDefinitions = await response.json();

            console.log(`EnemyManager: Loading ${enemyDefinitions.length} enemy types from ${this.enemyDataPath}`);

            // Load sprites and store definitions
            for (const enemyDef of enemyDefinitions) {
                const sprite = await this.loadSprite(enemyDef.sprite.path);
                this.enemySprites[enemyDef.id] = sprite;
                this.enemyTypes[enemyDef.id] = enemyDef;
            }

            // --- Generate Extended Path and Calculate Metrics --- 
            const maxDiagonal = this._calculateMaxSpriteDiagonal();
            this.extendedPathData = this._generateExtendedPath(this.originalPathData, maxDiagonal);
            this._calculatePathMetrics(); // Calculate metrics based on the extended path
            // ----------------------------------------------------

            this.isLoaded = true;
            console.log('EnemyManager: All enemy types loaded and extended path generated.');
            return true;
        } catch (error) {
            console.error('EnemyManager: Error loading enemy types or generating path:', error);
            this.isLoaded = false;
            throw error; 
        }
    }

    // --- Helper to find max sprite diagonal --- 
    _calculateMaxSpriteDiagonal() {
        let maxDiagonalSq = 0;
        for (const typeId in this.enemyTypes) {
            const def = this.enemyTypes[typeId];
            if (def && def.sprite && def.display) {
                 const w = def.sprite.frameWidth || 0;
                 const h = def.sprite.frameHeight || 0;
                 const s = def.display.scale || 1;
                 const diagonalSq = (w * w + h * h) * s * s; // Compare squared distances
                 if (diagonalSq > maxDiagonalSq) {
                     maxDiagonalSq = diagonalSq;
                 }
            }
        }
        const maxDiagonal = Math.sqrt(maxDiagonalSq);
        console.log(`EnemyManager: Calculated max sprite diagonal for path extension: ${maxDiagonal.toFixed(1)}px`);
        return maxDiagonal; // Return the actual diagonal, not squared
    }
    // -----------------------------------------

    // --- Helper to generate the extended path --- 
    _generateExtendedPath(originalPath, extensionDistance) {
         if (!originalPath || originalPath.length < 2) {
            console.warn(`EnemyManager: Cannot extend path with less than 2 waypoints.`);
            return originalPath || []; 
        }
        if (extensionDistance <= 0) {
             console.warn(`EnemyManager: Extension distance (${extensionDistance}) is zero or negative. Returning original path.`);
             return [...originalPath]; // Return a copy
        }

        // Calculate Spawn Point
        const p0 = originalPath[0];
        const p1 = originalPath[1];
        let normStartX = 0, normStartY = 0;
        const dxStart = p1.x - p0.x, dyStart = p1.y - p0.y;
        const distStart = Math.sqrt(dxStart * dxStart + dyStart * dyStart);
        if (distStart > 0.001) { normStartX = dxStart / distStart; normStartY = dyStart / distStart; }
        const spawnPoint = { x: p0.x - normStartX * extensionDistance, y: p0.y - normStartY * extensionDistance };

        // Calculate Despawn Point
        const pn = originalPath[originalPath.length - 1];
        const pn_1 = originalPath[originalPath.length - 2];
        let normEndX = 0, normEndY = 0;
        const dxEnd = pn.x - pn_1.x, dyEnd = pn.y - pn_1.y;
        const distEnd = Math.sqrt(dxEnd * dxEnd + dyEnd * dyEnd);
        if (distEnd > 0.001) { normEndX = dxEnd / distEnd; normEndY = dyEnd / distEnd; }
        const despawnPoint = { x: pn.x + normEndX * extensionDistance, y: pn.y + normEndY * extensionDistance };

        return [spawnPoint, ...originalPath, despawnPoint];
    }
    // -------------------------------------------

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
        if (targetDistance < 0 || !this.cumulativeDistances || this.cumulativeDistances.length === 0) {
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
                 return { ...lastPoint }; 
             } else {
                 return null; 
             }
        }
        // Use EXTENDED path data here
        const p1 = this.extendedPathData[targetSegmentIndex]; 
        const p2 = this.extendedPathData[targetSegmentIndex + 1]; 
        const distanceToStartOfSegment = (targetSegmentIndex === 0) ? 0 : this.cumulativeDistances[targetSegmentIndex - 1];
        const distanceIntoSegment = targetDistance - distanceToStartOfSegment;
        const segmentLength = this.segmentLengths[targetSegmentIndex]; // Uses metrics calculated from extended path
        const factor = (segmentLength > 0.001) ? (distanceIntoSegment / segmentLength) : 0;
        const x = p1.x + (p2.x - p1.x) * factor;
        const y = p1.y + (p2.y - p1.y) * factor;
        return { x, y };
    }
}
