import WaveManager from '../waveManager.js'; // Import the WaveManager
import TuningManager from '../tuningManager.js'; // Import the new manager
import EnemyManager from '../enemyManager.js'; // Import the new EnemyManager
import Base from './base.js'; // Import the Base class
import DefenceManager from '../defenceManager.js'; // <-- ADD Import
import Enemy from './enemy.js'; // <--- ADD Enemy import
import PriceManager from '../priceManager.js'; // Import PriceManager
import { minDistanceToPath } from '../utils/geometryUtils.js'; // <-- ADD Import
import { loadCsvLookup } from '../utils/dataLoaders.js'; // <-- IMPORT HELPER

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;

export default class Game {
    constructor() {
        this.container = document.getElementById('gameContainer');
        this.layers = {}; // Store layers by name
        this.config = null;
        this.levelData = null;
        this.pathDataPath = null; // Store the path string to the extended CSV
        this.pathCoverageDataPath = null; // <-- ADDED property
        this.pathStatsPath = null; // <-- ADDED property
        this.waveDataPath = null;
        this.baseDataPath = null; // ADD path for base config
        this.defencesPath = null; // <-- ADD this line
        this.waveManager = null;
        this.canvas = null;
        this.initialized = false;
        this.tuningManager = new TuningManager(500);
        this.enemyManager = null;
        this.base = null; // ADD base instance property
        this.defenceManager = null; // <-- ADD defenceManager property
        this.lastTimestamp = 0;
        this._initPromise = this.initialize();
        this.placementPreview = null; // {x, y, isValid} object or null
        this.updateListeners = []; // Array to hold update listener callbacks
        this.priceManager = null; // Initialize as null
        this.difficulty = null;
        this.currencyScale = null;
        // Path metrics - loaded from path-stats.json
        this.totalPathLength = null;
        this.segmentLengths = [];
        this.cumulativeDistances = [];
        this.extendedPathData = []; // Add storage for path waypoints
        this.pathCoverageLookup = []; // <-- ADDED STORAGE
        this.pathCoverageLoaded = false; // <-- ADDED FLAG
    }
    
    // --- ADD methods for placement preview --- 
    setPlacementPreview(position) {
        if (!position) {
            this.placementPreview = null;
            return;
        }
        
        // Check if path data and config are available
        const path = this.extendedPathData; 
        const exclusionRadius = this.levelData?.pathExclusionRadius;

        if (path && path.length >= 2 && typeof exclusionRadius === 'number') { // Ensure path has at least 2 points
            const distance = minDistanceToPath(position, path); // Use path variable
            const isValid = distance >= exclusionRadius;
            this.placementPreview = { ...position, isValid };
        } else {
            // If path or config not ready, assume invalid or hide preview
             if (!path || path.length < 2) {
                  console.warn("setPlacementPreview: Path data not available or incomplete.");
             }
             if (typeof exclusionRadius !== 'number') {
                 console.warn(`setPlacementPreview: pathExclusionRadius (${exclusionRadius}) not available or not a number in level data.`);
             }
             this.placementPreview = { ...position, isValid: false }; 
            // Or set to null: this.placementPreview = null;
        }
    }

    getPlacementPreview() {
        return this.placementPreview;
    }
    // --- END ADD methods --- 

