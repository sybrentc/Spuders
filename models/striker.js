import { distanceBetween } from '../utils/geometryUtils.js';

const MIN_EFFECTIVE_DISTANCE = 1.0; // Moved to module scope for clarity, or could be static class member

export default class Striker {
    /**
     * Represents a single bomb strike event, handling its damage application.
     * @param {object} bombPayload - Contains bomb strength, animation, and impactStdDevPixels.
     * @param {object} targetCoords - The intended {x, y} coordinates for the bomb's target.
     * @param {object} context - Either the main Game instance (for real strike) or an array of cloned defenders (for simulation).
     */
    constructor(bombPayload, targetCoords, context) {
        // console.log("[Striker CONSTRUCTOR START]"); // Log 1

        this._isInitializedSuccessfully = false;
        this._damageDealtR = 0; // To store the final result of the strike
        this.completionPromise = null; // Will be set to a Promise

        // Validate bombPayload
        if (!bombPayload || 
            typeof bombPayload.strengthA !== 'number' || bombPayload.strengthA <= 0 ||
            !bombPayload.animation || // Assuming animation object is always expected
            typeof bombPayload.impactStdDevPixels !== 'number' || bombPayload.impactStdDevPixels < 0) {
            console.error("Striker constructor: Invalid bombPayload provided.", bombPayload);
            // console.log("[Striker CONSTRUCTOR END - bombPayload validation failed]"); // Log 2a
            return; // Initialization failed
        }
        // console.log("[Striker Constructor] bombPayload VALID"); // Log 2b

        // Validate targetCoords
        if (!targetCoords || typeof targetCoords.x !== 'number' || typeof targetCoords.y !== 'number') {
            console.error("Striker constructor: Invalid targetCoords provided.", targetCoords);
            // console.log("[Striker CONSTRUCTOR END - targetCoords validation failed]"); // Log 3a
            return; // Initialization failed
        }
        // console.log("[Striker Constructor] targetCoords VALID"); // Log 3b

        // Validate context and determine strike type
        if (!context) {
            console.error("Striker constructor: Invalid context (game or clonedDefenders) provided.");
            // console.log("[Striker CONSTRUCTOR END - context validation failed (null/undefined)]"); // Log 4a
            return; // Initialization failed
        }
        // console.log("[Striker Constructor] context IS NOT NULL/UNDEFINED"); // Log 4b

        this.bombPayload = bombPayload;
        this.targetCoords = targetCoords;
        // _spareNormal is already initialized if we followed Plan II.1
        if (typeof this._spareNormal === 'undefined') { // Safety check, should be null from prior step
          this._spareNormal = null;
        }

        // Determine if it's a real strike and store relevant refs
        if (context.defenceManager && context.enemyManager && typeof context.getPathCoverageLookup === 'function') { // Added a more specific check for game object
            this.isRealStrike = true;
            this.gameRef = context; // It's the game object
            this.optionalClonedDefenders = null;
            // console.log("[Striker Constructor] Context determined: REAL STRIKE"); // Log 5a
        } else if (Array.isArray(context)) {
            this.isRealStrike = false;
            this.gameRef = null; 
            this.optionalClonedDefenders = context; // It's an array of cloned defenders
            // console.log("[Striker Constructor] Context determined: SIMULATED STRIKE"); // Log 5b
        } else {
            console.error("Striker constructor: Context is not a valid game instance or an array of defenders.", context);
            // console.log("[Striker CONSTRUCTOR END - context validation failed (invalid type)]"); // Log 5c
            return; // Initialization failed
        }

        // console.log("[Striker Constructor] Attempting to set isInitializedSuccessfully = true"); // Log 6
        this._isInitializedSuccessfully = true;
        // console.log(`[Striker Constructor] this._isInitializedSuccessfully is now: ${this._isInitializedSuccessfully}`); // Log 7

        // --- AUTONOMOUS STRIKE EXECUTION & PROMISE SETUP ---
        // The actual strike logic will be wrapped in a promise.
        // For now, this is a placeholder. The real execution will happen in _executeStrikeInternal (a new private method).
        this.completionPromise = new Promise(async (resolve, reject) => {
            // console.log("[Striker Constructor] completionPromise executor started."); // Log 8
            if (!this._isInitializedSuccessfully) {
                // This case should ideally be caught before promise creation, but as a safeguard.
                // console.error("[Striker completionPromise] Strike not initialized successfully, rejecting promise.");
                reject(new Error("Striker not initialized successfully before attempting to execute strike."));
                return;
            }
            try {
                // In future steps, we will call an internal method here that performs the strike logic
                // e.g., this._damageDealtR = await this._executeStrikeInternal();
                // For now, let's assume _executeStrikeInternal will be defined later and resolve immediately for testing.
                // console.log("Striker: Placeholder for _executeStrikeInternal call.");
                // Simulating an async operation that will eventually calculate damage.
                // Replace this with the actual call to _executeStrikeInternal in later steps.
                // setTimeout(() => { // Simulate async work
                //     // this._damageDealtR will be set by the actual strike logic later.
                //     // For now, just resolving with a placeholder. When _executeStrikeInternal is done, it will set this._damageDealtR.
                //     resolve(this._damageDealtR); // Resolve with the stored damage
                // }, 0);
                this._damageDealtR = await this._executeStrikeInternal();
                resolve(this._damageDealtR);
            } catch (error) {
                console.error("Striker: Error during internal strike execution (within promise):", error);
                reject(error);
            }
        });
        // --- END AUTONOMOUS STRIKE EXECUTION ---
        // console.log("[Striker CONSTRUCTOR END - SUCCESS]"); // Log 9
    }

