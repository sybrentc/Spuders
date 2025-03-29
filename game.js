// Get the canvas element and its context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Create a new image object for the map
const mapImage = new Image();
mapImage.src = 'map.webp';

// Create sprite image
const spiderSprite = new Image();
spiderSprite.src = 'spider.png';

// Create tower sprite image
const towerSprite = new Image();
towerSprite.src = 'tower.png';

// Create explosion sound
const explosionSound = new Audio('towerexplosion.mp3');

// Create tower hit sound
const towerHitSound = new Audio('towerhit.mp3');
towerHitSound.onerror = (error) => {
    console.error('Error loading tower hit sound:', error);
};
towerHitSound.oncanplaythrough = () => {
    console.log('Tower hit sound loaded successfully');
};

// Create spider hit sound
const spiderHitSound = new Audio('spiderhit.mp3');
spiderHitSound.onerror = (error) => {
    console.error('Error loading spider hit sound:', error);
};
spiderHitSound.oncanplaythrough = () => {
    console.log('Spider hit sound loaded successfully');
};

// Add image load handlers
spiderSprite.onload = () => {
    console.log('Spider sprite loaded successfully');
    console.log('Spider sprite dimensions:', spiderSprite.width, 'x', spiderSprite.height);
};

spiderSprite.onerror = (error) => {
    console.error('Error loading spider sprite:', error);
};

towerSprite.onload = () => {
    console.log('Tower sprite loaded successfully');
    console.log('Tower sprite dimensions:', towerSprite.width, 'x', towerSprite.height);
};

towerSprite.onerror = (error) => {
    console.error('Error loading tower sprite:', error);
};

// Particle class for death effects
class Particle {
    constructor(x, y, type) {
        this.x = x;
        this.y = y;
        this.type = type; // 'smoke' or 'spark'
        
        if (type === 'smoke') {
            this.size = Math.random() * 15 + 8;
            this.speedX = (Math.random() - 0.5) * 4;
            this.speedY = (Math.random() - 0.5) * 4;
            this.life = 1.0; // Full life
            this.decay = 0.02 + Math.random() * 0.02;
            this.color = `rgba(100, 100, 100, ${this.life})`;
        } else { // spark
            this.size = Math.random() * 4 + 3;
            const angle = Math.random() * Math.PI * 2;
            const speed = Math.random() * 6 + 4;
            this.speedX = Math.cos(angle) * speed;
            this.speedY = Math.sin(angle) * speed;
            this.life = 1.0;
            this.decay = 0.05 + Math.random() * 0.05;
            this.color = `rgba(255, ${Math.random() * 100 + 155}, 0, ${this.life})`;
        }
    }

    update() {
        this.x += this.speedX;
        this.y += this.speedY;
        this.life -= this.decay;
        
        if (this.type === 'smoke') {
            this.size += 0.1; // Smoke particles grow
            this.color = `rgba(100, 100, 100, ${this.life})`;
        } else {
            this.color = `rgba(255, ${Math.random() * 100 + 155}, 0, ${this.life})`;
        }
    }

    draw() {
        ctx.save();
        ctx.globalAlpha = this.life;
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
}

// Array to store active particles
let particles = [];

// Spider class definition
class Spider {
    constructor(waypoints, properties = {}) {
        this.waypoints = waypoints;
        this.currentPathIndex = 0;
        this.hp = properties.hp || 100;
        this.maxHp = this.hp;
        this.speed = properties.speed || 0.02;
        this.attackStrength = properties.attackStrength || 10;
        this.attackRate = properties.attackRate || 1; // attacks per second
        this.isFlashing = false;
        this.flashDuration = 200; // milliseconds
        this.lastFlashTime = 0;
        this.isDead = false;
        this.currentFrame = 0;
        this.lastFrameTime = 0;
        this.deathParticles = [];
        this.isAttacking = false;
        this.targetTower = null;
        this.attackRange = 50; // Same as tower's attack radius
    }

