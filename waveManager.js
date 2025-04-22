export default class WaveManager {
    /**
     * Manages the timing and algorithmic generation of enemy waves.
     * @param {string} waveDataPath - Path to the wave configuration JSON file (e.g., assets/waves/waves.json).
     * @param {EnemyManager} enemyManager - Instance of the EnemyManager to access current enemy data.
     * @param {function} createEnemyCallback - Function (e.g., enemyManager.createEnemy) to call for spawning.
     */
    constructor(waveDataPath, enemyManager, createEnemyCallback) {
        if (!waveDataPath) {
            throw new Error("WaveManager requires a waveDataPath.");
        }
        if (!enemyManager) {
            throw new Error("WaveManager requires an EnemyManager instance.");
        }
        if (typeof createEnemyCallback !== 'function') {
            throw new Error("WaveManager requires a valid createEnemyCallback function.");
        }

        this.waveDataPath = waveDataPath;
        this.enemyManager = enemyManager;
        this.createEnemy = createEnemyCallback;

        // Internal state
        this.waveConfig = null;          // Holds loaded wave parameters (initialDelayMs, etc.)
        this.isLoaded = false;           // Flag for successful initial load
        this.isStarted = false;          // Flag to prevent multiple starts
        this.isFinished = false;         // Flag indicating all waves completed (logic TBD)

        this.currentWaveNumber = 0;      // Tracks the wave number
        this.waveStartTime = 0;          // Timestamp when the current wave's spawning began (or calculation)
        this.timeUntilNextWave = 0;      // Countdown timer (in ms) between waves
        
        // Placeholder for the details of the currently active/spawning wave
        // This will be populated by the algorithmic calculation in startNextWave
        this.activeWaveState = {
            groups: [],
            spawnedCount: 0,
            spawnIntervalMs: 0, // Calculated interval for this wave
            lastSpawnTime: 0,
            nextSpawnTimestamp: 0 // Will be set below if spawning starts
        }; 
        this.waitingForClear = false; // Initialize the new flag
        this.lastAverageDeathDistance = null; // Store the average distance from the last wave

        console.log("WaveManager: Instance created.");
    }

    /**
     * Loads the core wave configuration data from the specified path.
     */
    async load() {
        try {
            // Use cache-busting for the initial load as well
            const cacheBustingUrl = `${this.waveDataPath}?t=${Date.now()}`;
            const response = await fetch(cacheBustingUrl);
            if (!response.ok) {
                throw new Error(`Failed to fetch wave config: ${response.statusText} (${response.status})`);
            }
            const configData = await response.json();
            
            // Initial validation of required parameters
            if (configData.initialDelayMs === undefined || 
                configData.delayBetweenWavesMs === undefined || 
                configData.startingDifficulty === undefined ||
                configData.difficultyIncreaseFactor === undefined) {
                 console.warn("WaveManager: Loaded wave config is missing one or more expected top-level parameters (initialDelayMs, delayBetweenWavesMs, startingDifficulty, difficultyIncreaseFactor). Check waves.json.");
                 // Decide if this should be a fatal error
                 // throw new Error("WaveManager: Invalid wave configuration loaded.");
            }

            this.waveConfig = configData;
            this.isLoaded = true;
            console.log(`WaveManager: Successfully loaded and applied wave config from ${this.waveDataPath}`);
            // console.log("WaveManager: Initial Config:", JSON.stringify(this.waveConfig, null, 2)); // Optional: Log initial config
            return true;
        } catch (error) {
            console.error(`WaveManager: Error loading wave config from ${this.waveDataPath}:`, error);
            this.isLoaded = false;
            this.isFinished = true; // Prevent operation if load fails
            throw error; // Re-throw
        }
    }

    /**
     * Applies updated wave configuration parameters.
     * Called by TuningManager when the wave config file changes.
     * @param {object} newConfigData - The new data object fetched from waveDataPath.
     */
    applyParameterUpdates(newConfigData) {
        if (!this.isLoaded) {
            console.warn("WaveManager: Received parameter updates but not loaded yet. Ignoring.");
            return;
        }
        if (!newConfigData) {
            console.warn("WaveManager: Received empty or invalid data for parameter update. Ignoring.");
            return;
        }
        // Simple overwrite for now. Add validation/merging if needed.
        this.waveConfig = newConfigData; 
        // console.log("WaveManager: Updated Config:", JSON.stringify(this.waveConfig, null, 2)); // Optional: Log updated config

        // Potentially adjust ongoing timers if parameters like delayBetweenWavesMs change mid-wait?
        // For simplicity, we'll let the current timer run out based on the old value.
    }

    /**
     * Starts the wave system, beginning with the initial delay.
     * REQUIRES load() to have been called successfully.
     */
    start() {
        if (this.isStarted) {
            console.warn("WaveManager: Already started.");
            return;
        }
        if (!this.isLoaded || !this.waveConfig) {
            console.error("WaveManager: Cannot start. Config not loaded or invalid.");
            this.isFinished = true; // Prevent updates
            return;
        }

        this.isStarted = true;
        const initialDelay = this.waveConfig.initialDelayMs || 0;
        console.log(`WaveManager: Starting system. First wave calculation in ${initialDelay / 1000} seconds.`);

        // Use timeout for the very first wave delay
        setTimeout(() => {
            if (this.isStarted && !this.isFinished) { // Check if stopped during delay
                 this.startNextWave();
            }
        }, initialDelay);
    }

    /**
     * Calculates and initiates the next wave, attempting to align group centers at the last average death distance.
     */
    startNextWave() {
        // --- Initial Checks ---
        if (!this.isLoaded || !this.waveConfig || !this.enemyManager?.isLoaded) {
            console.error("WaveManager: Cannot start next wave. Config or EnemyManager not ready.");
            this.isFinished = true; return;
        }
        // Check if previous wave's groups are still processing (using the new structure)
        if (this.activeWaveState.groups && this.activeWaveState.groups.some(g => g.spawnedCount < g.enemies.length)) {
             console.warn("WaveManager: Tried to start next wave while previous groups are still spawning.");
             return;
        }

        this.currentWaveNumber++;
        console.log(`WaveManager: Starting calculation for Wave ${this.currentWaveNumber}`);
        this.waveStartTime = performance.now(); // Record when wave calculation/setup starts
        this.timeUntilNextWave = 0; // Clear inter-wave timer

        // --- Target Point & Fallback ---
        const targetDistance = this.lastAverageDeathDistance;
        let useCoordinatedSpawn = targetDistance !== null && targetDistance > 0;
        if (!useCoordinatedSpawn) {
            console.warn(`WaveManager: lastAverageDeathDistance (${targetDistance}) is invalid. Reverting to simple speed-sorted spawn for Wave ${this.currentWaveNumber}.`);
        } else {
            console.log(`WaveManager: Targeting coordinated arrival at distance ${targetDistance.toFixed(0)}px for Wave ${this.currentWaveNumber}.`);
        }

        // --- Difficulty & Enemy Selection ---
        const targetDifficulty = this.waveConfig.startingDifficulty * Math.pow(this.waveConfig.difficultyIncreaseFactor, this.currentWaveNumber - 1);
        console.log(`WaveManager: Target difficulty: ${targetDifficulty.toFixed(0)}`);
        const enemyDefinitions = this.enemyManager.getEnemyDefinitions();
        const availableEnemyCosts = [];
        const enemyIdsToConsider = Object.keys(enemyDefinitions);
        for (const id of enemyIdsToConsider) {
            const def = enemyDefinitions[id];
            if (def && def.stats) {
                const cost = (def.stats.hp || 0) * (def.stats.speed || 0);
                if (cost > 0) { availableEnemyCosts.push({ id: id, cost: cost }); }
            }
        }
        if (availableEnemyCosts.length === 0) { // ... handle no available enemies error ...
            console.error(`WaveManager: No enemies available... cannot generate wave.`);
            this.activeWaveState = { groups: [] }; // Set empty state
            this.timeUntilNextWave = this.waveConfig.delayBetweenWavesMs; return;
        }

        // --- Initial Calculation & Filtering --- 
        let selectedEnemies = [];
        let currentDifficulty = 0;

        // Calculate potential counts for ALL types initially (for exclusion check)
        const initialPotentialCounts = this._calculatePotentialCounts(targetDifficulty, availableEnemyCosts);

        // Get the threshold from config
        let maxPrepopulationPerType = this.waveConfig.waveGeneration?.maxPrepopulationPerType;
        if (typeof maxPrepopulationPerType !== 'number' || maxPrepopulationPerType < 0) {
            if (maxPrepopulationPerType !== undefined) { 
                 console.warn(`WaveManager: Invalid value for waveGeneration.maxPrepopulationPerType (${maxPrepopulationPerType}). Disabling threshold.`);
            }
            maxPrepopulationPerType = Infinity; 
        } else {
             console.log(`WaveManager: Pre-population threshold per type: ${maxPrepopulationPerType}`);
        }
        
        // Identify types exceeding threshold using the initial calculation
        const enemyTypesToExclude = new Set();
        initialPotentialCounts.forEach((numPotential, id) => {
             if (numPotential > maxPrepopulationPerType) {
                 console.log(`WaveManager: Excluding type ${id} from wave (potential ${numPotential} > threshold ${maxPrepopulationPerType})`);
                 enemyTypesToExclude.add(id);
             }
        });
        
        // Create the list of eligible types for this wave
        const eligibleEnemyCosts = availableEnemyCosts.filter(enemyType => !enemyTypesToExclude.has(enemyType.id));
        
        if (eligibleEnemyCosts.length === 0) {
            console.warn(`WaveManager: All available enemy types were excluded by the threshold or none were available. Cannot generate wave.`);
            this.activeWaveState = { groups: [] };
            this.timeUntilNextWave = this.waveConfig.delayBetweenWavesMs; return;
        }
        // --- End Filtering ---

        // --- Calculate final counts for pre-population using ONLY eligible types ---
        const prepopulationCounts = this._calculatePotentialCounts(targetDifficulty, eligibleEnemyCosts);
        // console.log(`WaveManager: Calculated pre-population counts for ${eligibleEnemyCosts.length} eligible types.`);

        // --- Pre-populate using eligible types and their calculated counts ---
        eligibleEnemyCosts.forEach(enemyType => {
            // Get the calculated number for this specific type from the map
            const numToAdd = prepopulationCounts.get(enemyType.id) || 0; 

            // Add the enemy if count is positive and finite (handles 0-cost enemies)
            if (numToAdd > 0 && isFinite(numToAdd)) {
                 for (let i = 0; i < numToAdd; i++) {
                     selectedEnemies.push(enemyType); // Add the {id, cost} object
                     currentDifficulty += enemyType.cost;
                 }
            }
        });
        console.log(`WaveManager: Pre-populated with ${selectedEnemies.length} enemies (using eligible types), difficulty: ${currentDifficulty.toFixed(0)}`);
        // --- End Pre-population ---

        const maxAttempts = this.waveConfig.waveGeneration?.maxSelectionAttempts || 200;
        const tolerance = this.waveConfig.waveGeneration?.difficultyTolerance || 0.10;
        let attempts = 0;
        // --- Refinement Loop (Uses eligibleEnemyCosts for additions) ---
        while (attempts < maxAttempts) {
            attempts++;
            const diff = targetDifficulty - currentDifficulty;
            const relativeDiff = targetDifficulty > 0 ? Math.abs(diff) / targetDifficulty : 0;
            if (relativeDiff <= tolerance && currentDifficulty > 0) break;
            
            if (diff > 0 || selectedEnemies.length === 0) {
                // Add random enemy *from the eligible list*
                 if (eligibleEnemyCosts.length === 0) {
                      console.warn("WaveManager: Refinement Add - No eligible enemies left to add.");
                      break; // Cannot add if list is empty
                 }
                const randomIndex = Math.floor(Math.random() * eligibleEnemyCosts.length);
                const enemyToAdd = eligibleEnemyCosts[randomIndex];
                selectedEnemies.push(enemyToAdd);
                currentDifficulty += enemyToAdd.cost;
            } else {
                // Remove random enemy (from the currently selected list)
                 if (selectedEnemies.length === 0) {
                     console.warn("WaveManager: Refinement Remove - selectedEnemies is already empty.");
                     break; // Cannot remove if list is empty
                 }
                const randomIndex = Math.floor(Math.random() * selectedEnemies.length);
                currentDifficulty -= selectedEnemies[randomIndex].cost;
                selectedEnemies.splice(randomIndex, 1);
            }
        }
        if (attempts >= maxAttempts) { console.warn(`WaveManager: Reached max selection attempts...`); }
        // --- End Selection ---

        if (selectedEnemies.length === 0) {
             console.log(`WaveManager: Wave ${this.currentWaveNumber} finished (0 enemies selected). Starting delay for next wave.`);
             this.activeWaveState = { groups: [] }; // Ensure state is cleared
             this.timeUntilNextWave = this.waveConfig.delayBetweenWavesMs;
             return;
        }

        // --- Group by Speed ---
        const speedGroupsMap = new Map();
        selectedEnemies.forEach(enemy => {
            const speed = enemyDefinitions[enemy.id]?.stats?.speed;
            if (!speedGroupsMap.has(speed)) {
                speedGroupsMap.set(speed, []);
            }
            speedGroupsMap.get(speed).push(enemy.id);
        });
        let sortedGroupsData = Array.from(speedGroupsMap.entries())
            .map(([speed, enemies]) => ({ speed, enemies }))
            .sort((a, b) => a.speed - b.speed); // Slowest first

        // --- [DEBUG OVERRIDE] Force 1 enemy of each available type ---
        const DEBUG_FORCE_ONE_OF_EACH = false; // Set to false to disable override
        if (DEBUG_FORCE_ONE_OF_EACH) {
            console.warn("WaveManager: [DEBUG] OVERRIDE ACTIVE - Forcing 1 of each valid enemy type.");
            const availableTypes = Object.keys(enemyDefinitions);
            let overriddenGroupsData = [];
            availableTypes.forEach(id => {
                const speed = enemyDefinitions[id]?.stats?.speed;
                // Only include if speed is valid and positive
                if (speed && speed > 0) {
                    overriddenGroupsData.push({ speed: speed, enemies: [id] }); // Group with one enemy
                } else {
                    console.warn(`WaveManager: [DEBUG OVERRIDE] Skipping type ${id} due to invalid speed.`);
                }
            });
            // Re-sort the overridden groups by speed
            overriddenGroupsData.sort((a, b) => a.speed - b.speed);
            // Replace the original sorted data with the override
            sortedGroupsData = overriddenGroupsData;
            console.log("WaveManager: [DEBUG] Using Overridden groups:", JSON.stringify(sortedGroupsData.map(g=>({speed: g.speed, id: g.enemies[0]})))); // Log simplified view
        }
        // -----------------------------------------------------------

        // --- Calculate Group Metrics and Start Times ---
        const averageInterEnemyDelay = this.waveConfig.delayBetweenEnemiesMs || 500;
        const calculatedGroupInfo = []; // Will store { ...group, count, travelTime, offsetTime, totalTime }

        // 1. Calculate metrics for all groups first
        sortedGroupsData.forEach((group, index) => {
            const count = group.enemies.length;
            const speed = group.speed;
            let travelTime = Infinity;
            
            // Log the config value being used for this specific group's calculation
            // REMOVED: console.log(`  [DEBUG] Group ${index} Offset Calc Check: Using delayBetweenEnemiesMs = ${currentDelayConfig}`);
            const currentDelayConfig = this.waveConfig.delayBetweenEnemiesMs || 500;

            // Use (count - 1) for offset, reading directly from config (with fallback)
            const offsetTime = (count > 1) ? ((count - 1) * currentDelayConfig / 2) : 0;

            if (useCoordinatedSpawn) {
                if (speed <= 0) {
                    console.warn(`WaveManager: Group with speed <= 0. Disabling coordinated spawn.`);
                    useCoordinatedSpawn = false;
                    travelTime = Infinity;
                } else {
                    // Log inputs before calculation
                    // REMOVED: console.log(`  [DEBUG] Travel Time Calc: targetDistance = ${targetDistance?.toFixed(2)}, speed = ${speed}`);
                    // Calculate time in seconds, then convert to milliseconds
                    travelTime = (targetDistance / speed) * 1000;
                }
            } else {
                 travelTime = 0; // Set non-infinite for fallback logic if needed
            }
            // 4. Calculate Total Time (CoM Arrival Time if started at t=0)
            const totalTime = useCoordinatedSpawn ? (offsetTime + travelTime) : 0; // Use 0 if not coordinating

            calculatedGroupInfo.push({ ...group, count, travelTime, offsetTime, totalTime });
        });

        // --- Calculate Final Start Times (Based on Latest CoM Arrival) ---
        let maxTotalTime = 0; // Initialize to 0
        if (useCoordinatedSpawn) {
            // 2. Find the maximum total time across all groups
             calculatedGroupInfo.forEach(group => {
                 if (isFinite(group.totalTime)) {
                    maxTotalTime = Math.max(maxTotalTime, group.totalTime);
                 } else {
                    useCoordinatedSpawn = false;
                 }
             });

             if (!useCoordinatedSpawn) {
                 console.warn("WaveManager: Infinite total time found. Reverting to sequential spawn.");
                 maxTotalTime = 0;
             } else if (calculatedGroupInfo.length > 0){
                 // REMOVED: console.log(`WaveManager: [DEBUG] Latest CoM arrival time calculated: ${maxTotalTime.toFixed(0)}ms`);
             }
        } else {
            maxTotalTime = 0; // For sequential fallback
        }
        
        // REMOVED: Redundant log for averageInterEnemyDelay variable

        let sequentialStartTimeOffset = 0; // For non-coordinated fallback
        const finalGroupsState = calculatedGroupInfo.map((group, index) => {
            let finalStartTime = 0;
            
            // --- Debug Log Group Metrics ---
            // REMOVED: console.log(`  [DEBUG] Group ${index} (Speed: ${group.speed}, Count: ${group.count}) | OffsetT: ${group.offsetTime.toFixed(0)}, TravelT: ${isFinite(group.travelTime) ? group.travelTime.toFixed(0) : 'Inf'}, TotalT: ${isFinite(group.totalTime) ? group.totalTime.toFixed(0) : 'Inf'}`);
            // ----------------------------->

            if (useCoordinatedSpawn) {
                // 3. Calculate start time relative to the latest arrival
                finalStartTime = isFinite(group.totalTime) ? (maxTotalTime - group.totalTime) : 0;
                // Keep final start time log for now
                console.log(`    -> Coordinated Final Start (based on latest arrival): +${finalStartTime.toFixed(0)}ms`);
            } else {
                // Non-coordinated fallback: Stack groups sequentially
                if (index > 0) {
                     const prevGroup = calculatedGroupInfo[index-1];
                     const averageInterEnemyDelay = this.waveConfig.delayBetweenEnemiesMs || 500;
                     const prevDurationEstimate = (prevGroup.count > 1) ? ((prevGroup.count - 1) * averageInterEnemyDelay) : 0;
                     sequentialStartTimeOffset += prevDurationEstimate + averageInterEnemyDelay; // Add full delay
                     finalStartTime = sequentialStartTimeOffset;
                }
                // Keep final start time log for now
                 console.log(`    -> Sequential Fallback Final Start: +${finalStartTime.toFixed(0)}ms`);
            }

            finalStartTime = Math.max(0, finalStartTime);

            return {
                speed: group.speed,
                enemies: group.enemies,
                count: group.count,
                startTime: finalStartTime, // Use the start time relative to latest arrival
                spawnedCount: 0,
                nextSpawnTimestamp: Infinity,
                isActive: false
            };
        });
        // --- End Final Start Time Calculation ---

        // --- Finalize Wave State ---
        this.activeWaveState = { 
            groups: finalGroupsState,
            calculatedMetrics: calculatedGroupInfo // Store the detailed metrics
        };
        // Keep this summary log
        console.log(`WaveManager: Wave ${this.currentWaveNumber} configured with ${this.activeWaveState.groups.reduce((sum, g) => sum + g.count, 0)} enemies across ${this.activeWaveState.groups.length} speed groups.`);
    }

    /**
     * Calculates the potential number of each enemy type based on equal difficulty sharing
     * among the provided list of types.
     * @param {number} targetDifficulty - The total difficulty to distribute.
     * @param {Array<{id: string, cost: number}>} enemyTypeList - The list of enemy types to consider.
     * @returns {Map<string, number>} A map where keys are enemy IDs and values are the calculated potential number to add (floor(share/cost)). Returns an empty map if the list is empty or invalid.
     * @private
     */
    _calculatePotentialCounts(targetDifficulty, enemyTypeList) {
        const potentialCounts = new Map();
        if (!Array.isArray(enemyTypeList) || enemyTypeList.length === 0) {
            // console.warn("WaveManager: _calculatePotentialCounts called with empty or invalid enemy list.");
            return potentialCounts; // Return empty map
        }

        const numTypes = enemyTypeList.length;
        // Prevent division by zero if somehow numTypes is 0 despite check
        if (numTypes === 0) return potentialCounts; 

        const difficultyPerType = targetDifficulty / numTypes;

        enemyTypeList.forEach(enemyType => {
            if (enemyType.cost > 0) {
                const numToAdd = Math.floor(difficultyPerType / enemyType.cost);
                potentialCounts.set(enemyType.id, numToAdd);
            } else {
                potentialCounts.set(enemyType.id, Infinity); // Handle 0 cost - results in Infinity count
                 // console.warn(`WaveManager: Enemy type ${enemyType.id} has zero cost, potential count set to Infinity.`);
            }
        });

        return potentialCounts;
    }

    // Helper method - unchanged
    _calculateRandomSpawnDelay() {
        const baseDelay = this.waveConfig.delayBetweenEnemiesMs || 500;
        const variance = this.waveConfig.delayBetweenEnemiesVarianceMs || 0;
        const randomVariance = (Math.random() * 2 - 1) * variance;
        const nextDelay = Math.max(0, baseDelay + randomVariance);
        return nextDelay;
    }

    /**
     * Updates the state of wave spawning based on the elapsed time.
     * Should be called in the main game loop.
     * @param {number} timestamp - The current high-resolution timestamp (e.g., from performance.now()).
     * @param {number} deltaTime - The time elapsed (in milliseconds) since the last update.
     */
    update(timestamp, deltaTime) {
        if (this.isFinished || !this.isStarted || !this.isLoaded || !this.waveConfig) {
            return; // Do nothing if finished, not started, or config not loaded
        }

        let allGroupsFinishedSpawning = true; // Assume finished until proven otherwise

        // --- Process Spawning Groups ---
        if (this.activeWaveState.groups && this.activeWaveState.groups.length > 0) {
            this.activeWaveState.groups.forEach((group, groupIndex) => {
                // If group has finished spawning, skip
                if (group.spawnedCount >= group.count) {
                    return; // Go to next group
                }

                allGroupsFinishedSpawning = false; // Found a group still spawning

                // Check if group should become active (based on its calculated start time)
                const activationTime = this.waveStartTime + group.startTime;
                if (!group.isActive && timestamp >= activationTime) {
                    group.isActive = true;
                    // Set the *first* spawn time predictably (e.g., 10ms after activation)
                    const FIXED_FIRST_DELAY = 10; // ms - make configurable later?
                    group.nextSpawnTimestamp = timestamp + FIXED_FIRST_DELAY; 
                }

                // If the group is active and has enemies left and it's time to spawn
                if (group.isActive && group.spawnedCount < group.count && timestamp >= group.nextSpawnTimestamp) {
                    // Spawn the next enemy for this group
                    const enemyTypeId = group.enemies[group.spawnedCount];
                    this.createEnemy(enemyTypeId, 0);
                    const spawnLogTime = timestamp.toFixed(0);
                    group.spawnedCount++;

                    // If there are more enemies left *in this group*, calculate the next spawn time
                    if (group.spawnedCount < group.count) {
                        const nextDelay = this._calculateRandomSpawnDelay();
                        group.nextSpawnTimestamp = timestamp + nextDelay;
                        console.log(` -> Spawned ${enemyTypeId} (Group ${groupIndex}) at ${spawnLogTime}ms. Next in group: ${nextDelay.toFixed(0)}ms`);
                    } else {
                        // This was the last enemy for this group
                        group.nextSpawnTimestamp = Infinity;
                         console.log(` -> Spawned LAST ${enemyTypeId} (Group ${groupIndex}) at ${spawnLogTime}ms. Group complete.`);
                    }
                }
            }); // End of groups.forEach
        } else {
             allGroupsFinishedSpawning = true;
        }

        // --- Post-Spawning Logic (Waiting for Clear / Next Wave Timer) ---
        // Check if ALL groups have finished spawning AND we are not already waiting for clear
        if (allGroupsFinishedSpawning && !this.waitingForClear && this.isStarted) {
             const waveHadEnemies = this.activeWaveState.groups && this.activeWaveState.groups.some(g => g.count > 0);
             if (waveHadEnemies) {
                 console.log(`WaveManager: All group spawning complete for Wave ${this.currentWaveNumber}. Waiting for screen clear.`);
                 this.waitingForClear = true; 
             }
        }

        // Check if waiting for the screen to clear AFTER all spawning is complete
        if (this.waitingForClear) {
            if (this.enemyManager && typeof this.enemyManager.getActiveEnemies === 'function' && this.enemyManager.getActiveEnemies().length === 0) {
                console.log(`WaveManager: Screen cleared after Wave ${this.currentWaveNumber} at ${timestamp.toFixed(0)}ms.`);
                // Calculate average death distance for the wave that just cleared
                if (typeof this.enemyManager.calculateAverageDeathDistance === 'function') {
                    this.lastAverageDeathDistance = this.enemyManager.calculateAverageDeathDistance(); // Log is inside the function
                }
                this.waitingForClear = false; // Stop checking
                // NOW start the timer for the next wave
                this.timeUntilNextWave = this.waveConfig.delayBetweenWavesMs;
                console.log(`WaveManager: Next wave calculation starting in ${this.timeUntilNextWave / 1000} seconds.`);
                 this.activeWaveState = { groups: [] }; // Clear groups state for the completed wave
            }
        }
        // Else, check if the inter-wave timer is running (after screen clear)
        else if (this.timeUntilNextWave > 0) {
            this.timeUntilNextWave -= deltaTime;
            if (this.timeUntilNextWave <= 0) {
                this.timeUntilNextWave = 0;
                this.startNextWave(); // Time's up, start calculating the next wave
            }
        }
    }
     
     // Helper to expose the data path for TuningManager registration
     getDataPath() {
         return this.waveDataPath;
     }

    /**
     * Returns the average death distance calculated after the last completed wave.
     * @returns {number | null} The distance in pixels, or null if not calculated yet.
     */
    getLastAverageDeathDistance() {
        return this.lastAverageDeathDistance;
    }

    /**
     * Returns the calculated metrics (speed, count, travelTime, offsetTime, totalTime) 
     * for the groups in the currently active or most recently calculated wave.
     * @returns {Array | null} An array of group metric objects, or null.
     */
    getActiveWaveGroupMetrics() {
        return this.activeWaveState?.calculatedMetrics || null;
    }
}
