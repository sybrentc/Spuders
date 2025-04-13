export default class Game {
    constructor() {
        this.container = document.getElementById('gameContainer');
        this.layers = {}; // Store layers by name
        this.config = null;
        this.levelData = null;
        this.pathData = null;
        this.canvas = null; // Will store canvas dimensions
        this.initialized = false;
        this.enemyTypes = {}; // Store enemy type definitions
        this.activeEnemies = []; // Store active enemies on the map
        this.enemySprites = {}; // Store loaded sprite images
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
            
            // Draw background and waypoints
            this.drawBackground();
            this.drawWaypoints();
            
            // Start game loop
            this.startGameLoop();
            
            // Mark as initialized
            this.initialized = true;
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
            
            // Store canvas dimensions from level data
            this.canvas = {
                width: this.levelData.canvas.width,
                height: this.levelData.canvas.height
            };
            
            // Load background image using path from level data
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
            
            // Load path data from CSV if path is provided in level data
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
            
            // Load enemy data if provided in level data
            if (this.levelData.enemyData) {
                try {
                    await this.loadEnemyTypes(this.levelData.enemyData);
                } catch (enemyError) {
                    console.error('Failed to load enemy data:', enemyError);
                }
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
            
            console.log('All enemy types loaded successfully');
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
    
    drawWaypoints() {
        if (!this.pathData || !this.pathData.length) return;
        
        this.bgCtx.fillStyle = 'red';
        
        // Draw each waypoint as a circle
        this.pathData.forEach(point => {
            this.bgCtx.beginPath();
            this.bgCtx.arc(point.x, point.y, 5, 0, Math.PI * 2);
            this.bgCtx.fill();
        });
    }
    
    startGameLoop() {
        const gameLoop = (timestamp) => {
            this.update(timestamp);
            this.render();
            requestAnimationFrame(gameLoop);
        };
        
        requestAnimationFrame(gameLoop);
    }
    
    update(timestamp) {
        // Update all active enemies
        for (let i = this.activeEnemies.length - 1; i >= 0; i--) {
            const enemy = this.activeEnemies[i];
            enemy.update(timestamp);
            
            // Remove dead enemies
            if (enemy.isDead) {
                this.activeEnemies.splice(i, 1);
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
        // Clear only the foreground canvas for game elements
        this.fgCtx.clearRect(0, 0, this.fgCanvas.width, this.fgCanvas.height);
        
        // Draw all active enemies
        this.activeEnemies.forEach(enemy => {
            enemy.draw(this.fgCtx);
        });
    }
}

// Enemy class - dynamically created based on enemy definitions
class Enemy {
    constructor({
        id, name, waypoints, sprite, startIndex = 0,
        frameWidth, frameHeight, framesPerRow, totalFrames, frameDuration, scale,
        hp, speed, attackRate, attackStrength, attackRange, bounty,
        flashDuration
    }) {
        // Identification
        this.id = id;
        this.name = name;
        
        // Path following
        this.waypoints = waypoints;
        this.currentPathIndex = startIndex;
        
        // Sprite and animation
        this.sprite = sprite;
        this.frameWidth = frameWidth;
        this.frameHeight = frameHeight;
        this.framesPerRow = framesPerRow;
        this.totalFrames = totalFrames;
        this.frameDuration = frameDuration;
        this.scale = scale;
        this.currentFrame = 0;
        this.lastFrameTime = 0;
        
        // Stats
        this.hp = hp;
        this.maxHp = hp;
        this.speed = speed;
        this.attackRate = attackRate; 
        this.attackStrength = attackStrength;
        this.attackRange = attackRange;
        this.bounty = bounty;
        
        // State
        this.isDead = false;
        this.isFlashing = false;
        this.flashDuration = flashDuration;
        this.lastFlashTime = 0;
        this.isAttacking = false;
        this.targetTower = null;
        this.lastAttackTime = 0;
    }
    
    update(timestamp) {
        if (this.isDead) return;
        
        // Update flash effect
        if (this.isFlashing && timestamp - this.lastFlashTime >= this.flashDuration) {
            this.isFlashing = false;
        }
        
        // Move along path if not attacking
        if (!this.isAttacking) {
            if (this.currentPathIndex < this.waypoints.length - 1) {
                this.currentPathIndex += this.speed;
                if (this.currentPathIndex >= this.waypoints.length) {
                    this.currentPathIndex = this.waypoints.length - 1;
                }
            }
        }
        
        // Update animation
        if (timestamp - this.lastFrameTime >= this.frameDuration) {
            this.currentFrame = (this.currentFrame + 1) % this.totalFrames;
            this.lastFrameTime = timestamp;
        }
        
        // Handle tower attacks (to be implemented with tower system)
    }
    
    hit(damage) {
        if (this.isDead) return;
        
        this.hp -= damage;
        this.isFlashing = true;
        this.lastFlashTime = performance.now();
        
        if (this.hp <= 0) {
            this.die();
        }
    }
    
    die() {
        this.isDead = true;
        // Additional death logic like particles would go here
    }
    
    draw(ctx) {
        if (this.isDead) return;
        
        const currentPoint = this.getCurrentPosition();
        if (!currentPoint) return;
        
        // Calculate the current frame position in the sprite sheet
        const frameX = (this.currentFrame % this.framesPerRow) * this.frameWidth;
        const frameY = Math.floor(this.currentFrame / this.framesPerRow) * this.frameHeight;
        
        // Save the current context state
        ctx.save();
        
        // Move to the enemy's position
        ctx.translate(currentPoint.x, currentPoint.y);
        
        // Apply flash effect if needed
        if (this.isFlashing) {
            // Create a temporary canvas for the enemy sprite
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.frameWidth * this.scale;
            tempCanvas.height = this.frameHeight * this.scale;
            const tempCtx = tempCanvas.getContext('2d');
            
            // Draw the enemy to the temporary canvas
            tempCtx.drawImage(
                this.sprite,
                frameX, frameY, this.frameWidth, this.frameHeight,
                0, 0, this.frameWidth * this.scale, this.frameHeight * this.scale
            );
            
            // Apply brightness filter
            tempCtx.filter = 'brightness(200%) contrast(200%)';
            tempCtx.globalCompositeOperation = 'source-atop';
            tempCtx.fillStyle = 'white';
            tempCtx.fillRect(0, 0, this.frameWidth * this.scale, this.frameHeight * this.scale);
            
            // Draw the filtered enemy
            ctx.drawImage(
                tempCanvas,
                -this.frameWidth * this.scale / 2, -this.frameHeight * this.scale / 2, 
                this.frameWidth * this.scale, this.frameHeight * this.scale
            );
        } else {
            // Draw the normal enemy sprite
            ctx.drawImage(
                this.sprite,
                frameX, frameY, this.frameWidth, this.frameHeight,
                -this.frameWidth * this.scale / 2, -this.frameHeight * this.scale / 2, 
                this.frameWidth * this.scale, this.frameHeight * this.scale
            );
        }
        
        // Draw health bar
        const healthBarWidth = 30;
        const healthBarHeight = 4;
        const healthPercentage = this.hp / this.maxHp;
        
        // Background of health bar
        ctx.fillStyle = 'red';
        ctx.fillRect(
            -healthBarWidth / 2, 
            -this.frameHeight * this.scale / 2 - 10, 
            healthBarWidth, 
            healthBarHeight
        );
        
        // Current health
        ctx.fillStyle = 'green';
        ctx.fillRect(
            -healthBarWidth / 2, 
            -this.frameHeight * this.scale / 2 - 10, 
            healthBarWidth * healthPercentage, 
            healthBarHeight
        );
        
        // Restore the context state
        ctx.restore();
    }
    
    getCurrentPosition() {
        const index = Math.floor(this.currentPathIndex);
        const nextIndex = Math.min(index + 1, this.waypoints.length - 1);
        const t = this.currentPathIndex - index;
        
        return this.interpolate(
            this.waypoints[index],
            this.waypoints[nextIndex],
            t
        );
    }
    
    interpolate(p1, p2, t) {
        return {
            x: p1.x + (p2.x - p1.x) * t,
            y: p1.y + (p2.y - p1.y) * t
        };
    }
}