    hit(damage) {
        if (this.isDead) return;
        
        this.hp -= damage;
        this.isFlashing = true;
        this.lastFlashTime = performance.now();

        // Play hit sound
        console.log('Attempting to play spider hit sound');
        spiderHitSound.currentTime = 0; // Reset sound to start
        spiderHitSound.play().catch(error => {
            console.error('Error playing spider hit sound:', error);
        });

        if (this.hp <= 0) {
            this.die();
        }
    }

    die() {
        this.isDead = true;
        // Create death particles
        const currentPoint = this.getCurrentPosition();
        if (currentPoint) {
            // Create smoke particles
            for (let i = 0; i < 15; i++) {
                particles.push(new Particle(currentPoint.x, currentPoint.y, 'smoke'));
            }
            // Create spark particles
            for (let i = 0; i < 20; i++) {
                particles.push(new Particle(currentPoint.x, currentPoint.y, 'spark'));
            }
        }
        // Remove this spider from the active spiders array
        const index = activeSpiders.indexOf(this);
        if (index > -1) {
            activeSpiders.splice(index, 1);
        }
    }

    update(timestamp) {
        if (this.isDead) return;

        // Update flash effect
        if (this.isFlashing && timestamp - this.lastFlashTime >= this.flashDuration) {
            this.isFlashing = false;
        }

        // Check if spider is near any tower
        if (!this.isAttacking) {
            for (const tower of activeTowers) {
                if (tower.isInRange(this.getCurrentPosition().x, this.getCurrentPosition().y)) {
                    this.isAttacking = true;
                    this.targetTower = tower;
                    break;
                }
            }
        }

        // If attacking, deal damage to tower
        if (this.isAttacking && this.targetTower && this.targetTower.canAttack(timestamp)) {
            this.targetTower.hit(this.attackStrength);
            this.targetTower.recordAttack(timestamp);
        }

        // Only move if not attacking
        if (!this.isAttacking && timestamp - lastMoveTime >= MOVE_INTERVAL) {
            if (this.currentPathIndex < this.waypoints.length - 1) {
                this.currentPathIndex += this.speed;
                if (this.currentPathIndex >= this.waypoints.length) {
                    this.currentPathIndex = this.waypoints.length - 1;
                }
            }
        }

        // Update animation
        if (timestamp - this.lastFrameTime >= FRAME_DURATION) {
            this.currentFrame = (this.currentFrame + 1) % TOTAL_FRAMES;
            this.lastFrameTime = timestamp;
        }
    }

