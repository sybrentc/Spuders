import DefenceEntity from './models/defender.js'; // Import the entity class

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
        // console.log("DEBUG: DefenceManager.applyParameterUpdates called."); // REMOVE LOG
        
        const newDefinitions = {};
        const processDefinition = (def) => {
            if (!def || !def.id) return;

            const currentDef = this.defenceDefinitions[def.id];
            const mergedDef = { ...def }; // Start with the new data

            // --- Merge Wear Params --- 
            if (currentDef && currentDef.stats) {
                // Ensure stats object exists on mergedDef
                if (!mergedDef.stats) mergedDef.stats = {}; 
                
                // Preserve calculated wear params if they exist on current and aren't explicitly in new data
                if (currentDef.stats.wearEnabled !== undefined && mergedDef.stats.wearEnabled === undefined) {
                    mergedDef.stats.wearEnabled = currentDef.stats.wearEnabled;
                }
                if (currentDef.stats.totalHitsK !== undefined && mergedDef.stats.totalHitsK === undefined) {
                    mergedDef.stats.totalHitsK = currentDef.stats.totalHitsK;
                }
            }
            // --- End Merge --- 

            newDefinitions[def.id] = mergedDef;
        };

        if (Array.isArray(newData)) {
             newData.forEach(processDefinition);
        } else if (typeof newData === 'object' && newData !== null) {
            // Handle case where newData is a single definition object or a dictionary
            if (newData.id) { // Single object
                processDefinition(newData);
            } else { // Dictionary of definitions
                Object.values(newData).forEach(processDefinition);
            }
        } else {
            console.error("DefenceManager.applyParameterUpdates: Invalid newData format.", newData);
            return; // Don't proceed with invalid data
        }

        // Check if definitions actually changed (simple JSON string comparison)
        if (JSON.stringify(this.defenceDefinitions) !== JSON.stringify(newDefinitions)) {
            this.defenceDefinitions = newDefinitions;
            //console.log(`DefenceManager: Definitions updated (merged).`); // Optional confirmation log

            // --- Propagate updates to active instances --- 
            this.activeDefences.forEach(defence => {
                const updatedDef = this.defenceDefinitions[defence.id];
                if (updatedDef && typeof defence.applyUpdate === 'function') {
                    defence.applyUpdate(updatedDef);
                }
            });
            // --- End Propagation ---

            // Dispatch an event to notify listeners (like the UI)
            this.dispatchEvent(new CustomEvent('definitionsUpdated'));

            // --- ADDED: Recalculate wear parameters if definitions changed ---
            console.log("DefenceManager: Definitions updated, recalculating own wear parameters (k).");
            // Use a microtask to avoid potential issues if called during initial load?
            // Or just call directly if calculateWearParameters is robust.
            // We call it directly for now. Check if await is needed if it becomes async.
            this.calculateWearParameters(); 
            // --- END ADDED ---
        } else {
            // //console.log(`DefenceManager: No changes detected in definitions.`);
        }
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
        // REMOVED: console.log(`DEBUG: calculateWearParameters - Global params: w=${w}, L=${L}, enemyDefs=${!!enemyDefinitions}`);

        if (w === undefined || L === null || !enemyDefinitions) {
            console.error(`DefenceManager: Missing required parameters for wear calculation (w=${w}, L=${L}, enemies=${!!enemyDefinitions})`);
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
                     def.stats.totalHitsK = 1; // Dummy value
                 }
             }
            return; // Exit if no enemies
        }

        // --- Calculation Loop --- 
        for (const defenceId in this.defenceDefinitions) {
            const def = this.defenceDefinitions[defenceId];
            if (!def || !def.stats) continue;
            
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
                def.stats.totalHitsK = 1; // Dummy value
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
                def.stats.totalHitsK = 1;
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

            // Calculate final f_bar
            const f_bar = P_in_range * D_fire_bar;
            // REMOVED: if (defenceId === 'axolotl_gunner') console.log(` -> f_bar (P_in_range * D_fire_bar): ${f_bar}`);

            // Calculate k and set flags
            if (w > 0 && f_bar > 0) {
                const k = Math.round(r * f_bar / w);
                def.stats.totalHitsK = Math.max(1, k); // Ensure k is at least 1
                def.stats.wearEnabled = true;
                // REMOVED: if (defenceId === 'axolotl_gunner') console.log(` -> Wear ENABLED. Calculated k=${k}, final totalHitsK=${def.stats.totalHitsK}`);
            } else {
                // Wear disabled (w=0) or defender effectively never fires (f_bar=0)
                def.stats.totalHitsK = 1; // Dummy value
                def.stats.wearEnabled = false;
                // REMOVED: if (defenceId === 'axolotl_gunner') console.log(` -> Wear DISABLED. Reason: w=${w}, f_bar=${f_bar}`);
            }
        }

        // REMOVED: console.log("DEBUG: Finished calculateWearParameters.");
    }
}
