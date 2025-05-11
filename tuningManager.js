async function calculateSHA256(message) {
    const msgBuffer = new TextEncoder().encode(message); // encode as UTF-8
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer); // hash the message
    const hashArray = Array.from(new Uint8Array(hashBuffer)); // convert buffer to byte array
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join(''); // convert bytes to hex string
    return hashHex;
}

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
        this.registeredManagers.push({ manager, dataPath, previousRawContent: null });
        //console.log(`TuningManager: Registered manager for data path: ${dataPath}`);
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

        // --- Environment Check --- 
        const isOnGitHubPages = window.location.hostname.includes('github.io');

        if (isOnGitHubPages) {
            console.log("TuningManager: Detected GitHub Pages environment. Periodic updates disabled.");
            this.isRunning = false; // Ensure it's marked as not running the interval
            return; // Don't start the interval
        }
        // If not on GitHub Pages (i.e., local development), proceed.
        // ------------------------

        //console.log(`TuningManager: Starting periodic updates every ${this.updateIntervalMs}ms.`);
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
        //console.log("TuningManager: Stopping periodic updates.");
        clearInterval(this.intervalId);
        this.intervalId = null;
        this.isRunning = false;
    }

    /**
     * Fetches data for all registered managers and triggers their update methods.
     * Called periodically by setInterval.
     */
    async checkForUpdates() {
        if (!this.isRunning) return;

        for (const registration of this.registeredManagers) {
            try {
                const cacheBustingUrl = registration.dataPath;

                const response = await fetch(cacheBustingUrl);
                
                if (!response.ok) {
                    console.warn(`TuningManager: Failed to fetch updates from ${registration.dataPath}: ${response.statusText}`);
                    continue;
                }

                const currentRawContent = await response.text();
                // const currentFileHash = await calculateSHA256(currentRawContent); // No longer needed

                if (currentRawContent !== registration.previousRawContent) { // Compare raw content
                    //console.log(`TuningManager: Detected change in ${registration.dataPath}`);
                    registration.previousRawContent = currentRawContent; // Update stored raw content FIRST
                    const newData = JSON.parse(currentRawContent);
                    
                    // Now, attempt to apply the update. If this fails, TuningManager has still noted the file change.
                registration.manager.applyParameterUpdates(newData);
                } else {
                    // Optional: log that no change was detected (raw content matched previous)
                    // console.log(`TuningManager: No change detected in ${registration.dataPath} (raw content matched previous)`);
                }

            } catch (error) {
                console.error(`TuningManager: Error processing updates from ${registration.dataPath}:`, error);
            }
        }
    }

    // Optional: Add methods to unregister managers if needed during game lifecycle
}