    // Placeholder for the synchronous initialization check method
    // This is called by StrikeManager
    isInitializedSuccessfully() {
        // console.log(`[Striker isInitializedSuccessfully() CALLED] Returning: ${this._isInitializedSuccessfully}`); // Log 10
        return this._isInitializedSuccessfully;
    }

    /**
     * Applies bomb damage to defenders and, if real, to enemies.
     * @param {boolean} isRealStrike - True if this is a real bomb, false if a simulation.
     * @param {Array<DefenceEntity>} [optionalClonedDefenders=null] - For simulation, a list of cloned defenders.
     * @returns {number} The total Delta R (damage dealt to defenders).
     */
    // applyExplosionDamage(isRealStrike, optionalClonedDefenders = null) { // Method to be removed
    //     if (!this.valid) {
    //         console.error("Striker.applyExplosionDamage: Striker instance is not valid. Aborting damage application.");
    //         return 0;
    //     }

    //     let totalDeltaRFromDefenders = 0;
    //     const MIN_EFFECTIVE_DISTANCE = 1.0; // Prevent division by zero/extreme damage

    //     let defendersToProcess;
    //     if (isRealStrike) {
    //         if (!this.gameRef.defenceManager) {
    //             console.error("Striker.applyExplosionDamage: DefenceManager not found on gameRef for real strike.");
    //             return 0;
    //         }
    //         defendersToProcess = this.gameRef.defenceManager.getActiveDefences();
    //     } else {
    //         if (!optionalClonedDefenders || !Array.isArray(optionalClonedDefenders)) {
    //             console.error("Striker.applyExplosionDamage: Invalid or missing optionalClonedDefenders for simulated strike.");
    //             return 0;
    //         }
    //         defendersToProcess = optionalClonedDefenders;
    //     }

    //     // Process Defenders
    //     if (defendersToProcess && Array.isArray(defendersToProcess)) {
    //         for (const defender of defendersToProcess) {
    //             if (defender.isDestroyed) {
    //                 continue;
    //             }
    //             const dist = distanceBetween({ x: defender.x, y: defender.y }, this.impactCoords);
    //             const effectiveDistance = Math.max(dist, MIN_EFFECTIVE_DISTANCE);
    //             const potentialDamage = this.bombStrengthA / (effectiveDistance * effectiveDistance);

    //             if (potentialDamage > 0) {
    //                 const damageTaken = defender.hit(potentialDamage);
    //                 totalDeltaRFromDefenders += damageTaken;
    //             }
    //         }
    //     }

