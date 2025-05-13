import { Application, Assets, Sprite, Graphics } from 'pixi.js';
import WaveManager from '../waveManager.js'; // Import the WaveManager
import TuningManager from '../tuningManager.js'; // Import the new manager
import EnemyManager from '../enemyManager.js'; // Import the new EnemyManager
import Base from './base.js'; // Import the Base class
import DefenceManager from '../defenceManager.js'; // <-- ADD Import
import PriceManager from '../priceManager.js'; // Import PriceManager
import StrikeManager from '../strikeManager.js'; // <-- ADDED Import
import { minDistanceToPath } from '../utils/geometryUtils.js'; // <-- ADD Import
import { loadCsvLookup } from '../utils/dataLoaders.js'; // <-- IMPORT HELPER

const DEFAULT_WIDTH = 1024;
const DEFAULT_HEIGHT = 1024;
const INITIAL_MUSIC_VOLUME = 0.2; // Low volume for fade target
const FULL_MUSIC_VOLUME = 1.0;    // Full volume
const MUSIC_PATH = 'assets/music/bach-menuet-frenchsuite3.mp3'; // Path to music

// Forward declare Controller if not using modules or circular dependencies exist
// class Controller {}; 

export default class Game {
    constructor() { // Controller can be set later
        this.container = document.getElementById('gameContainer');
        this.app = null; // Will hold the PixiJS application
        this.config = null;
        this.levelData = null;
        this.pathDataPath = null; // Store the path string to the extended CSV
        this.pathCoverageDataPath = null; // <-- ADDED property
        this.pathStatsPath = null; // <-- ADDED property
        this.waveDataPath = null;
        this.baseDataPath = null; // ADD path for base config
        this.defencesPath = null; // <-- ADD this line
        this.gameConfig = null; // <-- ADDED: To store global game settings
        this.waveManager = null;
        this.canvas = null;
        this.initialized = false;
        this.tuningManager = null; // Initialize as null
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
        this.strikeManager = null;
        this.controller = null; // <-- Controller will be set later
        this.showStrikeManagerHeatmap = false; // <-- ADDED: Flag to control heatmap rendering
        // Path metrics - loaded from path-stats.json
        this.totalPathLength = null;
        this.segmentLengths = [];
        this.cumulativeDistances = [];
        this.extendedPathData = []; // Add storage for path waypoints
        this.pathCoverageLookup = []; // <-- ADDED STORAGE
        this.pathCoverageLoaded = false; // <-- ADDED FLAG
        // --- ADDED: Dynamic difficulty factor ---
        this._breakEvenAlphaFactor = null; // Renamed from _alphaZeroFactor - Stores the calculated break-even alpha factor (α₀)
        this.difficultyScalar = 1.0; // Added: Stores the difficulty scalar 'a' (default to 1.0 = break-even)
        this.betaFactor = null; // Stores the currency scale factor (β)
        this.wearParameter = null; // Stores the wear factor (w)
        this.pathExclusionRadius = null; // Stores the path exclusion radius
        this.pathStats = {}; // Holds path stats like total length
        this.levelConfig = {}; // Holds level-specific config like paths, factors
        this.isGameActive = false; // Added: Flag to control game loop activity
        // --- Game Over / Slow-Mo State --- 
        this.isGameOver = false;
        this.timeScale = 1.0;       // Current time scale (1.0 = normal, <1.0 = slow)
        this.slowMoStartTime = null; // Timestamp when slow-mo transition begins
        this.backgroundMusic = null; // Property to hold the Audio element
        this.isMusicPlaying = false; // Flag to track if music has been started
        this.placementPreviewGraphic = new Graphics(); // ADDED: For placement preview
        this.placementPreviewGraphic.visible = false; // ADDED: Start hidden
    }
    
    // --- ADD methods for placement preview --- 
    /**
     * Checks if a given position is valid for placing a defence based on path proximity.
     * @param {object} position - The {x, y} position to check.
     * @returns {boolean} True if the position is valid, false otherwise.
     */
    isPositionValidForPlacement(position) {
        if (!position) return false;

        const path = this.extendedPathData;
        const exclusionRadius = this.levelConfig?.pathExclusionRadius;

        if (path && path.length >= 2 && typeof exclusionRadius === 'number') {
            const distance = minDistanceToPath(position, path);
            return distance >= exclusionRadius;
        } else {
            // Log if path/config wasn't ready for validation
            if (!path || path.length < 2) {
                 console.warn("isPositionValidForPlacement: Path data not available or incomplete for validation.");
            }
            if (typeof exclusionRadius !== 'number') {
                console.warn(`isPositionValidForPlacement: pathExclusionRadius (${exclusionRadius}) not available or not a number in level config.`);
            }
            return false; // Default to invalid if critical data is missing
        }
    }