    draw() {
        if (this.isDead) return;

        const currentPoint = this.getCurrentPosition();
        if (!currentPoint) return;

        // Calculate the angle to the next point for rotation
        const nextIndex = Math.min(Math.floor(this.currentPathIndex) + 1, this.waypoints.length - 1);
        const nextPoint = this.waypoints[nextIndex];
        const angle = Math.atan2(nextPoint.y - currentPoint.y, nextPoint.x - currentPoint.x);

        // Calculate the current frame position in the sprite sheet
        const frameX = (this.currentFrame % FRAMES_PER_ROW) * SPRITE_WIDTH;
        const frameY = Math.floor(this.currentFrame / FRAMES_PER_ROW) * SPRITE_HEIGHT;

        // Save the current context state
        ctx.save();
        
        // Move to the spider's position
        ctx.translate(currentPoint.x, currentPoint.y);
        
        // Apply flash effect if needed
        if (this.isFlashing) {
            // Create a temporary canvas for the spider sprite
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = SPRITE_WIDTH * SPRITE_SCALE;
            tempCanvas.height = SPRITE_HEIGHT * SPRITE_SCALE;
            const tempCtx = tempCanvas.getContext('2d');
            
            // Draw the spider to the temporary canvas
            tempCtx.drawImage(
                spiderSprite,
                frameX, frameY, SPRITE_WIDTH, SPRITE_HEIGHT,
                0, 0, SPRITE_WIDTH * SPRITE_SCALE, SPRITE_HEIGHT * SPRITE_SCALE
            );
            
            // Apply brightness filter
            tempCtx.filter = 'brightness(200%) contrast(200%)';
            tempCtx.drawImage(tempCanvas, 0, 0);
            
            // Draw the filtered spider
            ctx.drawImage(
                tempCanvas,
                -SPRITE_WIDTH*SPRITE_SCALE/2, -SPRITE_HEIGHT*SPRITE_SCALE/2, 
                SPRITE_WIDTH*SPRITE_SCALE, SPRITE_HEIGHT*SPRITE_SCALE
            );
        } else {
            // Draw the normal spider sprite
            ctx.drawImage(
                spiderSprite,
                frameX, frameY, SPRITE_WIDTH, SPRITE_HEIGHT,
                -SPRITE_WIDTH*SPRITE_SCALE/2, -SPRITE_HEIGHT*SPRITE_SCALE/2, 
                SPRITE_WIDTH*SPRITE_SCALE, SPRITE_HEIGHT*SPRITE_SCALE
            );
        }
        
        // Draw health bar
        const healthBarWidth = 30;
        const healthBarHeight = 4;
        const healthPercentage = this.hp / this.maxHp;
        
        // Background of health bar
        ctx.fillStyle = 'red';
        ctx.fillRect(-healthBarWidth/2, -SPRITE_HEIGHT*SPRITE_SCALE/2 - 10, 
                    healthBarWidth, healthBarHeight);
        
        // Current health
        ctx.fillStyle = 'green';
        ctx.fillRect(-healthBarWidth/2, -SPRITE_HEIGHT*SPRITE_SCALE/2 - 10, 
                    healthBarWidth * healthPercentage, healthBarHeight);
        
        // Restore the context state
        ctx.restore();
    }

    getCurrentPosition() {
        const index = Math.floor(this.currentPathIndex);
        const nextIndex = Math.min(index + 1, this.waypoints.length - 1);
        const t = this.currentPathIndex - index;
        
        return interpolate(
            this.waypoints[index],
            this.waypoints[nextIndex],
            t
        );
    }
}

// Array to store waypoints and active spiders
let waypoints = [];
let interpolatedWaypoints = [];
let activeSpiders = [];

// Sprite properties (updated for actual sprite sheet)
const SPRITE_WIDTH = 192;  // 768/4
const SPRITE_HEIGHT = 192; // 768/4
const SPRITE_SCALE = 0.5;  // Scale down the sprite to make it more manageable
const FRAMES_PER_ROW = 4;
const TOTAL_FRAMES = 16;
let lastFrameTime = 0;
const FRAME_DURATION = 400; // milliseconds per frame

// Enemy movement properties
let lastMoveTime = 0;
const MOVE_INTERVAL = 16; // approximately 60 FPS

// Debug function to test spider damage
let lastDamageTime = 0;
const DAMAGE_INTERVAL = 7500; // Damage every 7.5 seconds
const DAMAGE_AMOUNT = 10; // Amount of damage per hit

// Wave system properties
let currentWave = 0;
let spidersSpawnedInWave = 0;
let lastSpawnTime = 0;
const SPIDER_SPAWN_DELAY = 2500; // 2.5 seconds between each spider spawn
const WAVE_DELAY = 30000; // 30 seconds between waves
const SPIDERS_PER_WAVE = 15;

// Wave configuration
const WAVE_CONFIG = {
    1: { // First wave
        spiderProperties: {
            hp: 100,
            speed: 0.02,
            attackStrength: 10,
            attackRate: 1
        }
    },
    2: { // Second wave
        spiderProperties: {
            hp: 150,
            speed: 0.015,
            attackStrength: 15,
            attackRate: 0.8
        }
    }
    // Add more waves as needed
};

// Tower class definition
class Tower {
    constructor(waypoint, properties = {}) {
        this.x = waypoint.x;
        this.y = waypoint.y;
        this.hp = properties.hp || 100;
        this.maxHp = this.hp;
        this.isDead = false;
        
        // Sprite properties
        this.spriteWidth = towerSprite.width / 4; // 4 stages in the sprite sheet
        this.spriteHeight = towerSprite.height;
        this.scale = 0.5; // Adjust this to match your desired tower size
        
        // Placement point configuration (0-1, where 0 is top, 1 is bottom)
        this.anchorY = properties.anchorY || 0.8; // Default to 80% down the sprite
        this.showDebug = properties.showDebug || false; // Show placement point indicator

        // Attack properties
        this.attackRadius = 50; // Radius within which spiders can attack
        this.attackRate = 1000; // Time between attacks in milliseconds
        this.lastAttackTime = 0;
        this.attackDamage = 10;
    }

