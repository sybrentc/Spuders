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
            console.log(`DefenceManager: Loaded ${Object.keys(this.defenceDefinitions).length} defence definitions from ${dataPath}`);
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
        console.log(`DefenceManager: Attempting to create defence ${defenceId} at`, position);
        const definition = this.defenceDefinitions[defenceId];
        if (!definition) {
            console.error(`DefenceManager: Unknown defence ID: ${defenceId}`);
            return null;
        }
        // Actual instance creation would go here, likely returning a new object/class instance
        return { ...definition, x: position.x, y: position.y }; // Simple placeholder
    }

    placeDefence(defenceId, position) {
        const definition = this.defenceDefinitions[defenceId];
        if (!definition) {
            console.error(`DefenceManager: Unknown defence ID: ${defenceId}`);
            return null;
        }

        // Get dynamically calculated cost from PriceManager
        if (!this.game.priceManager) {
            console.error("DefenceManager: PriceManager not available on Game instance.");
            return null;
        }
        const calculatedCosts = this.game.priceManager.calculateAllCosts();
        const cost = calculatedCosts[defenceId];

        if (cost === undefined || cost === Infinity) {
             console.error(`DefenceManager: Invalid calculated cost (${cost}) for ${defenceId}. Cannot place.`);
             return null;
        }

        // Check cost vs player currency using calculated cost
        if (!this.base.canAfford(cost)) {
            console.log(`Cannot afford ${defenceId}. Cost: ${cost}, Funds: ${this.base.currentFunds}`);
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
        console.log(`DefenceManager: Placed ${defenceId} at (${position.x}, ${position.y}). Total defences: ${this.activeDefences.length}`);
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
        // Simple overwrite strategy for now. More complex merging could be done.
        const newDefinitions = {};
        if (Array.isArray(newData)) {
             newData.forEach(def => {
                 if (def.id) {
                     newDefinitions[def.id] = def;
                 }
             });
        } else {
             newDefinitions = newData;
        }

        // Check if definitions actually changed (simple JSON string comparison)
        if (JSON.stringify(this.defenceDefinitions) !== JSON.stringify(newDefinitions)) {
            this.defenceDefinitions = newDefinitions;
            console.log(`DefenceManager: Definitions updated.`);

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
        } else {
            // console.log(`DefenceManager: No changes detected in definitions.`);
        }
    }

    // Add getter for active defences
    getActiveDefences() {
        return this.activeDefences;
    }
}