    /**
     * Sets the placement preview data.
     * @param {object | null} position - The {x, y} position or null to clear.
     * @param {object | null} defenceDefinition - The definition of the defence being placed.
     */
    setPlacementPreview(position, defenceDefinition) {
        // Always clear previous drawing first
        this.placementPreviewGraphic.clear();

        // --- Validation --- 
        // Check 1: Basic inputs
        if (!position || !defenceDefinition) {
            this.placementPreviewGraphic.visible = false;
            return;
        }

        // Check 2: Required definition and config data
        const config = this.gameConfig;
        if (!defenceDefinition.sprite || !defenceDefinition.display || !config || !config.ui?.placementPreview) {
            console.warn("setPlacementPreview: Missing definition details (sprite, display) or gameConfig.ui.placementPreview. Cannot render.");
            this.placementPreviewGraphic.visible = false;
            return;
        }

        // --- Placement Validity Check (Path Collision) --- 
        const isValidPlacement = this.isPositionValidForPlacement(position);

        // --- Calculate Appearance --- 
        // Size
        const frameWidth = defenceDefinition.sprite.frameWidth;
        const definitionScale = defenceDefinition.display.scale;
        const globalScaleFactor = config.ui.placementPreview.scaleFactor; // Already checked config.ui.placementPreview exists
        const previewSize = frameWidth * definitionScale * globalScaleFactor;

        // Color (with fallbacks)
        // Using hex codes directly for Pixi, alpha is separate parameter in beginFill
        const validColorHex = config.ui.placementPreview.validColorHex || 0x00FF00; // Default Green
        const invalidColorHex = config.ui.placementPreview.invalidColorHex || 0xFF0000; // Default Red
        const colorAlpha = config.ui.placementPreview.alpha || 0.5; // Default Alpha
        const fillColor = isValidPlacement ? validColorHex : invalidColorHex;

        // --- Draw Preview --- 
        // this.placementPreviewGraphic.beginFill(fillColor, colorAlpha); // DEPRECATED
        // Draw centered rectangle
        this.placementPreviewGraphic.rect(
            position.x - previewSize / 2, 
            position.y - previewSize / 2, 
            previewSize, 
            previewSize
        );
        // this.placementPreviewGraphic.endFill(); // DEPRECATED
        this.placementPreviewGraphic.fill({ color: fillColor, alpha: colorAlpha }); // New way to apply fill, with object argument

        // --- Make Visible --- 
        this.placementPreviewGraphic.visible = true;
        
        // REMOVED: this.placementPreview = ... ; // State is now managed by the graphic itself
    }

    getPlacementPreview() {
        // NOTE: This method now returns the OLD state object if it was set previously.
        // It might need refactoring or removal depending on how the controller uses it.
        // For now, keep it, but be aware it doesn't reflect the PIXI graphic state.
        return this.placementPreview; 
    }
    // --- END ADD methods --- 

    // --- ADDED: Load Global Game Config ---
    async loadGameConfig() {
        try {
            const response = await fetch('assets/gameConfig.json');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            this.gameConfig = await response.json();
            //console.log("Game: Global game config loaded:", this.gameConfig);
        } catch (error) {
            console.error("Game Initialize: Failed to load global game config (./assets/gameConfig.json):", error);
            // Set default values or throw error to prevent game start?
            // Setting defaults for resilience:
            this.gameConfig = {
                 maxDeltaTimeMs: 250,
                 gameOver: {
                     slowMoDurationMs: 3000,
                     slowMoTargetScale: 0.2
                 },
                 placementPreview: {
                     scaleFactor: 0.7
                 }
            };
            console.warn("Game Initialize: Using default game config values due to loading error.");
            // Or re-throw: throw error; 
        }
    }
    // --- END ADDED ---

