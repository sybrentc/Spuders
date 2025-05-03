import DefenceEntity from './models/defender.js'; // Import the entity class

/**
 * Compares two definition objects to see if relevant source fields have changed.
 * @param {object} newDef - The new definition data.
 * @param {object} currentDef - The currently stored definition data.
 * @returns {boolean} True if a relevant change is detected, false otherwise.
 */
function haveDefsChanged(newDef, currentDef) {
    if (!currentDef) return true; // It's a new definition

    // Compare simple primitive fields directly
    const simpleFields = ['name', 'cost']; // Add other simple fields if necessary
    for (const field of simpleFields) {
        if (newDef[field] !== undefined && newDef[field] !== currentDef[field]) {
            // console.log(`DEBUG Def Change [${newDef.id}]: Simple field '${field}': ${currentDef[field]} -> ${newDef[field]}`);
            return true;
        }
    }

    // Compare stats object - field by field
    const newStats = newDef.stats || {};
    const currentStats = currentDef.stats || {};
    const statsFields = ['attackRate', 'attackStrength', 'attackRange']; // Add other relevant base stats
    // Check fields present in new stats
    for (const field of statsFields) {
        if (newStats[field] !== undefined && newStats[field] !== currentStats[field]) {
             // Add tolerance for floats later if needed, direct compare for now
            // console.log(`DEBUG Def Change [${newDef.id}]: Stats field '${field}': ${currentStats[field]} -> ${newStats[field]}`);
            return true;
        }
    }
    // Check if any fields were removed in new stats (that existed in current)
    for (const field of statsFields) {
         if (currentStats[field] !== undefined && newStats[field] === undefined) {
             // console.log(`DEBUG Def Change [${newDef.id}]: Stats field '${field}' removed.`);
             return true;
         }
    }

    // Compare other complex fields using stringify as a fallback (less critical usually)
    const complexFields = ['effects', 'sprite', 'display'];
    for (const field of complexFields) {
        const newFieldData = newDef[field];
        const currentFieldData = currentDef[field];

        // Check existence consistency
        const newFieldExists = newFieldData !== undefined && newFieldData !== null;
        const currentFieldExists = currentFieldData !== undefined && currentFieldData !== null;
        if (newFieldExists !== currentFieldExists) {
             // console.log(`DEBUG Def Change [${newDef.id}]: Existence mismatch for field '${field}'`);
             return true; // One has it, the other doesn't
        }

        // If both exist, compare contents using stringify
        if (newFieldExists) { // Implies currentFieldExists is also true
            if (JSON.stringify(newFieldData) !== JSON.stringify(currentFieldData)) {
                 // console.log(`DEBUG Def Change [${newDef.id}]: Content mismatch for field '${field}'`);
                 return true;
            }
        }
    }

    return false; // No changes detected
}

// Make DefenceManager an EventTarget to dispatch update events
export default class DefenceManager extends EventTarget {
    constructor(game) { // Accept Game instance instead of individual managers
        super(); // Call EventTarget constructor
        if (!game) {
            throw new Error("DefenceManager requires a valid Game instance.");
        }
        this.game = game; // Store reference to the game instance
        this.enemyManager = game.enemyManager; // Convenience reference
        this.base = game.base; // Convenience reference
        this.defenceDefinitions = {}; // To store loaded defence data by ID
        this.activeDefences = []; // Array to hold active instances
        this.isLoaded = false;
        this.dataPath = './assets/defences.json'; // Assume default path or get from game config if needed
    }

    async loadDefinitions(dataPath = this.dataPath) { // Renamed from load for clarity
        try {
            const response = await fetch(dataPath);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            
            // Process and store definitions, perhaps indexed by ID
            if (Array.isArray(data)) {
                data.forEach(def => {
                    if (def.id) {
                        this.defenceDefinitions[def.id] = def;
                    }
                });
            } else {
                // Handle cases where data might be an object, if applicable
                this.defenceDefinitions = data;
            }
            
            this.isLoaded = true;
            //console.log(`DefenceManager: Loaded ${Object.keys(this.defenceDefinitions).length} defence definitions from ${dataPath}`);
            // TODO: Load associated assets (sprites, sounds) if needed later

        } catch (error) {
            console.error(`DefenceManager: Failed to load defence data from ${dataPath}:`, error);
            this.isLoaded = false;
            // Re-throw or handle error appropriately
            throw error;
        }
    }