    //     // Process Enemies (Collateral Damage for Real Strikes)
    //     if (isRealStrike) {
    //         if (!this.gameRef.enemyManager) {
    //             console.error("Striker.applyExplosionDamage: EnemyManager not found on gameRef for real strike.");
    //             // Continue with defender damage, but log error for enemies
    //         } else {
    //             const enemiesToProcess = this.gameRef.enemyManager.getActiveEnemies();
    //             if (enemiesToProcess && Array.isArray(enemiesToProcess)) {
    //                 for (const enemy of enemiesToProcess) {
    //                     if (enemy.isDead) {
    //                         continue;
    //                     }
    //                     const enemyPos = enemy.getCurrentPosition ? enemy.getCurrentPosition() : { x: enemy.x, y: enemy.y };
    //                     if (!enemyPos || typeof enemyPos.x !== 'number' || typeof enemyPos.y !== 'number') {
    //                         console.warn("Striker.applyExplosionDamage: Could not determine valid position for an enemy. Skipping it.", enemy);
    //                         continue;
    //                     }
    //                     const dist = distanceBetween(enemyPos, this.impactCoords);
    //                     const effectiveDistance = Math.max(dist, MIN_EFFECTIVE_DISTANCE);
    //                     const potentialDamage = this.bombStrengthA / (effectiveDistance * effectiveDistance);

    //                     if (potentialDamage > 0) {
    //                         enemy.hit(potentialDamage);
    //                     }
    //                 }
    //             }
    //         }
    //     }
    //     return totalDeltaRFromDefenders;
    // }

    // --- ADDED FROM STRIKEMANAGER (Plan II.1) ---
    /**
     * Generates a normally distributed random number.
     * Uses the Box-Muller transform.
     * @param {number} mean - The mean of the distribution.
     * @param {number} stdDev - The standard deviation of the distribution.
     * @returns {number} A random number from the specified normal distribution.
     */
    _generateNormalRandom(mean, stdDev) {
        // Use Box-Muller transform
        // Check if we have a spare value from the previous calculation
        if (this._spareNormal !== null) {
            const result = mean + stdDev * this._spareNormal;
            this._spareNormal = null; // Consume the spare value
            return result;
        }

        // No spare value, generate two new standard normals
        let u1, u2;
        do {
            // Math.random() gives [0, 1). We need (0, 1) for log().
            u1 = Math.random();
        } while (u1 === 0);
        u2 = Math.random(); // This one can be 0

        const radius = Math.sqrt(-2.0 * Math.log(u1));
        const angle = 2.0 * Math.PI * u2;

        const standardNormal1 = radius * Math.cos(angle);
        const standardNormal2 = radius * Math.sin(angle);

        // Store the second value for the next call
        this._spareNormal = standardNormal2;

        // Return the first value, scaled and shifted
        return mean + stdDev * standardNormal1;
    }
    // --- END ADDED ---

    // --- ADDED: Plan II.3 --- 
    /**
     * Calculates the randomized impact coordinates based on target coordinates
     * using a normal distribution for inaccuracy.
     * @returns {object} The calculated impact coordinates {x, y}. Returns targetCoords if spread is 0 or not configured.
     * @private Internal method
     */
    _calculateImpactCoordinates() {
        if (!this.targetCoords) { // Should have been validated in constructor
            console.error("Striker._calculateImpactCoordinates: targetCoords not available.");
            return { x: 0, y: 0 }; // Should not happen if constructor validated
        }
        if (!this.bombPayload || typeof this.bombPayload.impactStdDevPixels !== 'number') {
            console.error("Striker._calculateImpactCoordinates: bombPayload or impactStdDevPixels not available/valid.");
            return { ...this.targetCoords }; // Return original target if misconfigured
        }

        const stdDev = this.bombPayload.impactStdDevPixels;

        if (stdDev <= 0) {
            // No spread, return target coordinates directly
            return { ...this.targetCoords };
        }

        // Generate random offsets using normal distribution (mean 0)
        const offsetX = this._generateNormalRandom(0, stdDev);
        const offsetY = this._generateNormalRandom(0, stdDev);

        // Calculate impact coordinates
        const impactX = this.targetCoords.x + offsetX;
        const impactY = this.targetCoords.y + offsetY;

        // Note: Clamping to map bounds could be added here if necessary, 
        // but current plan doesn't specify it for Striker directly.
        // StrikeManager used to do it, but it depended on mapWidth/mapHeight directly.
        // If clamping is needed, Striker would need access to map dimensions.
        return { x: impactX, y: impactY };
    }
    // --- END ADDED ---

