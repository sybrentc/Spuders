export default class WaveManager {
    /**
     * Manages the timing and spawning of enemies based on wave data.
     * @param {string} waveDataPath - The path to the wave configuration JSON file.
     * @param {function} createEnemyCallback - A function (e.g., enemyManager.createEnemy) to call when an enemy should be spawned.
     */
    constructor(waveDataPath, createEnemyCallback) {
        if (!waveDataPath) {
            throw new Error("WaveManager requires a waveDataPath.");
        }
        this.waveDataPath = waveDataPath;
        this.createEnemy = createEnemyCallback; // Reference to the function that actually creates an enemy instance
        
        // Internal state, initialized after loading
        this.waveData = null;            // Will hold the loaded wave configuration
        this.isLoaded = false;           // Flag to indicate if definitions are loaded

        this.currentWaveNumber = 0;      // Tracks the wave we are currently processing or waiting for
        this.waveStartTime = 0;          // Timestamp when the current wave's spawning began
        this.spawners = [];              // Holds active spawn batch controllers for the current wave
        this.timeUntilNextWave = 0;      // Countdown timer (in ms) between waves
        this.isFinished = false;         // Flag indicating if all waves are completed
        this.isStarted = false;          // Flag to prevent multiple starts
    }

    /**
     * Loads the wave data from the provided path.
     */
    async load() {
        try {
            const response = await fetch(this.waveDataPath);
            if (!response.ok) {
                throw new Error(`Failed to fetch wave data: ${response.statusText}`);
            }
            this.waveData = await response.json();
            this.isLoaded = true;
            console.log(`WaveManager: Successfully loaded wave data from ${this.waveDataPath}`);
            // Basic validation
            if (!this.waveData.globalWaveSettings || !this.waveData.waves) {
                console.warn("WaveManager: Loaded wave data is missing expected structure (globalWaveSettings or waves). May cause issues.");
            }
            return true;
        } catch (error) {
            console.error('WaveManager: Error loading wave data:', error);
            this.isLoaded = false;
            this.isFinished = true; // Prevent operation if load fails
            throw error; // Re-throw
        }
    }

    /**
     * Starts the wave system, beginning with the initial delay before the first wave.
     * REQUIRES load() to have been called successfully first.
     */
    start() {
        if (this.isStarted) {
            console.warn("WaveManager: Already started.");
            return;
        }
        if (!this.isLoaded || !this.waveData || !this.waveData.globalWaveSettings) {
            console.error("WaveManager: Cannot start. Data not loaded or invalid.");
            this.isFinished = true; // Prevent updates if setup is wrong
            return;
        }
        this.isStarted = true;
        const initialDelay = this.waveData.globalWaveSettings.initialDelayMs || 0;
        console.log(`WaveManager: Starting system. First wave in ${initialDelay / 1000} seconds.`);
        // Use timeout for the very first wave delay
        setTimeout(() => {
            this.startNextWave();
        }, initialDelay);
    }

    /**
     * Sets up the spawners for the next wave in the sequence.
     * REQUIRES load() to have been called successfully first.
     */
    startNextWave() {
        if (!this.isLoaded) {
            console.error("WaveManager: Cannot start next wave, data not loaded.");
            this.isFinished = true;
            return;
        }
        this.currentWaveNumber++;
        console.log(`WaveManager: Starting Wave ${this.currentWaveNumber}`);

        const waveConfig = this.waveData.waves.find(w => w.waveNumber === this.currentWaveNumber);

        // Check if waves are completed
        if (!waveConfig) {
            console.log("WaveManager: All waves completed!");
            this.isFinished = true;
            this.spawners = []; // Ensure no more spawns
            return;
        }

        this.waveStartTime = performance.now(); // Record when the wave officially starts
        this.spawners = []; // Clear spawners from the previous wave

        // Create spawner controllers for each batch defined in the wave config
        waveConfig.spawns.forEach(spawnBatch => {
            this.spawners.push({
                enemyTypeId: spawnBatch.enemyTypeId,
                count: spawnBatch.count,
                spawnIntervalMs: spawnBatch.spawnIntervalMs,
                initialDelayMs: spawnBatch.initialDelayMs,
                spawnedCount: 0,          // How many have spawned from this batch so far
                lastSpawnTime: 0,         // Timestamp of the last spawn in this batch
                isActive: false           // Becomes true after this batch's initialDelayMs passes
            });
        });

        console.log(`WaveManager: Wave ${this.currentWaveNumber} configured with ${this.spawners.length} spawn batches.`);
    }

    /**
     * Updates the state of wave spawning based on the elapsed time.
     * Should be called in the main game loop.
     * @param {number} timestamp - The current high-resolution timestamp (e.g., from performance.now() or requestAnimationFrame).
     * @param {number} deltaTime - The time elapsed (in milliseconds) since the last update.
     */
    update(timestamp, deltaTime) {
        if (this.isFinished || !this.isStarted || !this.isLoaded) {
            return; // Do nothing if finished, not started, or data not loaded
        }

        // Check if waiting for the next wave
        if (this.spawners.length === 0) {
            if (this.timeUntilNextWave > 0) {
                this.timeUntilNextWave -= deltaTime;
                if (this.timeUntilNextWave <= 0) {
                    this.timeUntilNextWave = 0;
                    this.startNextWave(); // Start the next wave
                }
            }
            // If spawners are empty and timeUntilNextWave is 0, it means we're waiting for the initial start timeout or waves are truly finished.
            return; // Nothing else to do if between waves
        }

        // --- Process Active Wave Spawners --- 
        let allBatchesInWaveComplete = true;
        const currentTimeInWave = timestamp - this.waveStartTime; // Time elapsed since this wave started

        this.spawners.forEach(spawner => {
            // Only process batches that haven't finished spawning yet
            if (spawner.spawnedCount < spawner.count) {
                allBatchesInWaveComplete = false; // Mark that this wave is still spawning

                // Activate the spawner if its initial delay has passed
                if (!spawner.isActive && currentTimeInWave >= spawner.initialDelayMs) {
                    spawner.isActive = true;
                    // Allow immediate first spawn if interval is 0 by setting lastSpawnTime appropriately
                    // Set it slightly in the past relative to the interval to ensure the first check passes.
                    spawner.lastSpawnTime = timestamp - spawner.spawnIntervalMs; 
                    console.log(`WaveManager: Spawner active for ${spawner.enemyTypeId} in Wave ${this.currentWaveNumber}`);
                }

                // If the spawner is active and enough time has passed for the next spawn
                if (spawner.isActive && (timestamp - spawner.lastSpawnTime >= spawner.spawnIntervalMs)) {
                    // Call the provided callback to create the enemy instance
                    this.createEnemy(spawner.enemyTypeId, 0); // Spawn at waypoint 0
                    
                    spawner.spawnedCount++;
                    spawner.lastSpawnTime = timestamp; // Record the time of this spawn

                    // Log batch completion
                    if (spawner.spawnedCount === spawner.count) {
                        console.log(`WaveManager: Spawn batch complete for ${spawner.enemyTypeId} in Wave ${this.currentWaveNumber}`);
                    }
                }
            }
        });

        // If all batches in the current wave have finished spawning all their enemies
        if (allBatchesInWaveComplete) {
            console.log(`WaveManager: All spawning complete for Wave ${this.currentWaveNumber}.`);
            this.spawners = []; // Clear the spawners for the completed wave
            this.timeUntilNextWave = this.waveData.globalWaveSettings.delayBetweenWavesMs || 0;
            console.log(`WaveManager: Next wave in ${this.timeUntilNextWave / 1000} seconds.`);
            // Note: We start the timer as soon as spawning finishes. We might later add logic
            //       to wait until all enemies are *cleared* from the screen if desired.
        }
    }
}