    createDefence(defenceId, position) {
        // TODO: Logic to create an instance of a specific defence
        //console.log(`DefenceManager: Attempting to create defence ${defenceId} at`, position);
        const definition = this.defenceDefinitions[defenceId];
        if (!definition) {
            console.error(`DefenceManager: Unknown defence ID: ${defenceId}`);
            return null;
        }
        // Actual instance creation would go here, likely returning a new object/class instance
        return { ...definition, x: position.x, y: position.y }; // Simple placeholder
    }

    async placeDefence(defenceId, position) {
        const definition = this.defenceDefinitions[defenceId];
        if (!definition) {
            console.error(`DefenceManager: Unknown defence ID: ${defenceId}`);
            return null;
        }
        
        // DEBUG: Log definition being used for placement
        if (defenceId === 'axolotl_gunner') {
             //console.log(`PLACE LOG (${defenceId}): Using definition stats:`, JSON.stringify(definition.stats));
        }

        // Get dynamically calculated cost from PriceManager
        if (!this.game.priceManager) {
            console.error("DefenceManager: PriceManager not available on Game instance.");
            return null;
        }
        const calculatedCosts = await this.game.priceManager.calculateAllCosts();
        const cost = calculatedCosts[defenceId];

        if (cost === undefined || cost === Infinity) {
             console.error(`DefenceManager: Invalid calculated cost (${cost}) for ${defenceId}. Cannot place.`);
             return null;
        }

        // Check cost vs player currency using calculated cost
        if (!this.base.canAfford(cost)) {
            //console.log(`Cannot afford ${defenceId}. Cost: ${cost}, Funds: ${this.base.currentFunds}`);
            // Optionally: Provide UI feedback here (e.g., flash cost red)
            return null; // Placement failed
        }

        // Spend funds *before* creating the entity
        if (!this.base.spendFunds(cost)) {
             // This check is slightly redundant due to canAfford, but safe
             console.error(`Placement Error: Failed to spend funds for ${defenceId} even after canAfford check.`);
             return null;
        }
        
        // Create and add the defence
        const newDefence = new DefenceEntity(defenceId, definition, position, definition.sprite);
        this.activeDefences.push(newDefence);
        //console.log(`DefenceManager: Placed ${defenceId} at (${position.x}, ${position.y}). Total defences: ${this.activeDefences.length}`);
        return newDefence; // Return the created instance
    }

    update(timestamp, deltaTime) {
        // Get active enemies directly from EnemyManager
        const activeEnemies = this.enemyManager ? this.enemyManager.getActiveEnemies() : [];
        
        // Update all active defence instances
        this.activeDefences.forEach(defence => {
            // Pass the fetched enemies list to each defence entity
            defence.update(timestamp, deltaTime, activeEnemies); 
        });
        // TODO: Remove destroyed defences
        // --- Filter out destroyed defenders ---
        const initialCount = this.activeDefences.length;
        this.activeDefences = this.activeDefences.filter(defence => !defence.isDestroyed);
        const finalCount = this.activeDefences.length;
        if (initialCount > finalCount) {
            //console.log(`DefenceManager: Removed ${initialCount - finalCount} worn-out defender(s).`); // Optional log
        }
        // --- End Filter ---
    }

    render(ctx) {
        // Render all active defence instances
        this.activeDefences.forEach(defence => {
            defence.render(ctx);
        });
    }

    // Method to access the raw definitions (e.g., for UI)
    getDefinitions() {
        return this.defenceDefinitions;
    }

    // Method to render effects (called before enemies)
    renderEffects(ctx) {
        this.activeDefences.forEach(defence => {
            if (typeof defence.renderEffects === 'function') {
                defence.renderEffects(ctx);
            }
        });
    }

