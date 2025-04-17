import Defence from './models/defender.js'; // May need Defence class if type checking/validation added

class PriceManager {
    /**
     * @param {DefenceManager} defenceManager - Instance of DefenceManager
     * @param {EnemyManager} enemyManager - Instance of EnemyManager
     * @param {Base} base - Instance of Base
     * @param {number} canvasWidth - Width of the game canvas
     * @param {number} canvasHeight - Height of the game canvas
     */
    constructor(defenceManager, enemyManager, base, canvasWidth, canvasHeight) {
        if (!defenceManager || !enemyManager || !base || !canvasWidth || !canvasHeight) {
            throw new Error("PriceManager requires defenceManager, enemyManager, base, canvasWidth, and canvasHeight.");
        }
        this.defenceManager = defenceManager;
        this.enemyManager = enemyManager;
        this.base = base;
        this.canvasWidth = canvasWidth;
        this.canvasHeight = canvasHeight;
    }

    /**
     * Calculates the dynamic cost for all available defences.
     * @returns {Object<string, number>} An object mapping defence IDs to their calculated costs.
     */
    calculateAllCosts() {
        const defenceDefinitions = this.defenceManager.getDefinitions();
        const enemyDefinitions = this.enemyManager.getEnemyDefinitions();
        const beta = this.base.stats.exchangeRate || 1;
        const maxDim = Math.max(this.canvasWidth, this.canvasHeight);

        const costs = {};

        // --- Calculate costs for ALL defenders based on definitions ---
        for (const defenceId in defenceDefinitions) {
            const def = defenceDefinitions[defenceId];
            // Basic validation for core stats needed for calculation OR static cost
            if (!def || !def.stats || 
                (typeof def.stats.attackStrength === 'undefined' && typeof def.stats.cost === 'undefined') ||
                (typeof def.stats.attackRate === 'undefined' && typeof def.stats.cost === 'undefined') ||
                (typeof def.stats.attackRange === 'undefined' && typeof def.stats.cost === 'undefined')) {
                
                console.warn(`PriceManager: Skipping defence ${defenceId} due to missing required stats (attack or cost).`);
                costs[defenceId] = Infinity; 
                continue;
            }

            const strength = def.stats.attackStrength;
            const rate = def.stats.attackRate;
            const range = def.stats.attackRange;
            // Use || 0 to handle cases where attackStrength might be undefined but cost exists
            const dps = (rate > 0 && strength > 0) ? (strength * 1000) / rate : 0;

            if (dps > 0) {
                // --- Calculate cost dynamically for damaging towers --- 
                let sumForThisDefence = 0;
                const effectiveRange = Math.min(range, maxDim); 

                for (const enemyId in enemyDefinitions) {
                    const enemy = enemyDefinitions[enemyId];
                     if (!enemy || !enemy.stats || !enemy.stats.speed || !enemy.stats.hp || !enemy.stats.bounty) {
                        // console.warn(`PriceManager: Skipping enemy ${enemyId} for defence ${defenceId} due to missing stats.`);
                        continue;
                    }
                    const speed = enemy.stats.speed;
                    const hp = enemy.stats.hp;
                    const bounty = enemy.stats.bounty;
                    const denominator = speed * hp;
                    if (denominator <= 0) { continue; }
                    const numerator = effectiveRange * dps * bounty;
                    sumForThisDefence += numerator / denominator;
                }
                costs[defenceId] = beta * sumForThisDefence;
                // --------------------------------------------------
            } else {
                // --- Use static cost for zero-DPS towers --- 
                if (typeof def.stats.cost === 'number') {
                     costs[defenceId] = def.stats.cost; // Read cost directly from definition
                 } else {
                     console.warn(`PriceManager: Zero-DPS tower ${defenceId} missing static 'cost' in definition. Setting cost to Infinity.`);
                     costs[defenceId] = Infinity; // Or 0 if you prefer
                 }
                 // ------------------------------------------
            }
        }

        // --- Phase 2 Removed --- 

        // Round costs
        for (const id in costs) {
            // Ensure we don't try to round Infinity
            if (costs[id] !== Infinity) { 
                costs[id] = Math.round(costs[id]);
            }
        }

        return costs;
    }
}

export default PriceManager; 