    async initialize() {
        try {
            // Load level data FIRST (paths for enemies, waves, base)
            await this.loadLevel(1);

            // *** Load Path Coverage Data AFTER loadLevel sets the path ***
            if (this.pathCoverageDataPath) {
                await this.loadPathCoverageData();
            } else {
                throw new Error("Game Initialize: pathCoverageDataPath missing, cannot load coverage data.");
            }
            
            // Create game layers
            this.layers.background = this.createLayer('background-layer', 0);
            this.layers.foreground = this.createLayer('foreground-layer', 1);
            
            // Set up convenient references to commonly used layers
            this.bgCanvas = this.layers.background.canvas;
            this.bgCtx = this.layers.background.ctx;
            this.fgCanvas = this.layers.foreground.canvas;
            this.fgCtx = this.layers.foreground.ctx;           
            
            // Initialize Base FIRST (as EnemyManager needs it)
            if (!this.baseDataPath) {
                 throw new Error("Game Initialize: Level data is missing required 'baseData' path.");
            }
            try {
                // Call the static method on the Base class
                this.base = await Base.createFromPath(this.baseDataPath);
                ////console.log("Game: Base initialized successfully via static method."); 

            } catch(baseError) {
                 // Catch errors from createFromPath (fetch, json, constructor, loadAssets)
                 console.error(`Game Initialize: Failed to initialize Base: ${baseError}`);
                 throw baseError; // Re-throw to stop game initialization
            }

            // Initialize EnemyManager second, passing paths and base
            const enemyDataPath = this.levelData?.enemyData;
            if (!enemyDataPath) {
                throw new Error("Game Initialize: Level data is missing required 'enemyData' path.");
            }
            if (!this.pathDataPath) {
                throw new Error("Game Initialize: pathDataPath was not loaded correctly from level data.");
            }
            // Ensure pathStatsPath was loaded <-- ADDED Check
            if (!this.pathStatsPath) {
                throw new Error("Game Initialize: pathStatsPath was not loaded correctly from level data.");
            }
            // --> ADDED: Get currencyScale from levelData
            const currencyScale = this.levelData?.currencyScale;
            if (typeof currencyScale !== 'number' || currencyScale < 0) {
                throw new Error(`Game Initialize: Invalid currencyScale (${currencyScale}) found in level data.`);
            }
            this.enemyManager = new EnemyManager(
                enemyDataPath,
                this.base,
                this // <-- Pass the Game instance
            );
            await this.enemyManager.load(); 
            
            // Initialize WaveManager - PASS PATH, ENEMY MANAGER INSTANCE, and CREATE FUNCTION
            if (this.waveDataPath && this.enemyManager) {
                this.waveManager = new WaveManager(
                    this.waveDataPath, // Pass the path
                    this.enemyManager, // Pass the EnemyManager instance
                    this.enemyManager.createEnemy.bind(this.enemyManager),
                    this.totalPathLength // <-- ADD Pass the loaded path length
                );
                await this.waveManager.load(); // Load wave data within the manager
            } else {
                console.error("Cannot initialize WaveManager: waveDataPath or EnemyManager is missing.");
                // Optionally throw error or prevent game start
            }
            
            // Initialize DefenceManager
            if (this.defencesPath) {
                // Pass the Game instance ('this') to the constructor
                this.defenceManager = new DefenceManager(this); 
                // Call the renamed method loadDefinitions
                await this.defenceManager.loadDefinitions(this.defencesPath); 
            } else {
                console.error("Cannot initialize DefenceManager: defencesPath is missing from level data.");
            }

            // *** NOW Calculate Wear Parameters ***
            if (this.defenceManager?.isLoaded && this.pathCoverageLoaded) { // Depend on pathCoverageLoaded
                await this.defenceManager.calculateWearParameters(); // <-- CALL IT HERE
            } else {
                console.error("Cannot calculate wear parameters - managers not ready.");
            }
            
            // Draw background (Path drawing is now part of render loop)
            this.drawBackground();
            
            // Start game loop
            this.startGameLoop();
            
            // Mark as initialized
            this.initialized = true;

            // --- Register Managers with TuningManager --- 
            if (this.tuningManager) { // Ensure TuningManager exists
                // Register THIS Game instance for level data updates
                 if (this.levelData) { // levelData should exist here
                      // Construct the path dynamically based on convention or store it
                      const levelDataPath = './assets/level1.json'; // TODO: Make this dynamic if needed
                      this.tuningManager.register(this, levelDataPath);
                 } else {
                      console.warn("Game Initialize: Cannot register Game for tuning, levelData is missing.");
                 }

                if (this.enemyManager && this.levelData?.enemyData) {
                    this.tuningManager.register(this.enemyManager, this.levelData.enemyData);
                }
                if (this.base && this.baseDataPath) {
                    this.tuningManager.register(this.base, this.baseDataPath);
                }
                // ADD registration for DefenceManager // <-- ADD THIS
                if (this.defenceManager && this.defencesPath) {
                    this.tuningManager.register(this.defenceManager, this.defencesPath);
                }
                // ADD registration for WaveManager
                if (this.waveManager && this.waveDataPath) { // Check if waveManager exists
                    this.tuningManager.register(this.waveManager, this.waveDataPath); // Use waveDataPath
                }
            } else {
                console.warn("Game Initialize: TuningManager not available for registrations.");
            }
            // --- End Registrations --- 

            // Start TuningManager (only if something was registered)
            if (this.tuningManager && this.tuningManager.registeredManagers.length > 0) {
                 this.tuningManager.start();
            } else {
                 console.warn("Game Initialize: No managers registered with TuningManager.")
            }
            
            // Start the wave system via the manager
            if (this.waveManager && this.waveManager.isLoaded) { // Check if loaded before starting
                this.waveManager.start();
            } else {
                console.warn("Game Initialize: WaveManager not loaded or available, cannot start waves.")
            }
            
            ////console.log('Game initialization complete.');

            // Instantiate PriceManager
            if (this.defenceManager?.isLoaded && this.enemyManager?.isLoaded && this.base?.isLoaded) {
                //console.log("DEBUG: Game Initialize - About to create PriceManager..."); // <-- ADD LOG
                this.priceManager = new PriceManager(
                    this.defenceManager,
                    this.enemyManager,
                    this.base,
                    this // <-- Pass the Game instance
                );
                await this.priceManager.load(); // <-- Ensure price manager is loaded (now just marks ready)
                //console.log("DEBUG: Game Initialize - PriceManager created:", this.priceManager); // <-- ADD LOG
            } else {
                console.error("Game Initialize: Cannot create PriceManager, required managers not loaded."); // <-- Keep this error
                throw new Error("Game Initialize: Cannot create PriceManager, required managers not loaded.");
            }

            return true;
        } catch (error) {
            console.error('Failed to initialize game:', error);
            this.initialized = false;
            return false;
        }
    }
    