    // Add method to check if a point is within attack range
    isInRange(x, y) {
        const dx = x - this.x;
        const dy = y - this.y;
        return Math.sqrt(dx * dx + dy * dy) <= this.attackRadius;
    }

    // Add method to get current attack damage
    getAttackDamage() {
        return this.attackDamage;
    }

    // Add method to check if spider can attack
    canAttack(timestamp) {
        return timestamp - this.lastAttackTime >= this.attackRate;
    }

    // Add method to record attack
    recordAttack(timestamp) {
        this.lastAttackTime = timestamp;
    }

    hit(damage) {
        if (this.isDead) return;
        
        this.hp -= damage;
        
        // Play hit sound
        towerHitSound.currentTime = 0; // Reset sound to start
        towerHitSound.play().catch(error => {
            console.error('Error playing tower hit sound:', error);
        });
        
        if (this.hp <= 0) {
            this.die();
        }
    }

    die() {
        this.isDead = true;
        // Play explosion sound
        explosionSound.currentTime = 0; // Reset sound to start
        explosionSound.play();
        
        // Create death particles
        for (let i = 0; i < 150; i++) { // 30 * 5
            particles.push(new Particle(this.x, this.y, 'smoke'));
        }
        for (let i = 0; i < 200; i++) { // 40 * 5
            particles.push(new Particle(this.x, this.y, 'spark'));
        }
    }

