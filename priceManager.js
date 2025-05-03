import Defence from './models/defender.js'; // May need Defence class if type checking/validation added

// --- Helper to load CSV Lookup Table ---
async function loadCsvLookup(filePath) {
    try {
        const response = await fetch(filePath);
        if (!response.ok) {
             throw new Error(`HTTP error! status: ${response.status} loading ${filePath}`);
        }
        const data = await response.text();
        const lines = data.trim().split('\n');
        const header = lines.shift(); // Remove header row
        // Assuming CSV format: range,coverage_fraction
        // We'll create an array where index corresponds to range.
        // Array will be padded at the start (index 0 unused).
        const lookup = [0]; // Index 0 unused
        let maxRange = 0;
        lines.forEach(line => {
            const [rangeStr, fractionStr] = line.split(',');
            const range = parseInt(rangeStr, 10);
            const fraction = parseFloat(fractionStr);
            if (!isNaN(range) && !isNaN(fraction) && range > 0) {
                // Fill gaps if CSV is sparse (though ours isn't)
                while (lookup.length <= range) {
                    lookup.push(lookup[lookup.length - 1] || 0); // Pad with previous value
                }
                lookup[range] = fraction;
                maxRange = Math.max(maxRange, range);
            } else {
                 console.warn(`PriceManager: Skipping invalid line in coverage CSV: "${line}"`);
            }
        });
        //console.log(`PriceManager: Loaded coverage lookup table up to range ${maxRange}`);
        return lookup;
    } catch (error) {
        console.error(`PriceManager: Error loading coverage lookup table from ${filePath}:`, error);
        throw error; // Re-throw after logging
    }
}
// --- End Helper ---

class PriceManager extends EventTarget {
    /**
     * @param {DefenceManager} defenceManager - Instance of DefenceManager
     * @param {EnemyManager} enemyManager - Instance of EnemyManager
     * @param {Base} base - Instance of Base
     * @param {Game} game - The main Game instance
     */
    constructor(defenceManager, enemyManager, base, game) {
        if (!defenceManager || !enemyManager || !base) {
            throw new Error("PriceManager requires defenceManager, enemyManager, and base.");
        }
        // Added check for game instance - UPDATED to check for getAlphaFactor
        if (!game || typeof game.getAlpha !== 'function') { 
            throw new Error("PriceManager requires a valid Game instance.");
        }
        super();
        this.defenceManager = defenceManager;
        this.enemyManager = enemyManager;
        this.base = base; // Keep base for now, might be needed elsewhere?
        this.game = game; // Store the game instance
        this.isLoaded = false;
        this.cachedCosts = {}; // Add property to store costs
    }

    /**
     * Loads necessary data - NOW HANDLED BY GAME
     */
    async load() {
        // REMOVED: Coverage data loading logic is now in Game.js
        // Consider if this method needs to do anything else, or can be removed.
        // For now, just mark as loaded (assuming Game handles dependencies).
        this.isLoaded = true; 
        //console.log("PriceManager: Load method called (coverage loading handled by Game).");
        // REMOVED: Error handling related to coverage loading
    }