    /**
     * Applies live updates to game-level parameters (difficulty, currencyScale).
     * @param {object} newData - The data object fetched from the level JSON.
     */
    applyParameterUpdates(newData) {
        let updated = false;
        if (typeof newData.difficulty === 'number' && newData.difficulty > 0 && newData.difficulty !== this.difficulty) {
            ////console.log(`Game: Updating difficulty from ${this.difficulty} to ${newData.difficulty}`);
            this.difficulty = newData.difficulty;
            updated = true;
            // Note: PriceManager will automatically pick this up next time it calculates costs.
        }
        if (typeof newData.currencyScale === 'number' && newData.currencyScale >= 0 && newData.currencyScale !== this.currencyScale) {
            ////console.log(`Game: Updating currencyScale from ${this.currencyScale} to ${newData.currencyScale}`);
            this.currencyScale = newData.currencyScale;
            updated = true;
            // Note: EnemyManager will automatically pick this up next time it calculates bounty.
        }
        // Add more parameter checks here if needed

        // if (updated) {
        //     // Optionally, trigger events or recalculations if immediate effect is needed beyond polling
        //     // For example, if PriceManager needed to immediately recalculate all prices:
        //     // if (this.priceManager) this.priceManager.calculateAllCosts(); // But this recalculates all, maybe too much
        // }
    }
    
    // Returns a promise that resolves when the game is fully initialized
    ready() {
        return this._initPromise;
    }
    
