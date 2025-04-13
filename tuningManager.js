export default class TuningManager {
    constructor(updateIntervalMs = 5000) { // Default to 5 seconds, configurable
        this.updateIntervalMs = updateIntervalMs;
        this.registeredManagers = []; // Stores { manager: object, dataPath: string }
        this.intervalId = null;
        this.isRunning = false;
    }

    /**
     * Registers a manager that needs periodic parameter updates.
     * The manager object MUST have:
     * - A method named `applyParameterUpdates(newData)`
     * @param {object} manager - The manager instance (e.g., EnemyManager, DefenseManager)
     * @param {string} dataPath - The URL/path to the JSON file for this manager's parameters.
     */
    register(manager, dataPath) {
        if (typeof manager.applyParameterUpdates !== 'function') {
            console.error(`Manager being registered with TuningManager lacks an 'applyParameterUpdates' method. Path: ${dataPath}`);
            return;
        }
        if (!dataPath) {
             console.error(`Manager being registered with TuningManager requires a valid dataPath.`);
             return;
        }
        this.registeredManagers.push({ manager, dataPath });
        console.log(`TuningManager: Registered manager for data path: ${dataPath}`);
    }

    /**
     * Starts the periodic fetching and updating process.
     */
    start() {
        if (this.isRunning) {
            console.warn("TuningManager: Already running.");
            return;
        }
        if (this.registeredManagers.length === 0) {
            console.warn("TuningManager: No managers registered, starting has no effect.");
            // Optionally, still set isRunning = true if that makes sense for your game state
        }

        console.log(`TuningManager: Starting periodic updates every ${this.updateIntervalMs}ms.`);
        this.isRunning = true;
        // Use an arrow function to maintain 'this' context inside setInterval
        this.intervalId = setInterval(() => this.checkForUpdates(), this.updateIntervalMs);
        // Optional: Run once immediately on start
        // this.checkForUpdates();
    }

    /**
     * Stops the periodic updates.
     */
    stop() {
        if (!this.isRunning) return;
        console.log("TuningManager: Stopping periodic updates.");
        clearInterval(this.intervalId);
        this.intervalId = null;
        this.isRunning = false;
    }

    /**
     * Fetches data for all registered managers and triggers their update methods.
     * Called periodically by setInterval.
     */
    async checkForUpdates() {
        if (!this.isRunning) return; // Don't run if stopped between interval firing and execution

        // console.log("TuningManager: Checking for parameter updates..."); // Optional: for debugging

        for (const registration of this.registeredManagers) {
            try {
                const response = await fetch(registration.dataPath);
                if (!response.ok) {
                    // Log warning for network/server issues, but don't stop the whole process
                    console.warn(`TuningManager: Failed to fetch updates from ${registration.dataPath}: ${response.statusText}`);
                    continue; // Skip to the next manager
                }

                const newData = await response.json();

                // Call the specific manager's update method
                registration.manager.applyParameterUpdates(newData);

            } catch (error) {
                // Log errors during fetch or processing (e.g., invalid JSON)
                console.error(`TuningManager: Error processing updates from ${registration.dataPath}:`, error);
                // Continue trying other managers even if one fails
            }
        }
    }

    // Optional: Add methods to unregister managers if needed during game lifecycle
}