    draw() {
        if (this.isDead) return;

        // Calculate which stage of damage to show
        const hpPercentage = this.hp / this.maxHp;
        let stage = 0;
        if (hpPercentage <= 0.25) stage = 3;
        else if (hpPercentage <= 0.5) stage = 2;
        else if (hpPercentage <= 0.75) stage = 1;
        // else stage = 0 (pristine)

        // Save the current context state
        ctx.save();
        
        // Calculate the offset based on the anchor point
        const scaledHeight = this.spriteHeight * this.scale;
        const offsetY = scaledHeight * this.anchorY;
        
        // Draw the tower sprite
        ctx.drawImage(
            towerSprite,
            stage * this.spriteWidth, 0, this.spriteWidth, this.spriteHeight,
            this.x - (this.spriteWidth * this.scale) / 2,
            this.y - offsetY, // Offset based on anchor point
            this.spriteWidth * this.scale,
            this.spriteHeight * this.scale
        );
        
        // Draw debug indicator if enabled
        if (this.showDebug) {
            // Draw the anchor point
            ctx.fillStyle = 'red';
            ctx.beginPath();
            ctx.arc(this.x, this.y, 4, 0, Math.PI * 2);
            ctx.fill();
            
            // Draw a line to show the anchor point's position relative to the sprite
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(this.x, this.y - scaledHeight);
            ctx.stroke();
            
            // Draw text showing the anchor point percentage
            ctx.fillStyle = 'red';
            ctx.font = '12px Arial';
            ctx.fillText(`${Math.round(this.anchorY * 100)}%`, this.x + 5, this.y - 5);
        }
        
        // Draw health bar
        const healthBarWidth = 40;
        const healthBarHeight = 4;
        const healthPercentage = this.hp / this.maxHp;
        
        // Background of health bar
        ctx.fillStyle = 'red';
        ctx.fillRect(
            this.x - healthBarWidth/2,
            this.y - offsetY - 10,
            healthBarWidth,
            healthBarHeight
        );
        
        // Current health
        ctx.fillStyle = 'green';
        ctx.fillRect(
            this.x - healthBarWidth/2,
            this.y - offsetY - 10,
            healthBarWidth * healthPercentage,
            healthBarHeight
        );
        
        // Restore the context state
        ctx.restore();
    }
}

// Array to store active towers
let activeTowers = [];

// Function to calculate distance between two points
function distance(p1, p2) {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

// Function to interpolate between two points
function interpolate(p1, p2, t) {
    return {
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t
    };
}

// Function to generate interpolated waypoints
function generateInterpolatedWaypoints(spacing) {
    interpolatedWaypoints = [];
    
    for (let i = 0; i < waypoints.length - 1; i++) {
        const start = waypoints[i];
        const end = waypoints[i + 1];
        const dist = distance(start, end);
        const steps = Math.ceil(dist / spacing);
        
        for (let j = 0; j <= steps; j++) {
            const t = j / steps;
            interpolatedWaypoints.push(interpolate(start, end, t));
        }
    }
}

// Function to load waypoints from CSV
async function loadWaypoints() {
    try {
        const response = await fetch('path.csv');
        const text = await response.text();
        waypoints = text.split('\n')
            .filter(line => line.trim()) // Remove empty lines
            .map(line => {
                const [x, y] = line.split(',').map(coord => parseFloat(coord.trim()));
                return { x, y };
            });
    } catch (error) {
        console.error('Error loading waypoints:', error);
    }
}

// Function to draw waypoints
function drawWaypoints() {
    // Draw interpolated waypoints
    ctx.fillStyle = 'blue';
    interpolatedWaypoints.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 2, 0, Math.PI * 2);
        ctx.fill();
    });
}

// Function to update enemy position
function updateEnemyPosition(timestamp) {
    if (timestamp - lastMoveTime >= MOVE_INTERVAL) {
        if (currentPathIndex < interpolatedWaypoints.length - 1) {
            currentPathIndex += MOVEMENT_SPEED;
            if (currentPathIndex >= interpolatedWaypoints.length) {
                currentPathIndex = interpolatedWaypoints.length - 1;
            }
        }
        lastMoveTime = timestamp;
    }
}

// Function to update sprite animation
function updateSpriteAnimation(timestamp) {
    if (timestamp - lastFrameTime >= FRAME_DURATION) {
        currentFrame = (currentFrame + 1) % TOTAL_FRAMES;
        lastFrameTime = timestamp;
    }
}

// Function to draw the spider sprite
function drawSpider() {
    const currentPoint = getCurrentPosition();
    if (!currentPoint) {
        console.log('No current point available');
        return;
    }

    // Calculate the angle to the next point for rotation
    const nextIndex = Math.min(Math.floor(currentPathIndex) + 1, interpolatedWaypoints.length - 1);
    const nextPoint = interpolatedWaypoints[nextIndex];
    const angle = Math.atan2(nextPoint.y - currentPoint.y, nextPoint.x - currentPoint.x);

    // Calculate the current frame position in the sprite sheet
    const frameX = (currentFrame % FRAMES_PER_ROW) * SPRITE_WIDTH;
    const frameY = Math.floor(currentFrame / FRAMES_PER_ROW) * SPRITE_HEIGHT;

    // Save the current context state
    ctx.save();
    
    // Move to the spider's position
    ctx.translate(currentPoint.x, currentPoint.y);
    
    // Draw the current frame of the sprite, scaled down
    ctx.drawImage(
        spiderSprite,
        frameX, frameY, SPRITE_WIDTH, SPRITE_HEIGHT,
        -SPRITE_WIDTH*SPRITE_SCALE/2, -SPRITE_HEIGHT*SPRITE_SCALE/2, 
        SPRITE_WIDTH*SPRITE_SCALE, SPRITE_HEIGHT*SPRITE_SCALE
    );
    
    // Restore the context state
    ctx.restore();
}