    async loadLevel(levelId) {
        try {
            // Load level data from JSON
            const response = await fetch(`./assets/level${levelId}.json`);
            this.levelData = await response.json();
            
            // Load canvas dimensions
            this.canvas = {
                width: this.levelData.canvas.width,
                height: this.levelData.canvas.height
            };
            
            // --> Store initial difficulty and currencyScale from levelData
            if (typeof this.levelData.difficulty === 'number' && this.levelData.difficulty > 0) {
                 this.difficulty = this.levelData.difficulty;
                 ////console.log(`Game: Initial difficulty set to ${this.difficulty}`);
            } else {
                 console.warn(`Game: Using default difficulty ${this.difficulty}. Invalid or missing value in level data.`);
                 // No throw, use default
            }
            if (typeof this.levelData.currencyScale === 'number' && this.levelData.currencyScale >= 0) {
                 this.currencyScale = this.levelData.currencyScale;
                 ////console.log(`Game: Initial currencyScale set to ${this.currencyScale}`);
            } else {
                 console.warn(`Game: Using default currencyScale ${this.currencyScale}. Invalid or missing value in level data.`);
                 // No throw, use default
            }
            // --- End storing initial values ---
            
            // Load background image
            if (this.levelData.mapImage) {
                await new Promise((resolve) => {
                    const bgImage = new Image();
                    bgImage.src = this.levelData.mapImage;
                    bgImage.onload = () => {
                        this.bgImage = bgImage; // Store the image for later drawing
                        resolve();
                    };
                });
            }
            
            // Store waypoint data PATH
            if (this.levelData.pathData) {
                 this.pathDataPath = this.levelData.pathData; 
                 ////console.log(`Game: Found path data file path: ${this.pathDataPath}`);
                 // --- Load path coordinates directly --- 
                 try {
                     const pathResponse = await fetch(this.pathDataPath);
                     if (!pathResponse.ok) throw new Error(`HTTP ${pathResponse.status} loading path data`);
                     const pathCsv = await pathResponse.text();
                     const lines = pathCsv.trim().split('\n');
                     this.extendedPathData = lines.map(line => {
                         const [x, y] = line.split(',').map(Number);
                         if (isNaN(x) || isNaN(y)) {
                             throw new Error(`Invalid data in path CSV line: ${line}`);
                         }
                         return { x, y };
                     });
                     if (this.extendedPathData.length < 2) {
                         throw new Error('Path requires at least two waypoints.');
                     }
                     ////console.log(`Game: Loaded ${this.extendedPathData.length} path waypoints.`);
                 } catch (pathError) {
                     console.error(`Game: Failed to load or parse path data from ${this.pathDataPath}:`, pathError);
                     throw pathError; // Re-throw to stop initialization
                 }
                 // ----------------------------------
            } else {
                 console.warn(`No pathData found in level ${levelId} configuration.`);
                 this.pathDataPath = null;
            }
            
            // Store path coverage data PATH
            if (this.levelData.pathCoverageData) {
                 this.pathCoverageDataPath = this.levelData.pathCoverageData;
                 ////console.log(`Game: Found path coverage data file path: ${this.pathCoverageDataPath}`);
            } else {
                 console.warn(`No pathCoverageData found in level ${levelId} configuration.`);
                 this.pathCoverageDataPath = null;
            }

            // Store path stats data PATH <-- ADDED Block
            if (this.levelData.pathStatsPath) {
                 this.pathStatsPath = this.levelData.pathStatsPath;
                 ////console.log(`Game: Found path stats data file path: ${this.pathStatsPath}`);
                 // --- Load path stats directly --- 
                 try {
                     const statsResponse = await fetch(this.pathStatsPath);
                     if (!statsResponse.ok) throw new Error(`HTTP ${statsResponse.status} loading path stats`);
                     const statsData = await statsResponse.json();
                     if (typeof statsData.totalPathLength !== 'number' || !Array.isArray(statsData.segmentLengths) || !Array.isArray(statsData.cumulativeDistances)) {
                         throw new Error('Invalid format in path stats file');
                     }
                     this.totalPathLength = statsData.totalPathLength;
                     this.segmentLengths = statsData.segmentLengths;
                     this.cumulativeDistances = statsData.cumulativeDistances;
                     ////console.log(`Game: Loaded path stats - Total Length: ${this.totalPathLength.toFixed(2)}`);
                 } catch (statsError) {
                     console.error(`Game: Failed to load or parse path stats from ${this.pathStatsPath}:`, statsError);
                     throw statsError; // Re-throw to stop initialization
                 }
                 // ------------------------------
            } else {
                 console.warn(`No pathStatsPath found in level ${levelId} configuration.`);
                 this.pathStatsPath = null;
            }
            // <-- END ADDED Block
            
            // Store wave data PATH
            if (this.levelData.waveDataPath) {
                this.waveDataPath = this.levelData.waveDataPath;
                ////console.log(`Game: Found wave data path: ${this.waveDataPath}`);
            } else {
                console.warn(`No waveDataPath found in level ${levelId} configuration.`);
                this.waveDataPath = null; // Explicitly set to null if missing
            }
            
            // Store base data PATH
            if (this.levelData.baseData) { // Ensure field name matches level1.json
                this.baseDataPath = this.levelData.baseData;
                ////console.log(`Game: Found base data path: ${this.baseDataPath}`);
            } else {
                console.warn(`No baseData path found in level ${levelId} configuration.`);
                this.baseDataPath = null;
            }

            // Store defences data PATH // <-- ADD this block
            if (this.levelData.defencesPath) {
                this.defencesPath = this.levelData.defencesPath;
                ////console.log(`Game: Found defences data path: ${this.defencesPath}`);
            } else {
                console.warn(`No defencesPath found in level ${levelId} configuration.`);
                this.defencesPath = null;
            }
            // <-- END ADDED block
            
            return this.levelData;
        } catch (error) {
            console.error(`Failed to load level ${levelId}:`, error);
        }
    }
    
