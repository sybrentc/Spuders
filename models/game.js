import WaveManager from '../waveManager.js'; // Import the WaveManager
import Enemy from './enemy.js'; // Import the Enemy class

export default class Game {
    constructor() {
        this.container = document.getElementById('gameContainer');
        this.layers = {}; // Store layers by name
        this.config = null;
        this.levelData = null;
        this.pathData = null;
        this.waveData = null; // Add property to store wave data
        this.waveManager = null; // Add property for the WaveManager instance
        this.canvas = null; // Will store canvas dimensions
        this.initialized = false;
        this.enemyTypes = {}; // Store enemy type definitions
        this.activeEnemies = []; // Store active enemies on the map
        this.enemySprites = {}; // Store loaded sprite images
        this.enemyDataPath = null; // Store path for reloading
        this.enemyUpdateInterval = null; // Store interval ID for updating parameters
        this.lastTimestamp = 0; // Add lastTimestamp for deltaTime calculation
        this._initPromise = this.initialize();
    }
    
    async initialize() {
        try {
            // Load level data
            await this.loadLevel(1);
            
            // Create game layers
            this.layers.background = this.createLayer('background-layer', 0);
            this.layers.foreground = this.createLayer('foreground-layer', 1);
            
            // Set up convenient references to commonly used layers
            this.bgCanvas = this.layers.background.canvas;
            this.bgCtx = this.layers.background.ctx;
            this.fgCanvas = this.layers.foreground.canvas;
            this.fgCtx = this.layers.foreground.ctx;           
            
            // Initialize WaveManager AFTER waveData is loaded
            if (this.waveData) {
                // Pass wave data and the method to create enemies (bound to this Game instance)
                this.waveManager = new WaveManager(this.waveData, this.createEnemy.bind(this));
            } else {
                console.error("Cannot initialize WaveManager: waveData is missing.");
                // Optionally handle this error more gracefully
            }
            
            // Draw background and waypoints
            this.drawBackground();
            
            // Start game loop
            this.startGameLoop();
            
            // Mark as initialized
            this.initialized = true;

            // Start periodic enemy updates if enemy data was loaded
            if (this.enemyDataPath) {
                this.enemyUpdateInterval = setInterval(() => this.periodicallyUpdateEnemies(), 500); // Check every 500ms
            }
            
            // Start the wave system via the manager
            if (this.waveManager) {
                this.waveManager.start();
            }
            
            return true;
        } catch (error) {
            console.error('Failed to initialize game:', error);
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
            
            // Load enemy data
            if (this.levelData.enemyData) {
                try {
                    await this.loadEnemyTypes(this.levelData.enemyData);
                } catch (enemyError) {
                    console.error('Failed to load enemy data:', enemyError);
                }
            }
            
            // Load wave data
            if (this.levelData.waveData) {
                this.waveData = this.levelData.waveData; // Store the wave data
                console.log(`Loaded wave data with ${this.waveData.waves.length} waves defined.`);
            } else {
                console.warn(`No wave data found in level ${levelId} configuration.`);
                this.waveData = { globalWaveSettings: {}, waves: [] }; // Default empty structure
            }
            
            return this.levelData;
        } catch (error) {
            console.error(`Failed to load level ${levelId}:`, error);
        }
    }
    
    async loadEnemyTypes(enemyDataPath) {
        try {
            const response = await fetch(enemyDataPath);
            const enemyDefinitions = await response.json();
            
            console.log(`Loading ${enemyDefinitions.length} enemy types`);
            
            // Create a class for each enemy type
            for (const enemyDef of enemyDefinitions) {
                // Load sprite image for this enemy type
                const sprite = await this.loadSprite(enemyDef.sprite.path);
                this.enemySprites[enemyDef.id] = sprite;
                
                // Store the enemy definition
                this.enemyTypes[enemyDef.id] = enemyDef;
                
                console.log(`Loaded enemy type: ${enemyDef.name}`);
            }
            
            this.enemyDataPath = enemyDataPath;
            console.log('All enemy types loaded successfully. Path stored for periodic updates.');
        } catch (error) {
            console.error('Error loading enemy types:', error);
            throw error;
        }
    }
    
    loadSprite(path) {
        return new Promise((resolve, reject) => {
            const sprite = new Image();
            sprite.onload = () => resolve(sprite);
            sprite.onerror = (e) => reject(new Error(`Failed to load sprite: ${path}`));
            sprite.src = path;
        });
    }
    