    // Method called by TuningManager when new data is fetched
    applyParameterUpdates(newData) {
        // console.log("DEBUG: DefenceManager.applyParameterUpdates called");

        let definitionsChanged = false;
        const checkSingleDef = (def) => {
            if (definitionsChanged) return; // Stop checking if a change is already found
            if (!def || !def.id) return;
            if (haveDefsChanged(def, this.defenceDefinitions[def.id])) {
                 definitionsChanged = true;
            }
        };

        // Perform the comparison check first using the helper
        if (Array.isArray(newData)) {
             newData.forEach(checkSingleDef);
        } else if (typeof newData === 'object' && newData !== null) {
            if (newData.id) { // Single object
                checkSingleDef(newData);
            } else { // Dictionary of definitions
                Object.values(newData).forEach(checkSingleDef);
            }
        } else {
            console.error("DefenceManager.applyParameterUpdates: Invalid newData format for comparison.", newData);
            return; // Don't proceed with invalid data
        }

        // If no changes detected based on the helper function, exit early
        if (!definitionsChanged) {
             // console.log(`DefenceManager: No relevant changes detected in incoming definitions data.`);
             return;
        }

        // --- Changes were detected, proceed with merging and updating --- 
        console.log("DefenceManager: Change detected in source definitions, proceeding with update..."); // Keep this log

        const newDefinitions = {};
        const processDefinitionMerge = (def) => {
            if (!def || !def.id) return;

            const currentDef = this.defenceDefinitions[def.id] || {}; // Use empty object if new
            const currentStats = currentDef.stats || {};
            const mergedDef = { ...currentDef, ...def }; // Merge top-level, new overwrites old

            // --- Deeper merge for specific nested objects if needed --- 
            // Merge stats carefully
            if (def.stats) {
                 mergedDef.stats = { ...currentStats, ...def.stats };
            }
            // Merge effects (assuming new definition fully replaces old effects)
            if (def.effects !== undefined) { // Check if effects key exists in new data
                 mergedDef.effects = def.effects; // Replace whole object (or set null/undefined)
            } else if (currentDef.effects !== undefined) {
                 // Keep existing effects if not specified in new data
                 mergedDef.effects = currentDef.effects;
            }
            // Merge sprite (assuming new definition fully replaces old sprite)
            if (def.sprite !== undefined) {
                mergedDef.sprite = def.sprite;
            } else if (currentDef.sprite !== undefined) {
                 mergedDef.sprite = currentDef.sprite;
            }
             // Merge display (assuming new definition fully replaces old display)
            if (def.display !== undefined) {
                mergedDef.display = def.display;
            } else if (currentDef.display !== undefined) {
                 mergedDef.display = currentDef.display;
            }
            // --- End Deeper Merge --- 
            
            // --- Preserve calculated wear params if they exist on current and aren't explicitly in new data --- 
            // Ensure stats object exists on mergedDef after potential merges
            if (!mergedDef.stats) mergedDef.stats = {}; 
            
            // Preserve calculated wear params (maxHp, wearDecrement, wearEnabled)
            // These should only be overwritten if calculateWearParameters runs again
            if (currentStats.wearEnabled !== undefined && mergedDef.stats.wearEnabled === undefined) {
                mergedDef.stats.wearEnabled = currentStats.wearEnabled;
            }
            if (currentStats.maxHp !== undefined && mergedDef.stats.maxHp === undefined) {
                mergedDef.stats.maxHp = currentStats.maxHp;
            }
            if (currentStats.wearDecrement !== undefined && mergedDef.stats.wearDecrement === undefined) {
                mergedDef.stats.wearDecrement = currentStats.wearDecrement;
            }
            // --- End Preserve --- 

            newDefinitions[def.id] = mergedDef;
        };

        // Perform the merge using the same iteration logic as the comparison
        if (Array.isArray(newData)) {
             newData.forEach(processDefinitionMerge);
        } else if (typeof newData === 'object' && newData !== null) {
            if (newData.id) { // Single object
                processDefinitionMerge(newData);
            } else { // Dictionary of definitions
                Object.values(newData).forEach(processDefinitionMerge);
            }
        }

        // --- Update internal definitions and propagate --- 
        this.defenceDefinitions = newDefinitions;

        // Propagate updates to active instances
        this.activeDefences.forEach(defence => {
            const updatedDef = this.defenceDefinitions[defence.id];
            if (updatedDef && typeof defence.applyUpdate === 'function') {
                defence.applyUpdate(updatedDef);
            }
        });

        // Dispatch an event to notify listeners (like the UI)
        this.dispatchEvent(new CustomEvent('definitionsUpdated'));

        // --- Recalculate wear parameters (maxHp, wearDecrement) --- 
        console.log("DefenceManager: Definitions updated, recalculating own wear parameters (maxHp, wearDecrement)."); // Updated log msg
        this.calculateWearParameters();
    }

    // Add getter for active defences
    getActiveDefences() {
        return this.activeDefences;
    }