    drawBackground() {
        if (this.bgImage) {
            this.bgCtx.drawImage(this.bgImage, 0, 0, this.bgCanvas.width, this.bgCanvas.height);
        }
    }
    
    startGameLoop() {
        const gameLoop = (timestamp) => {
            // Calculate deltaTime
            if (!this.lastTimestamp) {
                this.lastTimestamp = timestamp; // Initialize on first frame
            }
            const deltaTime = timestamp - this.lastTimestamp;
            this.lastTimestamp = timestamp;

            this.update(timestamp, deltaTime); // Pass both timestamp and deltaTime
            this.render();
            requestAnimationFrame(gameLoop);
        };
        
        requestAnimationFrame(gameLoop);
    }
    
    /**
     * Adds a listener function to be called on every game update.
     * @param {function} callback - The function to call. It will receive (timestamp, deltaTime).
     */
    addUpdateListener(callback) {
        if (typeof callback === 'function') {
            this.updateListeners.push(callback);
        } else {
            console.error("Attempted to add non-function listener to game update.", callback);
        }
    }

    /**
     * Main game update loop.
     * @param {number} timestamp - The current high-resolution timestamp.
     * @param {number} deltaTime - The time elapsed (in milliseconds) since the last update.
     */
    update(timestamp, deltaTime) {
        // Update game components
        if (this.waveManager) {
            this.waveManager.update(timestamp, deltaTime);
        }
        if (this.enemyManager) {
            // No longer pass base here
            this.enemyManager.update(timestamp, deltaTime); 
        }
        if (this.defenceManager) {
            this.defenceManager.update(timestamp, deltaTime);
        }
        if (this.base) {
            this.base.update(timestamp, deltaTime);
        }
        
        // Call registered update listeners
        for (const listener of this.updateListeners) {
            try {
                listener(timestamp, deltaTime);
            } catch (error) {
                console.error("Error in game update listener:", error);
                // Consider removing the listener if it consistently fails
            }
        }
    }
    
    createLayer(className, zIndex) {
        const canvas = document.createElement('canvas');
        // Set canvas size from level data
        canvas.width = this.canvas.width;
        canvas.height = this.canvas.height;
        canvas.classList.add('game-layer', className);
        canvas.style.zIndex = zIndex;
        const ctx = canvas.getContext('2d');
        this.container.appendChild(canvas);
        return { canvas, ctx };
    }
    
    render() {
        // Clear foreground canvas
        this.fgCtx.clearRect(0, 0, this.fgCanvas.width, this.fgCanvas.height);
        
        // 1. Render UNDERLAY effects (e.g., puddles) first
        if (this.defenceManager) {
            this.defenceManager.renderEffects(this.fgCtx); 
        }

        // 2. Gather all entities for Y-sorting
        let renderables = [];
        if (this.base && !this.base.isDestroyed()) { 
            renderables.push(this.base);
        }
        if (this.enemyManager) {
            renderables = renderables.concat(this.enemyManager.getActiveEnemies()); 
        }
        if (this.defenceManager) {
            renderables = renderables.concat(this.defenceManager.getActiveDefences());
        }
        // TODO: Add towerManager entities if needed

        // 3. Sort the renderables by their Y coordinate (ascending)
        renderables.sort((a, b) => a.y - b.y);

        // 4. Render the sorted entities by calling their respective methods
        renderables.forEach(entity => {
            if (typeof entity.render === 'function') {
                entity.render(this.fgCtx); // Call render for all entities
            } else if (typeof entity.draw === 'function') {
                 // Fallback for entities like Base that might use 'draw'
                entity.draw(this.fgCtx); 
            } else {
                console.warn("Renderable entity missing recognized render/draw method:", entity);
            }
        });

        // 5. Render OVERLAY effects / UI previews last
        if (this.placementPreview) {
            this.renderPlacementPreview(this.fgCtx);
        }
        // ADD UI Manager Render Call
        // if (this.uiManager) { // Assuming you have a UIManager
        //     this.uiManager.draw(this.fgCtx);
        // }
    }