    // Create an enemy of the specified type
    createEnemy(enemyTypeId, startIndex = 0) {
        if (!this.enemyTypes[enemyTypeId]) {
            console.error(`Enemy type ${enemyTypeId} not found`);
            return null;
        }
        
        const enemyDef = this.enemyTypes[enemyTypeId];
        const sprite = this.enemySprites[enemyTypeId];
        
        if (!sprite) {
            console.error(`Sprite for enemy type ${enemyTypeId} not loaded`);
            return null;
        }
        
        // Create a new Enemy instance
        const enemy = new Enemy({
            id: enemyTypeId,
            name: enemyDef.name,
            waypoints: this.pathData,
            sprite: sprite,
            startIndex: startIndex,
            // Pass all configuration from the enemy definition
            frameWidth: enemyDef.sprite.frameWidth,
            frameHeight: enemyDef.sprite.frameHeight,
            framesPerRow: enemyDef.sprite.framesPerRow,
            totalFrames: enemyDef.sprite.totalFrames,
            frameDuration: enemyDef.sprite.frameDuration,
            scale: enemyDef.sprite.scale,
            // Pass all stats
            hp: enemyDef.stats.hp,
            speed: enemyDef.stats.speed,
            attackRate: enemyDef.stats.attackRate,
            attackStrength: enemyDef.stats.attackStrength,
            attackRange: enemyDef.stats.attackRange,
            bounty: enemyDef.stats.bounty,
            // Pass all effects
            flashDuration: enemyDef.effects.flashDuration
        });
        
        // Add to active enemies list
        this.activeEnemies.push(enemy);
        
        return enemy;
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
     * Main game update loop.
     * @param {number} timestamp - The current high-resolution timestamp.
     * @param {number} deltaTime - The time elapsed (in milliseconds) since the last update.
     */
    update(timestamp, deltaTime) {
        // 1. Update Wave Manager (handles spawning)
        if (this.waveManager) {
            this.waveManager.update(timestamp, deltaTime);
        }

        // 2. Update all active enemies (movement, animation, attacks etc. will go here)
        for (let i = this.activeEnemies.length - 1; i >= 0; i--) {
            const enemy = this.activeEnemies[i];
            enemy.update(timestamp, deltaTime); // Pass deltaTime if needed by enemy logic
            
            // Remove dead enemies
            if (enemy.isDead) {
                this.activeEnemies.splice(i, 1);
            }
        }

        // 3. Update Towers/Other Game Logic (to be added later)

        // 4. Periodic Parameter Updates (keep existing logic)
        // Note: This is handled by setInterval currently, not directly in the loop.
        // If you wanted finer control or updates tied to frames, you might move
        // the check for periodic updates here.
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
        // Clear only the foreground canvas for game elements
        this.fgCtx.clearRect(0, 0, this.fgCanvas.width, this.fgCanvas.height);
        
        // Draw all active enemies
        this.activeEnemies.forEach(enemy => {
            enemy.draw(this.fgCtx);
        });
    }

    // New method to periodically fetch and update enemies
    async periodicallyUpdateEnemies() {
        if (!this.enemyDataPath) return; // Don't run if path is not set

        try {
            // 1. Fetch the latest enemy definitions
            const response = await fetch(this.enemyDataPath);
            if (!response.ok) {
                // Log a warning but don't stop the interval for temporary network issues
                console.warn(`Failed to fetch enemy updates: ${response.statusText}`);
                return;
            }
            const newEnemyDefinitions = await response.json();

            // Create a map for efficient lookup of new definitions by ID
            const newDefinitionsMap = new Map(newEnemyDefinitions.map(def => [def.id, def]));

            // 2. Update Blueprints (this.enemyTypes)
            newDefinitionsMap.forEach((newDef, enemyId) => {
                // Update the blueprint in memory.
                // Note: This doesn't reload sprites, only definition data.
                this.enemyTypes[enemyId] = newDef;
            });

            // 3. Update Active Enemy Instances
            this.activeEnemies.forEach(enemy => {
                // Find the updated definition for this specific enemy instance
                const updatedDef = newDefinitionsMap.get(enemy.id);
                if (updatedDef) {
                    // Call the enemy's own update method
                    enemy.applyUpdate(updatedDef);
                }
            });

        } catch (error) {
            // Log errors during the update process (e.g., invalid JSON)
            console.error('Error during periodic enemy update:', error);
        }
    }
}