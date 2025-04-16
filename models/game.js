import WaveManager from '../waveManager.js'; // Import the WaveManager
import TuningManager from '../tuningManager.js'; // Import the new manager
import EnemyManager from '../enemyManager.js'; // Import the new EnemyManager
import Base from './base.js'; // Import the Base class
import DefenceManager from '../defenceManager.js'; // <-- ADD Import
import Enemy from './enemy.js'; // <--- ADD Enemy import

export default class Game {
    constructor() {
        this.container = document.getElementById('gameContainer');
        this.layers = {}; // Store layers by name
        this.config = null;
        this.levelData = null;
        this.pathData = null;
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
        this.placementPreview = null; // {x, y} position or null
        this.updateListeners = []; // Array to hold update listener callbacks
    }
    
    // --- ADD methods for placement preview --- 
    setPlacementPreview(position) {
        this.placementPreview = position;
    }

    getPlacementPreview() {
        return this.placementPreview;
    }
    // --- END ADD methods --- 

    async initialize() {
        try {
            // Load level data (paths for enemies, waves, base)
            await this.loadLevel(1);
            
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
                console.log("Game: Base initialized successfully via static method."); 

            } catch(baseError) {
                 // Catch errors from createFromPath (fetch, json, constructor, loadAssets)
                 console.error(`Game Initialize: Failed to initialize Base: ${baseError}`);
                 throw baseError; // Re-throw to stop game initialization
            }

            // Initialize EnemyManager second, passing the base instance
            const enemyDataPath = this.levelData?.enemyData;
            if (!enemyDataPath) {
                throw new Error("Game Initialize: Level data is missing required 'enemyData' path.");
            }
            // Pass this.base to the constructor
            this.enemyManager = new EnemyManager(enemyDataPath, this.pathData, this.base);
            await this.enemyManager.load(); // Load enemy definitions and sprites
            
            // Initialize WaveManager - PASS PATH, ENEMY MANAGER INSTANCE, and CREATE FUNCTION
            if (this.waveDataPath && this.enemyManager) {
                this.waveManager = new WaveManager(
                    this.waveDataPath, // Pass the path
                    this.enemyManager, // Pass the EnemyManager instance
                    this.enemyManager.createEnemy.bind(this.enemyManager)
                );
                await this.waveManager.load(); // Load wave data within the manager
            } else {
                console.error("Cannot initialize WaveManager: waveDataPath or EnemyManager is missing.");
                // Optionally throw error or prevent game start
            }
            
            // Initialize DefenceManager // <-- ADD this block
            if (this.defencesPath) {
                // Pass enemyManager AND base instances to DefenceManager constructor
                this.defenceManager = new DefenceManager(this.defencesPath, this.enemyManager, this.base); 
                await this.defenceManager.load(); // Wait for defence data to load
            } else {
                console.error("Cannot initialize DefenceManager: defencesPath is missing from level data.");
                // Optionally throw an error or prevent game start if defences are critical
            }
            // <-- END ADDED block
            
            // Draw background (Path drawing is now part of render loop)
            this.drawBackground();
            
            // Start game loop
            this.startGameLoop();
            
            // Mark as initialized
            this.initialized = true;

            // --- Register Managers with TuningManager --- 
            if (this.tuningManager) { // Ensure TuningManager exists
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
            
            return true;
        } catch (error) {
            console.error('Failed to initialize game:', error);
            this.initialized = false;
            return false;
        }
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
            
            // Load waypoint data
            if (this.levelData.pathData) {
                try {
                    const pathResponse = await fetch(this.levelData.pathData);
                    const pathText = await pathResponse.text();
                    
                    // Parse CSV into waypoints array
                    this.pathData = pathText.split('\n')
                        .filter(line => line.trim() !== '')
                        .map(line => {
                            const [x, y] = line.split(',').map(coord => parseFloat(coord.trim()));
                            return { x, y };
                        });
                    
                    console.log(`Loaded ${this.pathData.length} waypoints`);
                } catch (pathError) {
                    console.error('Failed to load path data:', pathError);
                }
            }
            
            // Store wave data PATH
            if (this.levelData.waveDataPath) {
                this.waveDataPath = this.levelData.waveDataPath;
                console.log(`Game: Found wave data path: ${this.waveDataPath}`);
            } else {
                console.warn(`No waveDataPath found in level ${levelId} configuration.`);
                this.waveDataPath = null; // Explicitly set to null if missing
            }
            
            // Store base data PATH
            if (this.levelData.baseData) { // Ensure field name matches level1.json
                this.baseDataPath = this.levelData.baseData;
                console.log(`Game: Found base data path: ${this.baseDataPath}`);
            } else {
                console.warn(`No baseData path found in level ${levelId} configuration.`);
                this.baseDataPath = null;
            }

            // Store defences data PATH // <-- ADD this block
            if (this.levelData.defencesPath) {
                this.defencesPath = this.levelData.defencesPath;
                console.log(`Game: Found defences data path: ${this.defencesPath}`);
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

        // --- Draw Path (REMOVED) ---
        
        // --- REMOVED: Target Death Point (Red Dot) & Group Arrival Times (Blue Dots) ---
        // const avgDeathDist = this.waveManager.getLastAverageDeathDistance();
        // if (avgDeathDist !== null && avgDeathDist > 0) {
        //     const deathPoint = this.enemyManager.getPointAtDistance(avgDeathDist);
        //     if (deathPoint) {
        //         // Draw Red Dot
        //         ...
        //         // Draw Blue Dots for Group CoM Arrival Times
        //         const groupMetrics = this.waveManager.getActiveWaveGroupMetrics();
        //         if (groupMetrics && groupMetrics.length > 0) {
        //             ...
        //         }
        //     }
        // }
        // --- END REMOVED ---

        // --- REMOVED: Last Death Test Markers (Orange Recalculated, Yellow Original) ---
        // const lastDeath = this.enemyManager.getLastDeathInfo();
        // if (lastDeath && lastDeath.distance !== null) {
        //     const recalculatedPoint = this.enemyManager.getPointAtDistance(lastDeath.distance);
        //     if (recalculatedPoint) {
        //         // Draw Orange marker at recalculated position
        //         ...
        //         // Draw Yellow X marker at original death position
        //         ...
        //     }
        // }
        // --- END REMOVED ---

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
        ctx.fillStyle = 'rgba(255, 0, 0, 0.5)'; // Semi-transparent red
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
}