    async calculateWearParameters() {
        // REMOVED: console.log("DEBUG: Starting calculateWearParameters...");

        if (!this.isLoaded) {
            console.error("DefenceManager: Cannot calculate wear parameters, definitions not loaded.");
        }

        let coverageLookup;
        try {
            // REMOVED: console.log("DEBUG: calculateWearParameters - Attempting to get coverage lookup...");
            coverageLookup = await this.game.getPathCoverageLookup(); 
            if (!coverageLookup || coverageLookup.length === 0) {
                throw new Error("Coverage lookup table is empty or not available.");
            }
            // REMOVED: console.log(`DEBUG: calculateWearParameters - Got coverage lookup (length: ${coverageLookup.length})`);
        } catch (error) {
            console.error("DefenceManager: Failed to get coverage lookup table:", error);
            return; // Cannot proceed without coverage data
        }

        // Get global parameters
        const w = this.game.getWearParameter(); // Assumes game instance has this method
        const L = this.game.getTotalPathLength(); // Assumes game instance has this method
        const enemyDefinitions = this.game.enemyManager?.getEnemyDefinitions(); // Use optional chaining
        const alpha_zero_factor = this.game.getAlphaZeroFactor(); // Get alpha_0
        let costs;
        try {
             costs = await this.game.priceManager.calculateAllCosts(); // Get unrounded costs
        } catch (error) {
             console.error("DefenceManager: Failed to get defender costs from PriceManager:", error);
             return; // Cannot proceed without costs
        }

        // REMOVED: console.log(`DEBUG: calculateWearParameters - Global params: w=${w}, L=${L}, enemyDefs=${!!enemyDefinitions}`);

        if (w === undefined || L === null || !enemyDefinitions || alpha_zero_factor === null || alpha_zero_factor <= 0 || !costs) {
            console.error(`DefenceManager: Missing required parameters for wear calculation (w=${w}, L=${L}, enemies=${!!enemyDefinitions}, alpha=${alpha_zero_factor}, costs=${!!costs})`);
            return;
        }

        const enemyTypes = Object.values(enemyDefinitions).filter(e => e.stats && e.stats.hp > 0 && e.stats.speed > 0);
        const N_types = enemyTypes.length;
        // REMOVED: console.log(`DEBUG: calculateWearParameters - Found ${N_types} valid enemy types for calc.`);

        if (N_types === 0) {
            console.warn("DefenceManager: No valid enemy types found for wear calculation. Disabling wear for all.");
             // Set all wear parameters to defaults (wear disabled)
             for (const defenceId in this.defenceDefinitions) {
                 const def = this.defenceDefinitions[defenceId];
                 if (def.stats) {
                     def.stats.wearEnabled = false;
                     // REMOVED: def.stats.totalHitsK = 1; // Dummy value
                     def.stats.maxHp = 1; // Set dummy health
                     def.stats.wearDecrement = 0;
                 }
             }
            return; // Exit if no enemies
        }

        // --- Calculation Loop --- 
        for (const defenceId in this.defenceDefinitions) {
            const def = this.defenceDefinitions[defenceId];
            if (!def || !def.stats) continue;
            
            // Get cost for this defender
            const Ci = costs[defenceId];
            if (Ci === undefined || Ci === null || Ci < 0) {
                 console.warn(`DefenceManager: Missing or invalid cost for ${defenceId}. Skipping wear calculation.`);
                 def.stats.wearEnabled = false;
                 def.stats.maxHp = 1; // Dummy health
                 def.stats.wearDecrement = 0;
                 // REMOVED: delete def.stats.totalHitsK;
                 continue;
            }
            
            // REMOVED: --- Log specific defender start ---
            // if (defenceId === 'axolotl_gunner') console.log(`\n--- DEBUG: Calculating wear for ${defenceId} ---`);

            const D = def.stats.attackStrength;
            const rateMs = def.stats.attackRate;
            const range = def.stats.attackRange;
            
            // REMOVED: --- Log defender stats ---
            // if (defenceId === 'axolotl_gunner') console.log(` -> Stats: D=${D}, rateMs=${rateMs}, range=${range}`);

            // Skip non-damaging or non-firing defenders
            if (!D || D <= 0 || !rateMs || rateMs <= 0) {
                // REMOVED: if (defenceId === 'axolotl_gunner') console.log(` -> Skipping: Non-damaging/firing.`);
                def.stats.wearEnabled = false;
                // REMOVED: def.stats.totalHitsK = 1; // Dummy value
                def.stats.maxHp = Ci / alpha_zero_factor; // Still assign maxHp based on cost/alpha
                def.stats.wearDecrement = 0;
                continue;
            }

            const r = 1000.0 / rateMs; // Hits per second

            // Get P(in range)
            const lookupRange = Math.max(1, Math.min(Math.round(range), coverageLookup.length - 1));
            const P_in_range = coverageLookup[lookupRange] || 0;
            // REMOVED: if (defenceId === 'axolotl_gunner') console.log(` -> P_in_range (for lookupRange ${lookupRange}): ${P_in_range}`);

            if (P_in_range <= 0) {
                // Defender can never hit path, disable wear
                // REMOVED: if (defenceId === 'axolotl_gunner') console.log(` -> Skipping: P_in_range is 0.`);
                def.stats.wearEnabled = false;
                // REMOVED: def.stats.totalHitsK = 1;
                def.stats.maxHp = Ci / alpha_zero_factor;
                def.stats.wearDecrement = 0;
                continue;
            }

            // Calculate Duty Cycle conditional
            let sumMinFactors = 0;
            enemyTypes.forEach(enemy => {
                const h_j = enemy.stats.hp;
                const s_j = enemy.stats.speed;

                const T_k_j = Math.ceil(h_j / D) / r;
                const T_r_j = (s_j > 1e-6) ? (L * P_in_range / s_j) : Infinity; // Avoid div by zero

                const factor = (T_r_j > 1e-9) ? Math.min(1.0, T_k_j / T_r_j) : 1.0; // If Tr is near zero, assume factor is 1
                // REMOVED: if (defenceId === 'axolotl_gunner') { ... }
                sumMinFactors += factor;
            });
            const D_fire_bar = sumMinFactors / N_types;
            // REMOVED: if (defenceId === 'axolotl_gunner') console.log(` -> D_fire_bar (avg factor): ${D_fire_bar}`);

            // Calculate final f_bar (average duty cycle)
            const f_bar = P_in_range * D_fire_bar;
            // REMOVED: if (defenceId === 'axolotl_gunner') console.log(` -> f_bar (P_in_range * D_fire_bar): ${f_bar}`);

            // Calculate k, Ri, maxHp and wearDecrement and set flags
            const wearIsEnabled = (w > 0 && f_bar > 0);
            def.stats.wearEnabled = wearIsEnabled;
            
            const Ri = Ci / alpha_zero_factor;
            def.stats.maxHp = Math.max(1, Ri); // Ensure maxHp is at least 1
            
            if (wearIsEnabled) {
                const ki = (r * f_bar) / w; // Total hits k
                if (ki > 1e-9) { // Avoid division by near-zero k
                    def.stats.wearDecrement = Ri / ki; 
                    def.stats.wearDecrement = Math.max(0, def.stats.wearDecrement); // Ensure non-negative
                     // REMOVED: if (defenceId === 'axolotl_gunner') console.log(` -> Wear ENABLED. Calculated ki=${ki.toFixed(2)}, Ri=${Ri.toFixed(2)}, maxHp=${def.stats.maxHp.toFixed(2)}, wearDecrement=${def.stats.wearDecrement.toFixed(4)}`);
                } else {
                     // k is effectively zero, cannot calculate meaningful decrement
                     def.stats.wearDecrement = def.stats.maxHp; // Set decrement to instantly destroy
                     def.stats.wearEnabled = true; // Still enable wear, it just finishes instantly
                     // REMOVED: if (defenceId === 'axolotl_gunner') console.log(` -> Wear ENABLED (Instant). Calculated ki near zero. Ri=${Ri.toFixed(2)}, maxHp=${def.stats.maxHp.toFixed(2)}, wearDecrement=${def.stats.wearDecrement.toFixed(4)}`);
                }
            } else {
                // Wear disabled (w=0 or f_bar=0)
                def.stats.wearDecrement = 0;
                // REMOVED: if (defenceId === 'axolotl_gunner') console.log(` -> Wear DISABLED. Ri=${Ri.toFixed(2)}, maxHp=${def.stats.maxHp.toFixed(2)}, wearDecrement=0`);
            }
            // REMOVED: delete def.stats.totalHitsK; // Remove the old property
        }

        // REMOVED: console.log("DEBUG: Finished calculateWearParameters.");
    }
}