    // --- ADD method to render preview --- 
    renderPlacementPreview(ctx) {
        if (!this.placementPreview) return;
        ctx.save();
        
        // Choose color based on validity
        if (this.placementPreview.isValid) {
            ctx.fillStyle = 'rgba(0, 255, 0, 0.5)'; // Semi-transparent green
        } else {
            ctx.fillStyle = 'rgba(255, 0, 0, 0.5)'; // Semi-transparent red
        }
        
        // Simple square for now, size could be based on defence type later
        const previewSize = 40; 
        ctx.fillRect(
            this.placementPreview.x - previewSize / 2, 
            this.placementPreview.y - previewSize / 2, 
            previewSize, 
            previewSize
        );
        ctx.restore();
    }

    // --- Game Setup ---
    setupGame() {
        // Implementation of setupGame method
    }

    // --- Getters for Live Parameters ---
    getDifficulty() {
         return this.difficulty;
    }

    getCurrencyScale() {
         return this.currencyScale;
    }
    // --- End Getters ---

    // --- Path Metric Getters --- 
    getTotalPathLength() {
        return this.totalPathLength;
    }

    getSegmentLengths() {
        return this.segmentLengths;
    }

    getCumulativeDistances() {
        return this.cumulativeDistances;
    }
    // --- End Path Metric Getters ---

    // --- Path Coordinate Getter ---
    getExtendedPathData() {
        return this.extendedPathData;
    }
    // --- End Path Coordinate Getter ---

    // *** ADDED: Method to load coverage data ***
    async loadPathCoverageData() {
        if (!this.pathCoverageDataPath) {
            console.error("Game: Cannot load path coverage, path is not set.");
            return;
        }
        try {
            this.pathCoverageLookup = await loadCsvLookup(this.pathCoverageDataPath);
            this.pathCoverageLoaded = true;
            ////console.log("Game: Path coverage data loaded.");
        } catch (error) {
            console.error("Game: Failed to load path coverage data:", error);
            this.pathCoverageLoaded = false;
            throw error; // Stop initialization if coverage fails
        }
    }

    // Helper method in Game class (or ensure PriceManager provides it)
    async getPathCoverageLookup() {
        // This method should wait for coverage data to be loaded
        if (!this.pathCoverageLoaded) {
            console.warn("getPathCoverageLookup called before coverage data loaded. Waiting...");
            // Simple poll/wait 
            while (!this.pathCoverageLoaded) {
                await new Promise(resolve => setTimeout(resolve, 50)); // Wait 50ms
            }
            ////console.log("Coverage data is now ready for lookup.");
        }
        return this.pathCoverageLookup;
    }

    // Helper method in Game class
    getWearParameter() {
        // Assuming wear is stored in levelData loaded during initialize/loadLevel
        return this.levelData?.wear ?? 0; // Default to 0 if not found
    }
}

// --- Standalone Path Utility Function --- 
// (Moved from EnemyManager, adapted to use 'this' for game data)
function getPointAtDistance(targetDistance) {
    // Use 'this' which will be bound to the Game instance
    const pathData = this.getExtendedPathData(); // NEW way - get path from Game
    const cumulativeDistances = this.getCumulativeDistances();
    const segmentLengths = this.getSegmentLengths();

    if (!pathData || pathData.length === 0 || !cumulativeDistances || !segmentLengths) {
        console.warn(`getPointAtDistance: Called when path data or metrics not loaded.`);
        return null;
    }
    if (targetDistance < 0) {
        console.warn(`getPointAtDistance: Called with invalid targetDistance (${targetDistance}).`);
        return null; 
    }
    if (targetDistance === 0) return { ...pathData[0] };

    let targetSegmentIndex = -1;
    for (let i = 0; i < cumulativeDistances.length; i++) {
        if (targetDistance <= cumulativeDistances[i]) {
            targetSegmentIndex = i;
            break;
        }
    }

    if (targetSegmentIndex === -1) {
        return { ...pathData[pathData.length - 1] }; // Return copy of end point
    }

    const p1 = pathData[targetSegmentIndex];
    const p2 = pathData[targetSegmentIndex + 1];
    const distanceToStartOfSegment = (targetSegmentIndex === 0) ? 0 : cumulativeDistances[targetSegmentIndex - 1];
    const distanceIntoSegment = targetDistance - distanceToStartOfSegment;
    const segmentLength = segmentLengths[targetSegmentIndex];

    const factor = (segmentLength > 1e-6) ? (distanceIntoSegment / segmentLength) : 0;

    const x = p1.x + (p2.x - p1.x) * factor;
    const y = p1.y + (p2.y - p1.y) * factor;
    return { x, y };
}