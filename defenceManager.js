import DefenceEntity from './models/defender.js'; // Import the entity class
import * as PIXI from 'pixi.js';
import { Texture, Rectangle } from 'pixi.js';
import { processSpritesheet } from './utils/dataLoaders.js'; // Corrected path

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
                for (const def of data) { // Changed to for...of for async operations
                    if (def.id) {
                        this.defenceDefinitions[def.id] = { ...def }; // Store a copy
                        const currentDef = this.defenceDefinitions[def.id];

                        // Load and process spritesheet if sprite info exists
                        if (currentDef.sprite && currentDef.sprite.path && 
                            typeof currentDef.sprite.frameWidth === 'number' &&
                            typeof currentDef.sprite.frameHeight === 'number' &&
                            typeof currentDef.sprite.totalFrames === 'number' &&
                            typeof currentDef.sprite.framesPerRow === 'number') {
                            try {
                                currentDef.pixiTextures = await processSpritesheet(
                                    currentDef.sprite.path,
                                    currentDef.sprite // Pass the whole sprite object as frameConfig
                                );
                                // console.log(`DefenceManager: Loaded ${currentDef.pixiTextures.length} textures for ${currentDef.id}`);
                            } catch (error) {
                                console.error(`DefenceManager: Failed to process spritesheet for ${currentDef.id} at ${currentDef.sprite.path}:`, error);
                                currentDef.pixiTextures = []; // Ensure it's an empty array on failure
                            }
                        } else {
                            currentDef.pixiTextures = []; // No sprite info, or incomplete
                            // console.warn(`DefenceManager: No valid sprite data to process for ${currentDef.id}`);
                        }
                    }
                }
            } else {
                // Handle cases where data might be an object, if applicable
                // This part would also need async handling if it processes sprites.
                // For now, assuming this path doesn't load individual sprites or needs to be updated similarly if it does.
                this.defenceDefinitions = data; 
                if (typeof data === 'object' && data !== null) {
                    for (const defId in data) {
                        const def = data[defId];
                        if (def.id && def.sprite && def.sprite.path && 
                            typeof def.sprite.frameWidth === 'number' &&
                            typeof def.sprite.frameHeight === 'number' &&
                            typeof def.sprite.totalFrames === 'number' &&
                            typeof def.sprite.framesPerRow === 'number') {
                            try {
                                def.pixiTextures = await processSpritesheet(def.sprite.path, def.sprite);
                            } catch (error) {
                                 console.error(`DefenceManager: Failed to process spritesheet for ${def.id} (object data):`, error);
                                 def.pixiTextures = [];
                            }
                        } else {
                            def.pixiTextures = [];
                        }
                    }
                }
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

    // --- ADDED: Setup method to be called after all managers are ready ---
    /**
     * Sets up listeners and performs initial calculations after dependent managers are loaded.
     * Typically called from Game after PriceManager is ready.
     */
    setupAfterLoad() {
         if (!this.game.priceManager) {
             console.error("DefenceManager.setupAfterLoad: PriceManager not available on game instance.");
             return;
         }

        // Listen for cost updates from PriceManager
        this.game.priceManager.addEventListener('costsUpdated', () => {
            // console.log("DefenceManager: Received costsUpdated event, updating earning rates."); // Optional log
            this.updateDefenderEarningRates();
        });

        // Perform initial calculation
        // console.log("DefenceManager: Performing initial earning rate calculation."); // Optional log
        this.updateDefenderEarningRates();
    }
    // --- END ADDED ---

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
        const newDefence = new DefenceEntity(defenceId, definition, position, definition.pixiTextures, this.game); // NEW: Pass pixiTextures

        // --- ADDED: Calculate and store grid coordinates for StrikeManager ---
        if (this.game.strikeManager?.isConfigLoaded()) {
            const gridPos = this.game.strikeManager._world2grid(newDefence.x, newDefence.y);
            newDefence.gridCol = gridPos.col;
            newDefence.gridRow = gridPos.row;
            //console.log(`DEBUG: Assigned grid pos (${gridPos.col}, ${gridPos.row}) to ${defenceId}`); // Optional debug log
        } else {
            console.warn(`DefenceManager: StrikeManager not ready when placing ${defenceId}. Grid position not set.`);
        }
        // --- END ADDED ---

        this.activeDefences.push(newDefence);
        
        // Add PixiJS container to stage if it exists
        if (newDefence.pixiContainer) {
            if (this.game && this.game.app && this.game.app.stage) {
                this.game.groundLayer.addChild(newDefence.pixiContainer); // MODIFIED: Add to groundLayer
                // console.log(`DefenceManager: Added pixiContainer for ${newDefence.id} to stage.`);
            } else {
                console.error(`DefenceManager: Cannot add pixiContainer for ${newDefence.id} to stage. Game, app, or stage is missing.`);
            }
        }

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
        
        // --- Filter out destroyed defenders and perform PixiJS cleanup ---
        const initialCount = this.activeDefences.length;
        let removedCount = 0;
        this.activeDefences = this.activeDefences.filter(defence => {
            if (defence.isDestroyed) {
                // PixiJS Cleanup for destroyed defender
                if (defence.pixiContainer) {
                    if (this.game && this.game.app && this.game.app.stage) {
                        this.game.app.stage.removeChild(defence.pixiContainer);
                    } else {
                        console.warn(`DefenceManager: Could not remove pixiContainer for ${defence.id}, game/app/stage missing.`);
                    }
                }
                if (typeof defence.destroyPixiObjects === 'function') {
                    defence.destroyPixiObjects(); // Call defender's own Pixi cleanup
                }
                removedCount++;
                return false; // Remove from activeDefences
            }
            return true; // Keep in activeDefences
        });

        if (removedCount > 0) {
            // console.log(`DefenceManager: Removed ${removedCount} worn-out defender(s).`);
        }
        // --- End Filter ---
    }

    // Method to access the raw definitions (e.g., for UI)
    getDefinitions() {
        return this.defenceDefinitions;
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
        let costs;
        try {
             costs = await this.game.priceManager.calculateAllCosts(); // Get unrounded costs
        } catch (error) {
             console.error("DefenceManager: Failed to get defender costs from PriceManager:", error);
             return; // Cannot proceed without costs
        }

        // REMOVED: console.log(`DEBUG: calculateWearParameters - Global params: w=${w}, L=${L}, enemyDefs=${!!enemyDefinitions}`);

        // Get effective alpha
        const effective_alpha = this.game.getAlpha();

        if (w === undefined || L === null || !enemyDefinitions || effective_alpha === null || effective_alpha <= 0 || !costs) {
            console.error(`DefenceManager: Missing required parameters for wear calculation (w=${w}, L=${L}, enemies=${!!enemyDefinitions}, alpha=${effective_alpha}, costs=${!!costs})`);
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
                def.stats.maxHp = Ci / effective_alpha; // Still assign maxHp based on cost/alpha
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
                def.stats.maxHp = Ci / effective_alpha;
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
            
            const Ri = Ci / effective_alpha;
            def.stats.maxHp = Math.max(1, Ri); // Ensure maxHp is at least 1
            
            let k_theoretical = Infinity;
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

    // --- ADDED: Method to get a single definition by ID ---
    getDefinition(id) {
        return this.defenceDefinitions ? this.defenceDefinitions[id] : undefined;
    }
    // --- END ADDED ---

    // --- ADDED: Calculate and Store Earning Rate per Type ---
    /**
     * Calculates the earning rate (Ri = Ci / alpha) for each defence type
     * and stores it in the definition's stats.
     */
    updateDefenderEarningRates() {
        const alpha = this.game.getAlpha();
        const costs = this.game.priceManager?.getStoredCosts(); // Use optional chaining

        if (alpha === null || alpha <= 0) {
            console.error("DefenceManager.updateDefenderEarningRates: Cannot calculate rates, invalid alpha:", alpha);
            // Optionally clear existing rates?
            // for (const defenceId in this.defenceDefinitions) { ... delete stats.earningRate ... }
            return;
        }
        if (!costs) {
            console.error("DefenceManager.updateDefenderEarningRates: Cannot calculate rates, costs not available from PriceManager.");
            return;
        }

        // console.log(`DEBUG: Updating earning rates with alpha = ${alpha}`); // Optional log

        for (const defenceId in this.defenceDefinitions) {
            const def = this.defenceDefinitions[defenceId];
            const cost = costs[defenceId];

            if (def && def.stats) { // Ensure stats object exists
                if (cost !== undefined && cost !== null && cost !== Infinity && cost >= 0) {
                    const earningRate = cost / alpha;
                    def.stats.earningRate = isFinite(earningRate) ? earningRate : 0; // Store, handle potential Infinity if cost>0, alpha=0
                    // console.log(`  -> ${defenceId}: Cost=${cost.toFixed(2)}, Rate=${def.stats.earningRate.toFixed(4)}`); // Optional log
                } else {
                    // If cost is invalid, set rate to 0 or undefined
                    def.stats.earningRate = 0;
                    // console.log(`  -> ${defenceId}: Invalid cost (${cost}), Rate set to 0`); // Optional log
                }
            } else if (def) {
                 // Handle case where stats object might be missing
                 def.stats = { earningRate: 0 }; // Create stats with rate 0
                 console.warn(`DefenceManager: Definition ${defenceId} was missing stats object. Initialized with earningRate 0.`);
            }
        }
        //console.log("DefenceManager: Defender earning rates updated.");
    }
    // --- END ADDED ---

    // --- ADDED: Get Earning Rate for a specific type ---
    /**
     * Returns the stored earning rate for a specific defence type.
     * @param {string} defenceId - The ID of the defence type.
     * @returns {number} The calculated earning rate, or 0 if not found/invalid.
     */
    getEarningRateForType(defenceId) {
        return this.defenceDefinitions[defenceId]?.stats?.earningRate ?? 0;
    }
    // --- END ADDED ---

    // --- ADDED: Calculate total earning rate of active defenders ---
    /**
     * Calculates the sum of earning rates for all currently active defenders.
     * @returns {number} The total earning rate.
     */
    getCurrentTotalEarningRate() {
        let totalR = 0;
        // No need for activeCounts map if we just sum directly
        for (const defence of this.activeDefences) {
             // Directly use the stored rate from the definition
             const rate = this.getEarningRateForType(defence.id); 
             if (rate > 0 && isFinite(rate)) { // Check validity
                totalR += rate;
             }
        }
        return totalR;
    }
    // --- END ADDED ---
}