    /**
     * Calculates the dynamic cost for all available defences using the refined formula.
     * Cost = beta * AverageEarningRate
     * AverageEarningRate = Average over enemies [ R_star * f_e * f_k ]
     *   R_star: Ideal bounty rate (bounty / timeToKill, using ceil(shots))
     *   f_e: Engagement factor (from path coverage lookup table)
     *   f_k: Kill completion factor (min(timeInRange / timeToKill, 1))
     *
     * @returns {Object<string, number>} An object mapping defence IDs to their calculated costs.
     */
    async calculateAllCosts() {
        // REMOVED: Check for this.isLoaded if it was only for coverage
        // if (!this.isLoaded) { ... }

        // --- Get coverage data from Game instance --- 
        let coverageLookup;
        try {
            // Use the synchronous getter pattern if getPathCoverageLookup ensures data is loaded
            // If getPathCoverageLookup is async, calculateAllCosts would need to become async too.
            // Assuming synchronous getter after game initialization:
            coverageLookup = await this.game.getPathCoverageLookup();
            if (!coverageLookup || coverageLookup.length === 0) {
                throw new Error("Coverage lookup table is empty or not available from Game.");
            }
        } catch (error) {
             console.error("PriceManager: Failed to get coverage lookup table:", error);
             // Return default high costs or throw?
            const defaultCostsOnError = {};
            for (const defenceId in this.defenceManager.getDefinitions()) {
                defaultCostsOnError[defenceId] = Infinity;
            }
            return defaultCostsOnError;
        }
        // --- End Get coverage data --- 

        const defenceDefinitions = this.defenceManager.getDefinitions();
        const enemyDefinitions = this.enemyManager.getEnemyDefinitions();
        // Use game.getAlpha() to get the live effective alpha (a * α₀)
        const effective_alpha = this.game.getAlpha();
        const costs = {};

        // --- Handle case where alpha factor couldn't be calculated ---
        if (effective_alpha === null || effective_alpha <= 0) {
            console.error(`PriceManager: Invalid effective_alpha (${effective_alpha}) from Game. Setting all costs to Infinity.`);
            for (const defenceId in defenceDefinitions) {
                costs[defenceId] = Infinity;
            }
            return costs;
        }
        // ----------------------------------------------------------

        // --- Calculate costs for ALL defenders based on definitions ---
        for (const defenceId in defenceDefinitions) {
            const def = defenceDefinitions[defenceId];
                
            // --- Basic Validation --- 
            if (!def || !def.stats) {
                console.warn(`PriceManager: Skipping defence ${defenceId} due to missing stats block.`);
                costs[defenceId] = Infinity; 
                continue;
            }

            const hasStaticCost = typeof def.stats.cost === 'number';
            const hasAttackStats = typeof def.stats.attackStrength === 'number' && 
                                   typeof def.stats.attackRate === 'number' && 
                                   typeof def.stats.attackRange === 'number';

            if (!hasStaticCost && !hasAttackStats) {
                 console.warn(`PriceManager: Skipping defence ${defenceId} due to missing required stats (cost or attack stats).`);
                 costs[defenceId] = Infinity;
                 continue;
            }
            // --- End Validation --- 

            const strength = def.stats.attackStrength;
            const rate = def.stats.attackRate; // ms per shot
            const range = def.stats.attackRange;

            // --- Handle Non-Damaging (Zero Strength or Rate) / Static Cost Towers --- 
            if (strength === undefined || strength <= 0 || rate === undefined || rate <= 0) {
                if (hasStaticCost) {
                     costs[defenceId] = def.stats.cost; // Read cost directly from definition
                 } else {
                     // This case should be caught by validation above, but as a fallback:
                     console.warn(`PriceManager: Non-damaging tower ${defenceId} missing static 'cost'. Setting cost to Infinity.`);
                     costs[defenceId] = Infinity; 
                 }
                 continue; // Move to next defence
            }
            // --- End Non-Damaging Tower Logic --- 

            // --- Dynamic Cost Calculation for Damaging Towers --- 
            let sumOfEnemyEarningRates = 0;
            let validEnemyCount = 0;

            // --- Get Total Path Length ONCE before the loop --- 
            const totalPathLength = this.game.getTotalPathLength();
            if (totalPathLength === null || totalPathLength <= 0) {
                 console.error(`PriceManager: Invalid totalPathLength (${totalPathLength}) from Game instance. Cannot calculate dynamic costs.`);
                 costs[defenceId] = Infinity;
                 continue; // Skip this defence if path length is invalid
            }
            // ------------------------------------------------

            for (const enemyId in enemyDefinitions) {
                const enemy = enemyDefinitions[enemyId];
                 if (!enemy || !enemy.stats || !enemy.stats.speed || enemy.stats.speed <= 0 || !enemy.stats.hp || enemy.stats.hp <= 0) {
                    continue; // Skip invalid enemies
                }

                // --- Get Pre-calculated Bounty --- 
                const bounty = enemy.bounty; // <-- Use pre-calculated bounty from enemy definition
                if (bounty === undefined || bounty <= 0) { // Check if bounty is valid
                    // console.warn(`PriceManager: Skipping enemy ${enemyId} for cost calculation due to invalid bounty (${bounty}).`);
                    continue; // If bounty is 0 or invalid, skip this enemy
                }
                // --- END Get Bounty ---

                validEnemyCount++;

                const speed = enemy.stats.speed;
                // Use original HP for timeToKill calculation, as strength is based on original HP scale
                const originalHp = enemy.originalHp; // <-- Use originalHp
                if (typeof originalHp !== 'number' || originalHp <= 0) {
                     console.warn(`PriceManager: Invalid originalHp (${originalHp}) for enemy ${enemyId}. Skipping.`);
                     validEnemyCount--; // Decrement count as this enemy is invalid for this calculation
                     continue;
                }

                // --- Calculate R* (Ideal Bounty Rate) --- 
                const timePerShotSec = rate / 1000.0;
                const shotsToKill = Math.ceil(originalHp / strength); // <-- Use originalHp
                const timeToKillSec = shotsToKill * timePerShotSec;
                const R_star = (timeToKillSec > 1e-6) ? (bounty / timeToKillSec) : 0; // <-- Use pre-calculated bounty
                
                if (R_star <= 0) continue; // Cannot earn from this enemy

                // --- Calculate f_e (Engagement Factor) --- 
                const lookupRange = Math.max(1, Math.min(Math.round(range), coverageLookup.length - 1));
                const f_e = coverageLookup[lookupRange] || 0; // Default to 0 if lookup fails

                // --- Calculate f_k (Kill Completion Factor) --- 
                // const timeInRangeSec = range / speed; // OLD calculation
                // REFINED calculation using actual path length in range:
                const pathLengthInRange = totalPathLength * f_e;
                const timeInRangeSec = (speed > 1e-6) ? (pathLengthInRange / speed) : 0; // Avoid division by zero
                
                const f_k = (timeToKillSec > 1e-6) ? Math.min(timeInRangeSec / timeToKillSec, 1.0) : 0; // Avoid division by zero

                // --- Calculate and Accumulate --- 
                const earningRateEnemy = R_star * f_e * f_k;
                sumOfEnemyEarningRates += earningRateEnemy;
            }

            // --- Calculate Final Cost --- 
            if (validEnemyCount > 0) {
                const avgEarningRate = sumOfEnemyEarningRates / validEnemyCount;
                costs[defenceId] = effective_alpha * avgEarningRate; // Use effective_alpha (a * α₀)
            } else {
                console.warn(`PriceManager: No valid enemies found to calculate cost for ${defenceId}. Setting cost to Infinity.`);
                costs[defenceId] = Infinity; // No valid enemies to base cost upon
            }
            // --------------------------------------------------
        }

        // Round costs based on value
        for (const id in costs) {
            if (costs[id] !== Infinity && !isNaN(costs[id])) {
                if (costs[id] < 500) {
                    // Round to nearest 10 for prices below 500
                    costs[id] = Math.round(costs[id] / 10) * 10;
                } else {
                    // Round to nearest 50 for prices 500 and above
                    costs[id] = Math.round(costs[id] / 50) * 50;
                }
            } else if (isNaN(costs[id])) {
                 console.warn(`PriceManager: Calculated cost for ${id} resulted in NaN. Setting to Infinity.`);
                 costs[id] = Infinity;
            }
        }

        return costs;
    }

    /**
     * Recalculates all defence costs, stores them internally,
     * and dispatches an event.
     */
    async recalculateAndStoreCosts() {
        // Use the existing calculation logic
        const costs = await this.calculateAllCosts();
        this.cachedCosts = costs;
        // Dispatch an event to notify listeners
        this.dispatchEvent(new CustomEvent('costsUpdated'));
        // console.log("PriceManager: Costs recalculated and event dispatched.", this.cachedCosts); // Optional debug log
    }

    /**
     * Gets the latest cached costs.
     * @returns {Object<string, number>} The cached costs.
     */
    getStoredCosts() {
        return this.cachedCosts;
    }
}

export default PriceManager; 