    // --- ADDED: Plan II.4 --- 
    async _executeStrikeInternal() {
        // console.log("[Striker _executeStrikeInternal() CALLED]"); // Log 11
        let totalDeltaRFromDefenders = 0;

        // Step 1: Determine Impact Point
        const actualImpactCoords = this._calculateImpactCoordinates();
        if (!actualImpactCoords) { // Should not happen if _calculateImpactCoordinates is robust
            console.error("Striker._executeStrikeInternal: Failed to calculate impact coordinates.");
            throw new Error("Failed to calculate impact coordinates in Striker."); // Propagate error to promise
        }

        // Step 2: Identify Targets
        let defendersToProcess = [];
        let enemiesToProcess = []; // Only used for real strikes

        if (this.isRealStrike) {
            if (!this.gameRef || !this.gameRef.defenceManager || !this.gameRef.enemyManager) {
                console.error("Striker._executeStrikeInternal: Game reference or managers not available for real strike.");
                throw new Error("Missing game reference or managers for real strike in Striker.");
            }
            defendersToProcess = this.gameRef.defenceManager.getActiveDefences();
            enemiesToProcess = this.gameRef.enemyManager.getActiveEnemies();
        } else {
            if (!this.optionalClonedDefenders || !Array.isArray(this.optionalClonedDefenders)) {
                console.error("Striker._executeStrikeInternal: Invalid or missing optionalClonedDefenders for simulated strike.");
                throw new Error("Invalid cloned defenders for simulated strike in Striker.");
            }
            defendersToProcess = this.optionalClonedDefenders;
            // No enemies for simulated strikes as per plan
        }

        // Step 3: Apply Damage and Calculate Defender Delta R
        if (defendersToProcess) { // Check if defendersToProcess is not null/undefined
            for (const defender of defendersToProcess) {
                if (!defender || defender.isDestroyed) { // Basic check for valid defender object and not destroyed
                    continue;
                }
                // Ensure defender has position (x, y) and hit method
                if (typeof defender.x !== 'number' || typeof defender.y !== 'number' || typeof defender.hit !== 'function') {
                    console.warn("Striker: Skipping defender due to missing position or hit method.", defender);
                    continue;
                }

                const dist = distanceBetween({ x: defender.x, y: defender.y }, actualImpactCoords);
                const effectiveDistance = Math.max(dist, MIN_EFFECTIVE_DISTANCE);
                const potentialDamage = this.bombPayload.strengthA / (effectiveDistance * effectiveDistance);

                if (potentialDamage > 0) {
                    const damageTaken = defender.hit(potentialDamage);
                    if (typeof damageTaken === 'number') {
                        totalDeltaRFromDefenders += damageTaken;
                    }
                }
            }
        }

        // Process Enemies (Collateral Damage for Real Strikes)
        if (this.isRealStrike && enemiesToProcess) { // Check if enemiesToProcess is not null/undefined
            for (const enemy of enemiesToProcess) {
                 if (!enemy || enemy.isDead) { // Basic check for valid enemy object and not dead
                    continue;
                }
                // Ensure enemy has position (via getCurrentPosition or x,y) and hit method
                const enemyPos = enemy.getCurrentPosition ? enemy.getCurrentPosition() : (typeof enemy.x === 'number' && typeof enemy.y === 'number' ? { x: enemy.x, y: enemy.y } : null);
                if (!enemyPos || typeof enemy.hit !== 'function') {
                    console.warn("Striker: Skipping enemy due to missing position or hit method.", enemy);
                    continue;
                }

                const dist = distanceBetween(enemyPos, actualImpactCoords);
                const effectiveDistance = Math.max(dist, MIN_EFFECTIVE_DISTANCE);
                const potentialDamage = this.bombPayload.strengthA / (effectiveDistance * effectiveDistance);

                if (potentialDamage > 0) {
                    enemy.hit(potentialDamage);
                }
            }
        }
        
        // console.log(`Striker._executeStrikeInternal: Calculated totalDeltaRFromDefenders: ${totalDeltaRFromDefenders}`);
        return totalDeltaRFromDefenders;
    }
    // --- END ADDED ---
} 