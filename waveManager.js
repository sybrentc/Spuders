export default class WaveManager extends EventTarget {
    /**
     * Manages the timing and algorithmic generation of enemy waves.
     * @param {string} waveDataPath - Path to the wave configuration JSON file (e.g., assets/waves/waves.json).
     * @param {EnemyManager} enemyManager - Instance of the EnemyManager to access current enemy data.
     * @param {function} createEnemyCallback - Function (e.g., enemyManager.createEnemy) to call for spawning.
     * @param {number} totalPathLength - The total length of the enemy path.
     * @param {Game} game - The main Game instance.
     */
    constructor(waveDataPath, enemyManager, createEnemyCallback, totalPathLength, game) {
        if (!waveDataPath) {
            throw new Error("WaveManager requires a waveDataPath.");
        }
        if (!enemyManager) {
            throw new Error("WaveManager requires an EnemyManager instance.");
        }
        if (typeof createEnemyCallback !== 'function') {
            throw new Error("WaveManager requires a valid createEnemyCallback function.");
        }
        if (typeof totalPathLength !== 'number' || totalPathLength <= 0) {
            throw new Error(`WaveManager requires a valid positive totalPathLength (received: ${totalPathLength}).`);
        }
        if (!game) {
            throw new Error("WaveManager requires a Game instance.");
        }

        super(); // Call EventTarget constructor

        this.waveDataPath = waveDataPath;
        this.enemyManager = enemyManager;
        this.createEnemy = createEnemyCallback;
        this.totalPathLength = totalPathLength; // Store the path length
        this.game = game; // Store game instance

        // Internal state
        this.waveConfig = null;          // Holds loaded wave parameters (initialDelayMs, etc.)
        this.isLoaded = false;           // Flag for successful initial load
        this.isStarted = false;          // Flag to prevent multiple starts
        this.isFinished = false;         // Flag indicating all waves completed (logic TBD)

        this.currentWaveNumber = 0;      // Tracks the wave number
        this.waveStartTime = 0;          // Timestamp when the current wave's spawning began (or calculation)
        this.timeUntilNextWave = 0;      // Countdown timer (in ms) between waves
        this.lastDisplayedSeconds = null; // Tracks the last integer second value displayed
        
        // REMOVED: Placeholder for the details of the currently active/spawning wave
        // REMOVED: this.activeWaveState = { ... }; 
        this.waitingForClear = false; // Initialize the new flag
        this.lastAverageDeathDistance = null; // Store the average distance from the last wave

        this.initialWaveTimeoutId = null; // Added: To store the ID of the initial setTimeout

        // --- ADDED: Properties for pre-calculated schedules ---
        this.currentWaveSchedule = [];      // Stores { timestampMs: number, enemyTypeId: string }
        this.currentWaveDurationSeconds = 0;
        this.nextWaveSchedule = [];         // Schedule for wave n+1
        this.nextWaveDurationSeconds = 0;   // Duration for wave n+1
        this.scheduleIndex = 0;             // Tracks progress through currentWaveSchedule
        this.previousWaveDurationSeconds = 0; // <-- ADDED: Store duration of the completed wave
        // --- ADDED: Store total bounty for waves ---
        this.currentWaveTotalBounty = 0;
        this.nextWaveTotalBounty = 0;
        this.previousWaveTotalBounty = 0;
        // --- END ADDED ---

        //console.log("WaveManager: Instance created.");
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
            //console.log(`WaveManager: Successfully loaded and applied wave config from ${this.waveDataPath}`);
            // //console.log("WaveManager: Initial Config:", JSON.stringify(this.waveConfig, null, 2)); // Optional: Log initial config
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
        // --- ADDED: Check if difficultyIncreaseFactor (f) changed ---
        const previousF = this.waveConfig?.difficultyIncreaseFactor;
        const newF = newConfigData.difficultyIncreaseFactor;
        let fChanged = false;
        if (typeof newF === 'number' && newF > 1 && newF !== previousF) {
             fChanged = true;
             console.log(`WaveManager: difficultyIncreaseFactor (f) changed from ${previousF} to ${newF}.`);
        }
        // --- END ADDED ---
        
        // Simple overwrite for now. Add validation/merging if needed.
        this.waveConfig = newConfigData; 
        // //console.log("WaveManager: Updated Config:", JSON.stringify(this.waveConfig, null, 2)); // Optional: Log updated config

        // --- ADDED: Trigger recalculation if f changed ---
        if (fChanged && this.game) {
            // Call the renamed recalculation method in game
            this.game.recalculateBreakEvenAlphaFactor(); 
        }
        // --- END ADDED ---

        // Potentially adjust ongoing timers if parameters like delayBetweenWavesMs change mid-wait?
        // For simplicity, we'll let the current timer run out based on the old value.
    }

    /**
     * Returns the configured difficulty increase factor (f).
     * @returns {number | undefined} The factor, or undefined if not loaded.
     */
    getDifficultyIncreaseFactor() {
        return this.waveConfig?.difficultyIncreaseFactor;
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
        //console.log(`WaveManager: Starting system. First wave calculation in ${initialDelay / 1000} seconds.`);

        // Use timeout for the very first wave delay
        // Store the timeout ID so it can be cleared on reset
        this.initialWaveTimeoutId = setTimeout(() => { 
            this.initialWaveTimeoutId = null; // Clear ID once timeout runs
            if (this.isStarted && !this.isFinished) { // Check if stopped during delay
                 // Pass the current timestamp to startNextWave
                 this.startNextWave(performance.now()); 
            }
        }, initialDelay);
    }

    /**
     * Calculates and initiates the next wave by generating schedules.
     * @param {number} timestamp - The current timestamp from performance.now().
     */
    startNextWave(timestamp) {
        if (this.isFinished || !this.isStarted || !this.isLoaded || !this.waveConfig) {
            return; // Do nothing if finished, not started, or config not loaded
        }

        this.waitingForClear = false; // Reset waiting flag

        // --- Calculate Schedules (Optimized) ---
        const isFirstWave = (this.currentWaveNumber === 0); // Check BEFORE increment

        this.currentWaveNumber++; // Increment wave number
        const waveN = this.currentWaveNumber; // Get the newly active wave number
        
        if (isFirstWave) { // Use the pre-increment check
             // --- Initial Case: Calculate Wave 1 and Wave 2 ---
             //console.log(`WaveManager: Calculating initial schedules (Wave 1 & 2)...`);
             // Explicitly calculate for wave 1 and 2
             const currentResult = this._calculateWaveScheduleAndDuration(1); 
             const nextResult = this._calculateWaveScheduleAndDuration(2);

             if (!currentResult || currentResult.schedule.length === 0) {
                 console.error(`WaveManager: Failed initial calculation for Wave 1. Stopping.`);
                 this.currentWaveSchedule = []; this.currentWaveDurationSeconds = 0; this.currentWaveTotalBounty = 0;
                 this.nextWaveSchedule = []; this.nextWaveDurationSeconds = 0; this.nextWaveTotalBounty = 0;
                 this.isFinished = true; // Stop further processing
                 // TODO: Consider how to handle UI/game state on critical failure
             return;
        }
             this.currentWaveSchedule = currentResult.schedule;
             this.currentWaveDurationSeconds = currentResult.durationSeconds;
             this.currentWaveTotalBounty = currentResult.totalBounty; // Store bounty
             //console.log(` -> Wave 1 Schedule: ${this.currentWaveSchedule.length} spawns, Duration: ${this.currentWaveDurationSeconds.toFixed(2)}s, Bounty: ${this.currentWaveTotalBounty.toFixed(2)}`);

             if (nextResult) {
                  this.nextWaveSchedule = nextResult.schedule;
                  this.nextWaveDurationSeconds = nextResult.durationSeconds;
                  this.nextWaveTotalBounty = nextResult.totalBounty; // Store bounty for next wave
                  //console.log(` -> Wave 2 Schedule: ${this.nextWaveSchedule.length} spawns, Duration: ${this.nextWaveDurationSeconds.toFixed(2)}s, Bounty: ${this.nextWaveTotalBounty.toFixed(2)}`);
                } else {
                  console.warn(`WaveManager: Failed to pre-calculate schedule for Wave 2.`);
                  this.nextWaveSchedule = [];
                  this.nextWaveDurationSeconds = 0;
                  this.nextWaveTotalBounty = 0; // Reset bounty for next wave
                }
            } else {
             // --- Subsequent Waves: Move next to current, calculate new next ---
             //console.log(`WaveManager: Transitioning to Wave ${waveN}...`);
             this.currentWaveSchedule = this.nextWaveSchedule;
             // --- Store previous duration and bounty before overwriting current ---
             this.previousWaveDurationSeconds = this.currentWaveDurationSeconds;
             this.previousWaveTotalBounty = this.currentWaveTotalBounty; // Store previous bounty
             // --- END ---
             this.currentWaveDurationSeconds = this.nextWaveDurationSeconds;
             this.currentWaveTotalBounty = this.nextWaveTotalBounty; // Move next bounty to current
             //console.log(` -> Using pre-calculated Wave ${waveN} Schedule: ${this.currentWaveSchedule.length} spawns, Duration: ${this.currentWaveDurationSeconds.toFixed(2)}s, Bounty: ${this.currentWaveTotalBounty.toFixed(2)}`);

             // Check if the schedule we just moved is valid
             if (this.currentWaveSchedule.length === 0 && waveN > 0) {
                 console.warn(`WaveManager: Wave ${waveN} started with an empty pre-calculated schedule. Starting inter-wave delay immediately.`);
                 // Clear next wave too, as it might be based on a bad state
                 this.nextWaveSchedule = [];
                 this.nextWaveDurationSeconds = 0;
                 this.nextWaveTotalBounty = 0; // Clear bounty for next wave
                 this.timeUntilNextWave = this.waveConfig.delayBetweenWavesMs;
                 this.lastDisplayedSeconds = Math.ceil(this.timeUntilNextWave / 1000);
                 this.dispatchEvent(new CustomEvent('statusUpdated'));
                 return; // Exit early
             }

             // Calculate the *new* next wave (N+1)
             const waveNplus1 = waveN + 1;
             //console.log(`WaveManager: Pre-calculating schedule for Wave ${waveNplus1}...`);
             const nextResult = this._calculateWaveScheduleAndDuration(waveNplus1);
             if (nextResult) {
                 this.nextWaveSchedule = nextResult.schedule;
                 this.nextWaveDurationSeconds = nextResult.durationSeconds;
                 this.nextWaveTotalBounty = nextResult.totalBounty; // Store bounty for new next wave
                 //console.log(` -> Wave ${waveNplus1} Schedule: ${this.nextWaveSchedule.length} spawns, Duration: ${this.nextWaveDurationSeconds.toFixed(2)}s, Bounty: ${this.nextWaveTotalBounty.toFixed(2)}`);
                 } else {
                 console.warn(`WaveManager: Failed to pre-calculate schedule for Wave ${waveNplus1}.`);
                 this.nextWaveSchedule = [];
                 this.nextWaveDurationSeconds = 0;
                 this.nextWaveTotalBounty = 0; // Reset bounty for new next wave
             }
        }
        // --- End Calculate Schedules ---

        // Common logic (set start time, reset index, dispatch update)
        this.waveStartTime = timestamp;
        this.scheduleIndex = 0;
        // --- ADDED: Notify StrikeManager about the new wave start --- 
        if (this.game.strikeManager && typeof this.game.strikeManager.startWave === 'function') {
            this.game.strikeManager.startWave(this.currentWaveNumber, timestamp);
        } else {
             // Log warning if StrikeManager or method is missing - this might be expected temporarily
             // console.warn(`WaveManager: StrikeManager.startWave not found when starting wave ${this.currentWaveNumber}.`);
        }
        // --- END ADDED ---
        this.dispatchEvent(new CustomEvent('statusUpdated')); // Wave number changed
        //console.log(`WaveManager: Wave ${this.currentWaveNumber} ready with ${this.currentWaveSchedule.length} scheduled spawns.`);

        // REMOVED: Critical check (now handled implicitly by moving schedules)
        // REMOVED: Calculation for current wave (now done above or moved from next)
        // REMOVED: Pre-calculation for next wave (now done above)
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

    // --- ADDED: Helper to calculate spawn schedule and duration ---
    /**
     * Generates the enemy list, spawn schedule, and total duration for a given wave number.
     * @param {number} waveNumber - The wave number to calculate for.
     * @returns {{ schedule: Array<{ timestampMs: number, enemyTypeId: string }>, durationSeconds: number } | null} 
     *          Returns the schedule and duration, or null on failure.
     * @private
     */
    _calculateWaveScheduleAndDuration(waveNumber) {
        try { // Wrap in try-catch for robustness
            // --- ADDED: Check if EnemyManager and its definitions are loaded ---
            if (!this.enemyManager || !this.enemyManager.isLoaded) {
                console.error(`WaveManager (_calcSchedule ${waveNumber}): EnemyManager not available or its definitions not loaded. Cannot calculate schedule.`);
                return null; // Or return { schedule: [], durationSeconds: 0 }; to be consistent with other failures
            }
            // --- END ADDED ---

            // --- Target Point & Fallback (same logic as before) ---
            let targetDistance = this.lastAverageDeathDistance;
            if (waveNumber === 1 && targetDistance === null) {
                if (this.totalPathLength > 0) {
                    targetDistance = this.totalPathLength / 2;
                } else {
                    console.warn(`WaveManager (_calcSchedule ${waveNumber}): totalPathLength invalid. Cannot set initial target.`);
                    targetDistance = null; // Ensure it's null if path length is bad
                }
            }
            const useCoordinatedSpawn = targetDistance !== null && targetDistance > 0;
            if (!useCoordinatedSpawn && waveNumber > 0) { // Only warn if not wave 0/-1 etc.
                // console.warn(`WaveManager (_calcSchedule ${waveNumber}): Invalid targetDistance (${targetDistance}). Coordinated spawn disabled for this wave.`);
            }

            // --- Difficulty & Enemy Selection (same logic) ---
            const targetDifficulty = this.waveConfig.startingDifficulty * Math.pow(this.waveConfig.difficultyIncreaseFactor, waveNumber - 1);
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
            if (availableEnemyCosts.length === 0) {
                console.warn(`WaveManager (_calcSchedule ${waveNumber}): No enemies available.`);
                return { schedule: [], durationSeconds: 0 }; // Return empty if no enemies
            }
            availableEnemyCosts.sort((a, b) => a.cost - b.cost);

            // --- Whitelisting (same logic) ---
            const waveGenConfig = this.waveConfig.waveGeneration || {};
            let maxPrepopulationPerType = waveGenConfig.maxPrepopulationPerType ?? Infinity;
            let minEnemyTypes = waveGenConfig.minEnemyTypes ?? 1;
            minEnemyTypes = Math.max(1, Math.min(minEnemyTypes, availableEnemyCosts.length));
            const initialPotentialCounts = this._calculatePotentialCounts(targetDifficulty, availableEnemyCosts);
            const enemyTypesToExclude = new Set();
            const totalTypes = availableEnemyCosts.length;
            const maxIndexToConsiderExclusion = totalTypes - minEnemyTypes;
            for (let i = 0; i < maxIndexToConsiderExclusion; i++) {
                const enemyType = availableEnemyCosts[i];
                const potentialCount = initialPotentialCounts.get(enemyType.id) || 0;
                if (isFinite(maxPrepopulationPerType) && potentialCount > maxPrepopulationPerType) {
                    enemyTypesToExclude.add(enemyType.id);
                }
            }
            let enemyWhitelist = availableEnemyCosts.filter(enemyType => !enemyTypesToExclude.has(enemyType.id));
            if (enemyWhitelist.length < minEnemyTypes && totalTypes >= minEnemyTypes) {
                enemyWhitelist = availableEnemyCosts.slice(-minEnemyTypes);
            }
            if (enemyWhitelist.length === 0) {
                 console.error(`WaveManager (_calcSchedule ${waveNumber}): Whitelist empty.`);
                 return { schedule: [], durationSeconds: 0 };
            }

            // --- Refinement (same logic, uses _calculatePotentialCounts internally) ---
            const finalRequiredCounts = this._calculatePotentialCounts(targetDifficulty, enemyWhitelist);
            let selectedEnemies = [];
            let currentDifficulty = 0;
            enemyWhitelist.forEach(enemyType => {
                const numToAdd = finalRequiredCounts.get(enemyType.id) || 0;
                if (numToAdd > 0 && isFinite(numToAdd)) {
                    for (let i = 0; i < numToAdd; i++) {
                        selectedEnemies.push(enemyType);
                        currentDifficulty += enemyType.cost;
                    }
                }
            });
            const maxAttempts = waveGenConfig.maxSelectionAttempts || 200;
            const tolerance = waveGenConfig.difficultyTolerance || 0.10;
            let attempts = 0;
            while (attempts < maxAttempts && enemyWhitelist.length > 0) {
                attempts++;
                const diff = targetDifficulty - currentDifficulty;
                const relativeDiff = targetDifficulty > 0 ? Math.abs(diff) / targetDifficulty : 0;
                if (relativeDiff <= tolerance && (currentDifficulty > 0 || targetDifficulty <= 0)) break;
                if (diff > 0 || selectedEnemies.length === 0) {
                    const randomIndex = Math.floor(Math.random() * enemyWhitelist.length);
                    const enemyToAdd = enemyWhitelist[randomIndex];
                    selectedEnemies.push(enemyToAdd);
                    currentDifficulty += enemyToAdd.cost;
                } else {
                    if (selectedEnemies.length === 0) break; // Should not happen if diff < 0
                    const randomIndex = Math.floor(Math.random() * selectedEnemies.length);
                    currentDifficulty -= selectedEnemies[randomIndex].cost;
                    selectedEnemies.splice(randomIndex, 1);
                }
            }
            if (attempts >= maxAttempts) console.warn(`WaveManager (_calcSchedule ${waveNumber}): Max refinement attempts reached. Actual difficulty: ${currentDifficulty.toFixed(2)} vs Target: ${targetDifficulty.toFixed(2)}`);
            if (selectedEnemies.length === 0 && targetDifficulty > 0) {
                 console.warn(`WaveManager (_calcSchedule ${waveNumber}): 0 enemies selected despite target diff > 0. Actual difficulty: ${currentDifficulty.toFixed(2)}`);
                 // currentDifficulty will be 0, so bounty will be 0. This is acceptable.
            }

            // --- Calculate Actual Total Bounty for this specific schedule ---
            let beta = 0;
            if (this.game && typeof this.game.getBetaFactor === 'function') {
                const rawBeta = this.game.getBetaFactor();
                if (typeof rawBeta === 'number' && isFinite(rawBeta) && rawBeta >= 0) {
                    beta = rawBeta;
                } else {
                    console.warn(`WaveManager (_calcSchedule ${waveNumber}): Invalid beta value (${rawBeta}) from game.getBetaFactor(). Using beta = 0.`);
                }
            } else {
                console.warn(`WaveManager (_calcSchedule ${waveNumber}): game.getBetaFactor() not available. Using beta = 0.`);
            }
            const actualTotalBountyForSchedule = currentDifficulty * beta;
            if (!isFinite(actualTotalBountyForSchedule) || actualTotalBountyForSchedule < 0) {
                console.warn(`WaveManager (_calcSchedule ${waveNumber}): Calculated actualTotalBountyForSchedule is invalid (${actualTotalBountyForSchedule}). currentDifficulty=${currentDifficulty}, beta=${beta}. Setting to 0.`);
                // actualTotalBountyForSchedule = 0; // Not strictly needed as it will be caught by isFinite check before returning if it was NaN from 0*Infinity etc.
            }
            // --- End Calculate Actual Total Bounty ---

            // --- Group by Speed ---
            const speedGroupsMap = new Map();
            selectedEnemies.forEach(enemy => {
                const speed = enemyDefinitions[enemy.id]?.stats?.speed;
                if (!speedGroupsMap.has(speed)) speedGroupsMap.set(speed, []);
                speedGroupsMap.get(speed).push(enemy.id);
            });
            let groupsData = Array.from(speedGroupsMap.entries())
                .map(([speed, enemies]) => ({ speed, enemies, count: enemies.length }))
                .sort((a, b) => a.speed - b.speed); // Slowest first

            // --- Calculate Coordinated Timings ---
            const deltaT_ms = this.waveConfig.delayBetweenEnemiesMs || 500;
            let maxTotalTime_ms = 0;
            let effectiveUseCoordinated = useCoordinatedSpawn; // Track if it gets disabled

            const groupMetrics = groupsData.map(group => {
                let travelTime_ms = Infinity;
                let offsetTime_ms = (group.count > 1) ? ((group.count - 1) * deltaT_ms / 2) : 0;
                let totalTime_ms = Infinity;

                if (effectiveUseCoordinated) {
                    if (group.speed > 1e-6 && targetDistance > 0) {
                        travelTime_ms = (targetDistance / group.speed) * 1000;
                        totalTime_ms = offsetTime_ms + travelTime_ms;
                        maxTotalTime_ms = Math.max(maxTotalTime_ms, totalTime_ms);
                    } else {
                        console.warn(`WaveManager (_calcSchedule ${waveNumber}): Invalid speed (${group.speed}) or targetDistance (${targetDistance}) for group. Disabling coordination.`);
                        effectiveUseCoordinated = false; // Disable for this wave
                        travelTime_ms = 0;
                        totalTime_ms = 0;
                    }
                } else {
                     travelTime_ms = 0;
                     totalTime_ms = 0;
                }
                return { ...group, travelTime_ms, offsetTime_ms, totalTime_ms };
            });

            if (!effectiveUseCoordinated) maxTotalTime_ms = 0; // Reset if coordination disabled

            // --- Generate Schedule Entries and Calculate Duration ---
            const schedule = [];
            let maxFinishTimeMs = 0;
            const L = this.totalPathLength;

            groupMetrics.forEach(group => {
                const groupFinalStartTimeMs = effectiveUseCoordinated ? Math.max(0, maxTotalTime_ms - group.totalTime_ms) : 0;
                let groupFinishTimeMs = 0;

                for (let i = 0; i < group.count; i++) {
                    const spawnTimeMs = groupFinalStartTimeMs + (i * deltaT_ms);
                    schedule.push({ timestampMs: spawnTimeMs, enemyTypeId: group.enemies[i] });
                }

                // Calculate finish time for the last enemy of this group
                if (group.speed > 1e-6) {
                    const spawnDurationMs = (group.count > 1) ? (group.count - 1) * deltaT_ms : 0;
                    const travelTimeL_ms = (L / group.speed) * 1000;
                    groupFinishTimeMs = groupFinalStartTimeMs + spawnDurationMs + travelTimeL_ms;
                    maxFinishTimeMs = Math.max(maxFinishTimeMs, groupFinishTimeMs);
                } else {
                     // If speed is zero, they never finish the path? Set finish time?
                     // For duration calculation, maybe ignore zero-speed enemies?
                     // Let's assume maxFinishTimeMs is only updated by enemies that can move.
                }
            });

            // --- Finalize ---
            schedule.sort((a, b) => a.timestampMs - b.timestampMs); // Sort by spawn time
            const durationSeconds = maxFinishTimeMs / 1000.0;

            return { 
                schedule, 
                durationSeconds, 
                totalBounty: (isFinite(actualTotalBountyForSchedule) && actualTotalBountyForSchedule >=0) ? actualTotalBountyForSchedule : 0
            };

        } catch (error) {
            console.error(`WaveManager: Error during _calculateWaveScheduleAndDuration for wave ${waveNumber}:`, error);
            return null; // Return null on error
        }
    }
    // --- END ADDED HELPER ---

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

        // --- State Machine Logic ---

        // State 1: Waiting for screen to clear
        if (this.waitingForClear) {
            if (this.enemyManager && typeof this.enemyManager.getActiveEnemies === 'function' && this.enemyManager.getActiveEnemies().length === 0) {
                // --- Screen is clear! ---
                const clearTime = timestamp;
                //console.log(`WaveManager: Screen cleared after Wave ${this.currentWaveNumber} at ${timestamp.toFixed(0)}ms.`);
                // Calculate average death distance for the wave that just cleared
                if (typeof this.enemyManager.calculateAverageDeathDistance === 'function') {
                    this.lastAverageDeathDistance = this.enemyManager.calculateAverageDeathDistance(); // Log is inside the function
                }

                // --- ADDED: Trigger StrikeManager final calculation --- 
                if (this.game.strikeManager && typeof this.game.strikeManager.finalizeWaveDamage === 'function') {
                    this.game.strikeManager.finalizeWaveDamage(this.currentWaveNumber, this.waveStartTime, clearTime);
                } else {
                     // Log warning if StrikeManager or method is missing - might be expected temporarily
                     // console.warn(`WaveManager: StrikeManager.finalizeWaveDamage not found when clearing wave ${this.currentWaveNumber}.`);
                }
                // --- END ADDED ---
                
                this.waitingForClear = false; // *** Transition OUT of Waiting State ***
                
                // Start the timer for the next wave
                this.timeUntilNextWave = this.waveConfig.delayBetweenWavesMs;
                //console.log(`WaveManager: Next wave calculation starting in ${this.timeUntilNextWave / 1000} seconds.`);
                 this.lastDisplayedSeconds = Math.ceil(this.timeUntilNextWave / 1000);
                 this.dispatchEvent(new CustomEvent('statusUpdated')); // Status changed to delay timer
            }
            // If still waiting, do nothing else this frame
            
        // State 2: Counting down inter-wave delay
        } else if (this.timeUntilNextWave > 0) { 
            // Only decrement if deltaTime is valid and positive
            if (deltaTime > 0) {
                this.timeUntilNextWave -= deltaTime;
            }

            // Check if the timer has expired *after* decrementing
            if (this.timeUntilNextWave <= 0) {
                this.timeUntilNextWave = 0; // Ensure it's exactly 0
                this.lastDisplayedSeconds = null;
                this.dispatchEvent(new CustomEvent('statusUpdated')); // Dispatch UI update for "0s" or wave start
                this.startNextWave(timestamp); // *** Transition: Start next wave calculation ***
            } else {
                // Timer is still running, check if displayed second changed
                const currentSeconds = Math.ceil(this.timeUntilNextWave / 1000);
                if (currentSeconds !== this.lastDisplayedSeconds) {
                this.lastDisplayedSeconds = currentSeconds;
                    this.dispatchEvent(new CustomEvent('statusUpdated')); // Dispatch UI update for countdown change
                }
            }
            // Do nothing else this frame after handling timer

        // State 3: Processing spawn schedule for the current wave
        } else if (this.scheduleIndex < this.currentWaveSchedule.length) {
            const elapsedWaveTimeMs = timestamp - this.waveStartTime;
            let spawnsProcessedThisFrame = 0;

            // Process all scheduled spawns up to the current elapsed time
            while (this.scheduleIndex < this.currentWaveSchedule.length &&
                   this.currentWaveSchedule[this.scheduleIndex].timestampMs <= elapsedWaveTimeMs)
            {
                const spawnInfo = this.currentWaveSchedule[this.scheduleIndex];
                this.createEnemy(spawnInfo.enemyTypeId, 0); // Spawn at start (distance 0)
                spawnsProcessedThisFrame++;
                this.scheduleIndex++;
            }

            // Check if the schedule finished *in this frame*
            if (this.scheduleIndex >= this.currentWaveSchedule.length) {
                const waveHadSpawns = this.currentWaveSchedule && this.currentWaveSchedule.length > 0;
                if (waveHadSpawns) { 
                    //console.log(`WaveManager: All scheduled spawns complete for Wave ${this.currentWaveNumber}. Waiting for screen clear.`);
                    this.waitingForClear = true; // *** Transition INTO Waiting State ***
                } else if (this.currentWaveNumber > 0) {
                    // Handle case where calculated schedule was empty (e.g., calculation failed, 0 enemies)
                    // Directly start the inter-wave timer without waiting for clear
                    console.log(`WaveManager: Wave ${this.currentWaveNumber} had no scheduled spawns. Starting inter-wave delay.`);
                    this.waitingForClear = false; // Ensure not waiting
                    this.timeUntilNextWave = this.waveConfig.delayBetweenWavesMs;
                    this.lastDisplayedSeconds = Math.ceil(this.timeUntilNextWave / 1000);
                this.dispatchEvent(new CustomEvent('statusUpdated'));
                }
            }
            // Do nothing else this frame after processing spawns
        
        // Default/Idle State: Not waiting, timer not running, schedule finished or empty
        // This might happen briefly between states or if the game ends.
        // No action usually needed here unless specific edge cases arise.
        // console.log("WaveManager: In idle state.");
        }

        // --- REMOVED Post-Spawning Logic / Set Waiting Flag check ---
        // This logic is now integrated into the state machine above

        // REMOVED: Check if waiting for the screen to clear AFTER all spawning is complete
        // if (this.waitingForClear) { ... }
        
        // REMOVED: Else, check if the inter-wave timer is running (after screen clear)
        // else if (this.timeUntilNextWave > 0) { ... }
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
        // Return a copy of the metrics for the current wave
        // This assumes this.activeWaveState.groupMetrics is up-to-date
        // If activeWaveState is removed or refactored, this needs adjustment.
        // For now, returning a placeholder as activeWaveState was removed.
        // This method needs to be re-evaluated based on how wave progress/details are now tracked.
        // console.warn("WaveManager.getActiveWaveGroupMetrics: Placeholder implementation. Needs review.");
        return {
            totalEnemies: 0,
            enemiesSpawned: 0,
            spawnProgress: 0,
            // ... other metrics if they were part of activeWaveState.groupMetrics
        };
    }

    // --- ADDED: Method to get pre-calculated durations ---
    /**
     * Gets the pre-calculated duration for a specific wave number.
     * Only guaranteed to have data for the current and the next wave.
     * @param {number} waveNumber - The wave number to query.
     * @returns {number | null} Duration in seconds, or null if not available/calculated.
     */
    getWaveDurationSeconds(waveNumber) {
        // --- ADDED: Return value for current wave ---
        if (waveNumber === this.currentWaveNumber) {
            return this.currentWaveDurationSeconds;
        }
        // --- ADDED: Return value for NEXT wave (n+1) ---
        if (waveNumber === this.currentWaveNumber + 1) {
            return this.nextWaveDurationSeconds;
        }
        // --- ADDED: Return value for PREVIOUS wave (n-1) ---
        if (waveNumber === this.currentWaveNumber - 1 && this.currentWaveNumber > 1) { // Ensure n-1 is valid
            return this.previousWaveDurationSeconds;
        }

        console.warn(`WaveManager.getWaveDurationSeconds: Duration for wave ${waveNumber} (current: ${this.currentWaveNumber}) is not cached. Attempting calculation if possible, or returning 0.`);

        // If the wave is the current wave or the next pre-calculated wave, it should have been caught above.
        // If it's a past wave (not n-1) or a future wave beyond n+1, we might need to calculate it.
        // Calculating on-the-fly can be expensive. For now, if it's a valid wave number from config, try to calculate.
        if (this.waveConfig && this.waveConfig.waves && waveNumber > 0 && waveNumber <= this.waveConfig.waves.length) {
            // console.log(`WaveManager.getWaveDurationSeconds: Attempting to calculate duration for wave ${waveNumber} on the fly.`);
            const result = this._calculateWaveScheduleAndDuration(waveNumber);
            if (result && typeof result.durationSeconds === 'number') {
                // console.log(`WaveManager.getWaveDurationSeconds: Calculated duration ${result.durationSeconds} for wave ${waveNumber}.`);
                // Note: This on-the-fly calculation is not cached back into current/next/previousWaveDurationSeconds.
                return result.durationSeconds;
            }
            console.warn(`WaveManager.getWaveDurationSeconds: Failed to calculate duration for wave ${waveNumber} on the fly.`);
        }
        
        return 0; // Fallback if not cached and not calculable or out of defined wave range
    }
    // --- END ADDED ---

    /**
     * Returns the total bounty for a given wave number.
     * For StrikeManager, only the current wave's bounty is typically needed.
     * @param {number} waveNumber - The wave number to get the total bounty for.
     * @returns {number} The total bounty for the specified wave, or 0 if not the current wave or not loaded.
     */
    getWaveTotalBounty(waveNumber) {
        if (!this.isLoaded) {
            // console.warn("WaveManager.getWaveTotalBounty: WaveManager not loaded. Returning 0 bounty.");
            return 0;
        }

        if (typeof waveNumber !== 'number' || waveNumber <= 0) {
            console.warn(`WaveManager.getWaveTotalBounty: Invalid waveNumber (${waveNumber}) provided. Must be a positive number. Returning 0 bounty.`);
            return 0;
        }

        if (waveNumber === this.currentWaveNumber) {
            // console.log(`WaveManager.getWaveTotalBounty: Returning cached currentWaveTotalBounty: ${this.currentWaveTotalBounty} for wave ${waveNumber}`);
            return this.currentWaveTotalBounty;
        } else {
            // console.warn(`WaveManager.getWaveTotalBounty: Requested bounty for wave ${waveNumber}, but only current wave's (${this.currentWaveNumber}) bounty is directly returned by this simplified path. Returning 0.`);
            return 0;
        }
    }

    /**
     * Resets the WaveManager to its initial state.
     */
    reset() {
        //console.log("WaveManager: Resetting...");
        // Clear any pending initial wave timeout
        if (this.initialWaveTimeoutId) {
            clearTimeout(this.initialWaveTimeoutId);
            this.initialWaveTimeoutId = null;
            console.log("WaveManager: Cleared pending initial wave timeout.");
        }

        // Reset internal state variables
        this.isStarted = false;
        this.isFinished = false;
        this.currentWaveNumber = 0;
        this.waveStartTime = 0;
        this.timeUntilNextWave = 0;
        this.lastDisplayedSeconds = null;
        // REMOVED: this.activeWaveState = { groups: [] }; 
        // --- ADDED: Reset schedule properties ---
        this.currentWaveSchedule = [];
        this.currentWaveDurationSeconds = 0;
        this.currentWaveTotalBounty = 0; // Reset bounty
        this.nextWaveSchedule = [];
        this.nextWaveDurationSeconds = 0;
        this.nextWaveTotalBounty = 0; // Reset bounty
        this.scheduleIndex = 0;
        this.previousWaveDurationSeconds = 0;
        this.previousWaveTotalBounty = 0; // Reset bounty
        // --- END ADDED ---
        this.waitingForClear = false;
        this.lastAverageDeathDistance = null;
    }
}