// Function to spawn a new spider
function spawnSpider(properties = {}) {
    const spider = new Spider(interpolatedWaypoints, properties);
    activeSpiders.push(spider);
    return spider;
}

// Debug function to apply damage to spiders
function debugDamageSpiders(timestamp) {
    if (timestamp - lastDamageTime >= DAMAGE_INTERVAL) {
        activeSpiders.forEach(spider => {
            spider.hit(DAMAGE_AMOUNT);
        });
        lastDamageTime = timestamp;
    }
}

// Function to start a new wave
function startWave() {
    currentWave++;
    spidersSpawnedInWave = 0;
    lastSpawnTime = performance.now();
    console.log(`Starting wave ${currentWave}`);
}

// Function to spawn spiders for the current wave
function spawnWaveSpiders(timestamp) {
    if (spidersSpawnedInWave >= SPIDERS_PER_WAVE) {
        // Wave complete, wait for delay before next wave
        if (timestamp - lastSpawnTime >= WAVE_DELAY) {
            startWave();
        }
        return;
    }

    // Spawn spiders with delay
    if (timestamp - lastSpawnTime >= SPIDER_SPAWN_DELAY) {
        const waveConfig = WAVE_CONFIG[currentWave] || WAVE_CONFIG[1];
        spawnSpider(waveConfig.spiderProperties);
        spidersSpawnedInWave++;
        lastSpawnTime = timestamp;
        console.log(`Spawned spider ${spidersSpawnedInWave}/${SPIDERS_PER_WAVE} in wave ${currentWave}`);
    }
}

// Function to create a new tower
function createTower(waypoint, properties = {}) {
    const tower = new Tower(waypoint, properties);
    activeTowers.push(tower);
    return tower;
}

// Game loop
function gameLoop(timestamp) {
    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw the map
    ctx.drawImage(mapImage, 0, 0);
    
    // Debug: Apply damage to spiders
    debugDamageSpiders(timestamp);
    
    // Spawn spiders for current wave
    spawnWaveSpiders(timestamp);
    
    // Update and draw all spiders
    activeSpiders.forEach(spider => {
        spider.update(timestamp);
        spider.draw();
    });

    // Draw all towers
    activeTowers.forEach(tower => {
        tower.draw();
    });

    // Update and draw particles
    particles = particles.filter(particle => {
        particle.update();
        particle.draw();
        return particle.life > 0;
    });
    
    // Request the next frame
    requestAnimationFrame(gameLoop);
}

// Set up the canvas size to match the map image
mapImage.onload = async () => {
    canvas.width = mapImage.width;
    canvas.height = mapImage.height;
    
    // Load waypoints
    await loadWaypoints();
    
    // Generate interpolated waypoints
    generateInterpolatedWaypoints(20);
    
    // Calculate the tower position at 15% along the path
    const towerIndex = Math.floor(interpolatedWaypoints.length * 0.15);
    const towerWaypoint = interpolatedWaypoints[towerIndex];
    
    // Create a tower at the calculated position with base anchor point
    createTower(towerWaypoint, { 
        hp: 100,
        anchorY: 0.8 // 80% down the sprite
    });
    
    // Start the first wave
    startWave();
    
    // Start the game loop
    requestAnimationFrame(gameLoop);
};

// Function to draw sprites (to be used later)
function drawSprite(sprite, x, y) {
    ctx.drawImage(sprite, x, y);
}