    async initialize() {
        try {
            // *** Load Global Config FIRST ***
            await this.loadGameConfig();

            // *** Initialize Background Music Object ***
            this.initializeBackgroundMusicObject(); // Renamed for clarity

            // *** Assign config values AFTER loading ***
            this.slowMoDuration = this.gameConfig.gameOver.slowMoDurationMs;
            this.targetTimeScale = this.gameConfig.gameOver.slowMoTargetScale;

            // *** Initialize Tuning Manager with config interval ***
            const tuningInterval = this.gameConfig?.tuning?.defaultIntervalMs || 500; // Fallback
            this.tuningManager = new TuningManager(tuningInterval);
            //console.log(`Game: Initialized TuningManager with interval: ${tuningInterval}ms`);

            // Load level data FIRST (paths for enemies, waves, base, canvas dimensions, map image)
            await this.loadLevel(1); // This will now also handle Pixi App creation and background

            // *** Create PixiJS Application ***
            // Ensure this.canvas.width and this.canvas.height are set by loadLevel
            if (!this.canvas || !this.canvas.width || !this.canvas.height) {
                throw new Error("Game Initialize: Canvas dimensions not loaded by loadLevel.");
            }
            this.app = new Application();
            await this.app.init({
                width: this.canvas.width,
                height: this.canvas.height,
                backgroundColor: 0x000000 // Default background, will be covered by map
            });

            this.container.appendChild(this.app.canvas); // Use .canvas and ensure it's after init
            // Background image is loaded and added in loadLevel AFTER app is created.
            // This ordering is a bit tricky. loadLevel needs to know about this.app
            // OR loadLevel prepares the path, and we load image here.
            // Let's adjust loadLevel to load the image path, then load the actual image here.

            if (this.bgImagePath) { // bgImagePath should be set in loadLevel
                const texture = await Assets.load(this.bgImagePath);
                const backgroundSprite = Sprite.from(texture);
                backgroundSprite.width = this.app.screen.width;
                backgroundSprite.height = this.app.screen.height;
                this.app.stage.addChild(backgroundSprite);
                this.app.stage.addChild(this.placementPreviewGraphic); // ADDED: Add preview graphic to stage
            }

            // *** Load Path Coverage Data AFTER loadLevel sets the path ***
            if (this.pathCoverageDataPath) {
                await this.loadPathCoverageData();
            } else {
                throw new Error("Game Initialize: pathCoverageDataPath missing, cannot load coverage data.");
            }
            
            // Initialize Base FIRST (as EnemyManager needs it)
            if (!this.baseDataPath) {
                 throw new Error("Game Initialize: Level data is missing required 'baseData' path.");
            }
            try {
                // Call the static method on the Base class, passing the game instance
                this.base = await Base.createFromPath(this.baseDataPath, this); // Pass `this` (game instance)
                ////console.log("Game: Base initialized successfully via static method."); 

                // Add the base's PIXI.Container to the stage
                if (this.base && this.base.pixiContainer) {
                    this.app.stage.addChild(this.base.pixiContainer);
                } else {
                    console.error("Game Initialize: Base or base.pixiContainer is not available after creation. Cannot add to stage.");
                    // Potentially throw an error here if the base is critical for rendering
                }

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
                    this.totalPathLength, // <-- Pass the loaded path length
                    this // <-- ADDED: Pass the Game instance
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

            // --- ADDED: Initialize StrikeManager ---
            this.strikeManager = new StrikeManager(this);
            await this.strikeManager.loadConfig(); // Load its configuration
            // ------------------------------------

            // --- Calculate initial break-even alpha factor --- 
            // Moved EARLIER: Needs WaveManager (f), EnemyManager (s_min), PathStats (L), LevelConfig (w)
            this.recalculateBreakEvenAlphaFactor(); 
            // ------------------------------------

            // --- Calculate Enemy Scaled Values (Needs Alpha) ---
            if (this.enemyManager) {
                this.enemyManager.calculateAndStoreScaledValues();
            }
            // --------------------------------------------------

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
                console.error("Game Initialize: Cannot create PriceManager, required managers not loaded.");
                throw new Error("Game Initialize: Cannot create PriceManager, required managers not loaded.");
            }

            // *** Initial Cost Calculation ***
            if (this.priceManager) {
                await this.priceManager.recalculateAndStoreCosts();
            }
            // --------------------------

            // --- ADDED: Call DefenceManager setup after PriceManager is ready --- 
            if (this.defenceManager && typeof this.defenceManager.setupAfterLoad === 'function') {
                 this.defenceManager.setupAfterLoad();
            } else {
                 console.error("Game Initialize: DefenceManager or setupAfterLoad method missing.");
            }
            // --- END ADDED ---

            // *** NOW Calculate Wear Parameters (Needs Alpha and Costs) ***
            if (this.defenceManager?.isLoaded && this.pathCoverageLoaded && this.priceManager && this.getAlpha() !== null) {
                await this.defenceManager.calculateWearParameters();
                // --- ADDED: Calculate Bomb Strength AFTER wear params are done ---
                if (this.strikeManager?.isConfigLoaded()) { // Check if strike manager is ready
                    this.strikeManager.calculateBombStrength();
                }
                // --- END ADDED ---
            } else {
                 console.error(`Cannot calculate wear parameters - managers/data not ready. Def: ${this.defenceManager?.isLoaded}, Cov: ${this.pathCoverageLoaded}, Price: ${!!this.priceManager}, Alpha: ${this.getAlpha()}`);
            }
            
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
            
            ////console.log('Game initialization complete.');

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
        // --- REMOVED: Old static difficulty update ---
        // if (typeof newData.difficulty === 'number' ...)

        // --- Check for currencyScale (β) update --- 
        if (typeof newData.currencyScale === 'number' && newData.currencyScale >= 0 && newData.currencyScale !== this.currencyScale) {
            console.log(`Game: Updating currencyScale (β) from ${this.currencyScale} to ${newData.currencyScale}`);
            this.currencyScale = newData.currencyScale;
            updated = true;
            // Note: EnemyManager will automatically pick this up next time it calculates bounty.
        }

        // --- ADDED: Check for wear (w) update --- 
        if (typeof newData.wear === 'number' && newData.wear >= 0 && newData.wear !== this.levelData?.wear) {
            console.log(`Game: Updating wear (w) from ${this.levelData?.wear} to ${newData.wear}`);
            if (this.levelData) { // Ensure levelData exists before trying to update
                 this.levelData.wear = newData.wear; 
            }
            this.recalculateBreakEvenAlphaFactor(); // Recalculate α₀ - Renamed call
            // --- ADDED: Recalculate defender durability (k) ---
            if (this.defenceManager?.isLoaded && this.pathCoverageLoaded) {
                console.log("Game: Wear parameter changed, recalculating defender wear parameters (k)...");
                // No need to await typically, but check if calculateWearParameters becomes async later
                this.defenceManager.calculateWearParameters(); 
            } else {
                console.warn("Game: Cannot recalculate defender wear parameters - DefenceManager or Path Coverage not ready.")
            }
            updated = true; 
            // Note: PriceManager will pick up the new α₀ via getAlpha()
        }
        // --- END ADDED ---

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
            // Make sure levelId is a valid number or string that can be part of a URL
            const response = await fetch(`assets/level${levelId}.json`); // Corrected path
            this.levelData = await response.json();
            
            // Set canvas dimensions from level data
            this.canvas = {
                width: this.levelData.canvas.width,
                height: this.levelData.canvas.height
            };
            
            // Check for betaFactor from levelData
            if (typeof this.levelData.betaFactor === 'number' && this.levelData.betaFactor >= 0) {
                 this.betaFactor = this.levelData.betaFactor; // Use betaFactor
                 //console.log(`Game: Initial betaFactor set to ${this.betaFactor}`);
            } else {
                 // Use the current value if already set (e.g., default), otherwise use 0.01
                 const defaultValue = this.betaFactor !== null ? this.betaFactor : 0.01;
                 console.warn(`Game: Using default betaFactor ${defaultValue}. Invalid or missing value in level data.`);
                 this.betaFactor = defaultValue; 
            }
            // --- End storing initial values ---
            
            // Load background image
            if (this.levelData.mapImage) {
                await new Promise((resolve) => {
                    const bgImage = new Image();
                    bgImage.src = this.levelData.mapImage;
                    bgImage.onload = () => {
                        this.bgImage = bgImage; // Store the image for later drawing
                        this.bgImagePath = this.levelData.mapImage; // Store path for Pixi
                        resolve();
                    };
                    bgImage.onerror = () => { // Handle error
                        console.error("Failed to load background image:", this.levelData.mapImage);
                        this.bgImagePath = null;
                        resolve(); // Resolve anyway so game doesn't hang
                    }
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
            
            // Now we have the paths, we can store them or use them immediately
            this.wearParameter = this.levelData.wear ?? 0; // Load wear
            this.pathExclusionRadius = this.levelData.pathExclusionRadius ?? 0; // Load exclusion radius

            // Store paths for other components to use or for later loading steps
            this.levelConfig = this.levelData;
            
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
            let deltaTime = timestamp - this.lastTimestamp;
            this.lastTimestamp = timestamp;

            // --- ADDED: Clamp Delta Time --- 
            const MAX_DELTA_TIME = this.gameConfig?.maxDeltaTimeMs || 250; // Use config, fallback if needed
            const clampedDeltaTime = Math.min(deltaTime, MAX_DELTA_TIME);
            // -----------------------------

            this.update(timestamp, clampedDeltaTime); // <-- Use clampedDeltaTime for update
            // PixiJS app.ticker will handle rendering.
            // If we need to tie our update to Pixi's ticker:
            // this.app.ticker.add(delta => this.update(performance.now(), delta * (1000 / PIXI.settings.TARGET_FPMS) ));
            // For now, keeping existing requestAnimationFrame loop for update logic, Pixi renders separately.
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
     * @param {number} deltaTime - The CLAMPED time elapsed (in milliseconds) since the last update.
     */
    update(timestamp, deltaTime) { // Renamed parameter to deltaTime, which IS the clampedDeltaTime
        let currentTimeScale = this.timeScale;

        // --- Calculate Time Scale & Music Fade during Game Over Transition ---
        if (this.isGameOver && this.slowMoStartTime !== null) {
            const elapsed = timestamp - this.slowMoStartTime;
            const progress = Math.min(elapsed / this.slowMoDuration, 1.0);

            // Log state BEFORE fade check
            //console.log(`Update - GameOver Check: isMusicPlaying=${this.isMusicPlaying}, music?=${!!this.backgroundMusic}`); // <-- ADD LOG

            // Time scale interpolation
            currentTimeScale = 1.0 + (this.targetTimeScale - 1.0) * progress;
            this.timeScale = currentTimeScale;

            // Music Volume Fade Out Interpolation (Directly setting volume)
            if (this.backgroundMusic) { // Check if music object exists
                // Lerp from Full to Initial volume
                const fadeVolume = FULL_MUSIC_VOLUME + (INITIAL_MUSIC_VOLUME - FULL_MUSIC_VOLUME) * progress;
                // Directly set volume, clamped between 0 and 1
                this.backgroundMusic.volume = Math.max(0, Math.min(1, fadeVolume));
            }

            if (progress === 1.0) {
                this.slowMoStartTime = null; // Slow-mo transition finished
                // Ensure final volume is exact if music exists
                if (this.backgroundMusic) {
                    this.backgroundMusic.volume = INITIAL_MUSIC_VOLUME;
                }
                // console.log("Slow-mo transition and music fade complete."); // Optional log
            }
        }
        // --- End Time Scale & Music Fade Calculation ---

        // --- Pausing Check (only if NOT game over) ---
        if (!this.isGameActive && !this.isGameOver) {
            // If paused, only update the last timestamp to avoid large deltaTime jump on resume
            // And skip the rest of the update logic
            this.lastTimestamp = timestamp;
            return; 
        }
        // --- End Pausing Check ---

        // --- Calculate Effective Delta Time --- 
        // Use the already clamped deltaTime passed into the function
        const effectiveDeltaTime = deltaTime * currentTimeScale;
        
        // Always update last timestamp if game is running (even during slow-mo)
        this.lastTimestamp = timestamp;

        // --- Update Game Components using Effective Delta Time --- 
        // Prevent WaveManager updates during game over to stop new spawns/timers
        if (this.waveManager && !this.isGameOver) { 
            this.waveManager.update(timestamp, effectiveDeltaTime);
        }
        if (this.enemyManager) {
            this.enemyManager.update(timestamp, effectiveDeltaTime);
        }
        if (this.defenceManager) {
            this.defenceManager.update(timestamp, effectiveDeltaTime);
        }
        if (this.base) {
            this.base.update(timestamp, effectiveDeltaTime);
        }
        
        // Call registered update listeners
        for (const listener of this.updateListeners) {
            try {
                // Pass effectiveDeltaTime to listeners as well?
                listener(timestamp, effectiveDeltaTime); 
            } catch (error) {
                console.error("Error in game update listener:", error);
            }
        }

        // --- ADDED: Trigger StrikeManager update calculation --- 
        if (this.strikeManager) {
            // Call the getter which internally calls the update calculation
            this.strikeManager.getCumulativeTargetDamageR(timestamp); 
            // We don't need the return value here, just triggering the update
        }
        // --- END ADDED ---

        // --- MOVED: Update StrikeManager Z-Buffer Calculation ---
        // Moved slightly earlier, but could stay here too.
        if (this.strikeManager?.isConfigLoaded()) {
            this.strikeManager.calculateZBuffer(); 
        }
        // --- END MOVED ---

        // --- ADDED: Call Controller UI Update ---
        if (this.controller && typeof this.controller.updateUI === 'function') {
             this.controller.updateUI();
        } else {
             console.warn("Game loop: Controller or controller.updateUI is missing.");
        }
        // --- END ADDED ---
    }
    
    render() {
        // This method is now gutted as PixiJS handles rendering.
        // All direct drawing calls (e.g., this.fgCtx.clearRect) are removed.
        // Calls to manager.render() are removed.
        // Entity rendering will be handled by entities updating their PIXI.Sprite properties,
        // and those sprites being on the PIXI.stage.
    }

    // --- Game Setup ---
    setupGame() {
        // Implementation of setupGame method
    }

    // --- Getters for Live Parameters ---
    /**
     * Gets the current currency scale factor (beta).
     * @returns {number}
     */
    getBetaFactor() {
        // Add a check for loading? Or assume it's always set post-load?
        if (!this.initialized && this.betaFactor === null) {
            console.warn("Game.getBetaFactor: Called before level config loaded, returning default/null.");
        }
        return this.betaFactor;
    }

    /**
     * Gets the effective alpha factor (a * alpha_0).
     * Ensures the break-even factor is calculated if needed.
     * @returns {number | null} The effective alpha factor.
     */
    getAlpha() { // Renamed from getAlphaZeroFactor
        const breakEvenFactor = this._breakEvenAlphaFactor;
        const scalar = this.difficultyScalar;

        // Check the initialized flag set at the end of the initialize() method
        if (!this.initialized && breakEvenFactor === null) { 
             console.warn("Game.getAlpha: Called before game is fully initialized. Returning null.");
             return null;
        } else if (this.initialized && breakEvenFactor === null) {
            console.error("Game.getAlpha: Game initialized, but break-even alpha factor is null. Attempting recalculation...");
            this.recalculateBreakEvenAlphaFactor(); // Try to calculate break-even factor now - Renamed call
            // Re-check after attempting recalculation
            if (this._breakEvenAlphaFactor === null) {
                 console.error("Game.getAlpha: Recalculation failed. Returning null.");
                 return null;
            }
            // If recalculation succeeded, fall through to return the calculated value
        } else if (breakEvenFactor === null) {
             // Should not happen if logic above is correct, but as a safeguard
             console.error("Game.getAlpha: Break-even alpha factor is unexpectedly null. Returning null.");
             return null;
        }

        // Return the effective alpha: scalar * breakEvenFactor
        return scalar * breakEvenFactor;
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

    // --- ADDED: Dynamic Difficulty Factor Calculation ---
    /**
     * Calculates the BREAK-EVEN alpha factor (alpha_0) based on Eq. 31.
     * Requires WaveManager, EnemyManager, path stats, and levelData.wear to be loaded.
     * α₀ = 1 / (((f - 1) / T₀) + w)
     * where T₀ = L / s_min
     * @returns {number | null} The calculated break-even factor, or null if calculation fails.
     * @private
     */
    _calculateBreakEvenAlphaFactor() { // Renamed from _calculateAlphaFactor
        // 1. Get necessary parameters
        const f = this.waveManager?.getDifficultyIncreaseFactor();
        const w = this.getWearParameter(); // Already has default
        const L = this.getTotalPathLength();
        const s_min = this.enemyManager?.getMinimumEnemySpeed();

        // 2. Validate parameters
        if (typeof f !== 'number' || f <= 1) {
            console.error(`Game._calculateBreakEvenAlphaFactor: Invalid difficulty increase factor (f=${f}). Must be > 1.`);
            return null;
        }
        if (typeof w !== 'number' || w < 0) {
            console.error(`Game._calculateBreakEvenAlphaFactor: Invalid wear parameter (w=${w}). Must be >= 0.`);
            // Allow w=0, so don't return null here unless strictly required
        }
        if (typeof L !== 'number' || L <= 0) {
            console.error(`Game._calculateBreakEvenAlphaFactor: Invalid total path length (L=${L}). Must be > 0.`);
            return null;
        }
        if (typeof s_min !== 'number' || s_min <= 0) {
            console.error(`Game._calculateBreakEvenAlphaFactor: Invalid minimum enemy speed (s_min=${s_min}). Must be > 0.`);
            return null;
        }

        // 3. Calculate T0
        const T0 = L / s_min;
        if (T0 <= 0) {
             console.error(`Game._calculateBreakEvenAlphaFactor: Calculated T0 (${T0}) is not positive.`);
             return null;
        }

        // 4. Calculate Denominator of Eq. 31
        const term1 = (f - 1) / T0;
        const denominator = term1 + w;

        // 5. Check denominator and calculate alpha_0
        if (Math.abs(denominator) < 1e-9) { // Avoid division by near-zero
            console.warn(`Game._calculateBreakEvenAlphaFactor: Denominator near zero (${denominator}). Returning Infinity.`);
            return Infinity; // Or null, depending on desired behavior
        }
        const alpha_0 = 1 / denominator;

        //console.log(`Game: Calculated alpha_0: f=${f}, w=${w}, L=${L}, s_min=${s_min}, T0=${T0} => alpha_0=${alpha_0}`);
        return alpha_0;
    }

    /**
     * Public method to trigger the recalculation of the BREAK-EVEN alpha factor (alpha_0).
     * Should be called when underlying parameters (f, w, T0) change.
     */
    recalculateBreakEvenAlphaFactor() { // Renamed from recalculateAlphaFactor
        // Check if dependencies seem ready before calculating
        if (!this.waveManager || !this.enemyManager || this.totalPathLength === null || this.wearParameter === null) {
             console.warn("Game.recalculateBreakEvenAlphaFactor: Dependencies not ready. Cannot calculate alpha factor yet.");
             return; // Cannot calculate if critical parts are missing
        }
        
        const newBreakEvenFactor = this._calculateBreakEvenAlphaFactor(); // Renamed call
        if (newBreakEvenFactor !== null && this._breakEvenAlphaFactor !== newBreakEvenFactor) {
             if(this._breakEvenAlphaFactor !== null) {
                 console.log(`Game: Break-even alpha factor recalculated: ${this._breakEvenAlphaFactor} -> ${newBreakEvenFactor}`);
             }
             this._breakEvenAlphaFactor = newBreakEvenFactor;
             // Trigger PriceManager recalculation because effective alpha changed
             if (this.priceManager) {
                this.priceManager.recalculateAndStoreCosts(); // Call new method
             }
             // --- ADDED: Trigger DefenceManager recalculation --- 
             if (this.defenceManager) {
                this.defenceManager.calculateWearParameters();
             }
             // --- END ADDED ---
        } else if (newBreakEvenFactor === null) {
             console.error("Game.recalculateBreakEvenAlphaFactor: Failed to calculate new break-even alpha factor.");
        }
    }

    /**
     * Sets the difficulty scalar 'a'.
     * @param {number} scalar - The new difficulty scalar (e.g., 1.0 for hard, <1 for easier).
     */
    setDifficultyScalar(scalar) {
        if (typeof scalar !== 'number' || scalar <= 0) {
            console.error(`Game.setDifficultyScalar: Invalid scalar value (${scalar}). Must be a positive number.`);
            return;
        }
        if (scalar !== this.difficultyScalar) {
            //console.log(`Game: Updating difficulty scalar 'a' from ${this.difficultyScalar} to ${scalar}`);
            this.difficultyScalar = scalar;
            // Trigger PriceManager recalculation because effective alpha changed
            if (this.priceManager) {
               this.priceManager.recalculateAndStoreCosts(); 
            }
            // --- ADDED: Trigger DefenceManager recalculation --- 
            if (this.defenceManager) {
                this.defenceManager.calculateWearParameters();
            }
            // --- END ADDED ---
        }
    }

    /**
     * Resets the game state to its initial conditions for a new game.
     */
    reset() {
        //console.log("Game: Resetting game state...");

        // 1. Reset Wave Manager
        if (this.waveManager) {
            this.waveManager.reset(); // Call the manager's own reset method
            /* // REMOVED manual reset logic
             this.waveManager.currentWaveNumber = 0;
             this.waveManager.isFinished = false;
             this.waveManager.timeUntilNextWave = 0;
             this.waveManager.activeWaveState = { groups: [] };
             this.waveManager.waitingForClear = false;
             this.waveManager.lastAverageDeathDistance = null;
             this.waveManager.lastDisplayedSeconds = null; 
             this.waveManager.isStarted = false; 
            */
        }

        // 2. Reset Enemy Manager
        if (this.enemyManager) {
            this.enemyManager.activeEnemies = [];
            this.enemyManager.currentWaveDeathDistances = [];
            this.enemyManager.lastDeathInfo = { distance: null, originalX: null, originalY: null };
        }

        // 3. Reset Defence Manager
        if (this.defenceManager) {
            this.defenceManager.activeDefences = [];
            // TODO: Reset any other state within DefenceManager if needed
        }

        // 4. Reset Base (assuming a reset method exists or will be added)
        if (this.base) {
            // TODO: Implement Base.reset() to restore health/funds
            // For now, log the intent
            // console.log("Game: Requesting Base reset (method needs implementation).");
            // Example if Base.reset exists:
            this.base.reset(); // Call the newly added reset method
        }

        // 5. Reset Game Loop Timer
        this.lastTimestamp = 0;

        // 6. Reset Game Over / Slow-Mo State
        this.isGameOver = false;
        this.timeScale = 1.0;
        this.slowMoStartTime = null;

        // 7. IMPORTANT: Need mechanism to restart WaveManager's initial timer
        // This is handled by Game.startGame() which is called by controller on restart
        
        // 8. Recalculate costs/wear based on initial state? (Optional)
        // Might be good practice to ensure consistency after reset
        // if (this.priceManager) this.priceManager.recalculateAndStoreCosts();
        // if (this.defenceManager) this.defenceManager.calculateWearParameters();

        //console.log("Game: State reset complete.");
    }

    /**
     * Activates the game loop updates.
     */
    startGame() {
        this.isGameActive = true;
        // Reset last timestamp to prevent large deltaTime jump after pause
        this.lastTimestamp = 0; 
        
        // --- ADDED: Ensure WaveManager starts --- 
        if (this.waveManager && !this.waveManager.isStarted) {
            //console.log("Game: Triggering WaveManager start.");
            this.waveManager.start();
        }
        // --- END ADDED ---
    }

    /**
     * Pauses the game loop updates.
     */
    pauseGame() {
        //console.log("Game: Pausing updates.");
        this.isGameActive = false;
    }

    /**
     * Initiates the game over sequence, including slow-motion transition and music fade-out.
     */
    startGameOverSequence() {
        if (this.isGameOver) return; // Already game over

        // console.log("Game: Starting game over sequence."); // Optional log
        this.isGameOver = true;
        this.isGameActive = false;
        this.slowMoStartTime = performance.now(); // Record start time for transition
        // Volume will start changing in the update loop based on isGameOver & slowMoStartTime
    }

    /**
     * Creates the Audio element and sets its properties.
     * Does NOT attempt to play here.
     */
    initializeBackgroundMusicObject() {
        try {
            this.backgroundMusic = new Audio(MUSIC_PATH);
            this.backgroundMusic.loop = true;
            // NO volume setting here
            // NO .play() call here
        } catch (error) {
            console.error("Failed to create background music Audio object:", error);
            this.backgroundMusic = null; // Ensure it's null if creation fails
        }
    }

    // --- ADDED: Method to set controller after initialization ---
    setController(controllerInstance) {
        if (controllerInstance && typeof controllerInstance.updateUI === 'function') {
            this.controller = controllerInstance;
        } else {
            console.error("Game.setController: Invalid controller instance provided.");
        }
    }
    // --- END ADDED ---

    // --- ADDED: Getter for Health Bar Config ---
    getHealthBarConfig() {
        if (this.gameConfig && this.gameConfig.ui && this.gameConfig.ui.healthBar) {
            return this.gameConfig.ui.healthBar;
        }
        // Log an error and return null if the configuration is not found.
        // The calling code will be responsible for handling a null config.
        console.error("Game.getHealthBarConfig: Health bar configuration not found in gameConfig.json. Health bars may not render correctly.");
        return null;
    }
    // --- END ADDED ---
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