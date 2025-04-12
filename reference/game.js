// Get the canvas element and its context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Create a new image object for the map
const mapImage = new Image();
mapImage.onload = () => {
    console.log('Map image loaded successfully');
    console.log('Map dimensions:', mapImage.width, 'x', mapImage.height);
    console.log('Natural dimensions:', mapImage.naturalWidth, 'x', mapImage.naturalHeight);
    
    // Set canvas size to match map size
    canvas.width = mapImage.naturalWidth;
    canvas.height = mapImage.naturalHeight;
    backgroundCanvas.width = mapImage.naturalWidth;
    backgroundCanvas.height = mapImage.naturalHeight;
    
    console.log('Canvas size set to:', canvas.width, 'x', canvas.height);
    
    // Initialize the game after the map is loaded
    initializeGame();
    
    // Draw static elements once after initialization
    drawStaticElements();
};
mapImage.onerror = (error) => {
    console.error('Error loading map image:', error);
    console.error('Make sure map.webp exists in the same directory as game.js');
};
mapImage.src = 'map.webp';

// Create sprite image
const spiderSprite = new Image();
spiderSprite.onload = () => {
    console.log('Spider sprite loaded successfully');
    console.log('Spider sprite dimensions:', spiderSprite.width, 'x', spiderSprite.height);
};
spiderSprite.onerror = (error) => {
    console.error('Error loading spider sprite:', error);
    console.error('Make sure spider.png exists in the same directory as game.js');
};
spiderSprite.src = 'spider.png';

// Create tower sprite image
const towerSprite = new Image();
towerSprite.onload = () => {
    console.log('Tower sprite loaded successfully');
    console.log('Tower sprite dimensions:', towerSprite.width, 'x', towerSprite.height);
};
towerSprite.onerror = (error) => {
    console.error('Error loading tower sprite:', error);
    console.error('Make sure tower.png exists in the same directory as game.js');
};
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
spiderHitSound.volume = 0.05; // Set volume to 5%

// Create audio context for pitch variation
const audioContext = new (window.AudioContext || window.webkitAudioContext)();
let spiderHitBuffer = null;

// Load the spider hit sound into a buffer for pitch variation
fetch('spiderhit.mp3')
    .then(response => response.arrayBuffer())
    .then(arrayBuffer => audioContext.decodeAudioData(arrayBuffer))
    .then(audioBuffer => {
        spiderHitBuffer = audioBuffer;
    })
    .catch(error => {
        console.error('Error loading spider hit sound:', error);
    });

// Function to play spider hit sound with pitch variation
function playSpiderHitSound() {
    if (!spiderHitBuffer) return;

    const source = audioContext.createBufferSource();
    source.buffer = spiderHitBuffer;
    
    // Random pitch variation between 0.8 and 1.2 (20% lower to 20% higher)
    const pitch = 0.8 + Math.random() * 0.4;
    source.playbackRate.value = pitch;
    
    // Create gain node for volume control
    const gainNode = audioContext.createGain();
    gainNode.gain.value = 0.05; // Set volume to 5%
    
    // Connect nodes
    source.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Play the sound
    source.start(0);
}

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
        this.bounty = 5; // $5 bounty for killing this spider
    }

    hit(damage) {
        if (this.isDead) return;
        
        this.hp -= damage;
        this.isFlashing = true;
        this.lastFlashTime = performance.now();

        // Play hit sound with pitch variation
        playSpiderHitSound();

        if (this.hp <= 0) {
            this.die();
        }
    }

    die() {
        this.isDead = true;
        // Award bounty
        gameState.money += this.bounty;
        updateMoneyDisplay();
        
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

        // Check if spider is near the main tower
        if (!this.isAttacking && mainTower) {
            const spiderPos = this.getCurrentPosition();
            if (mainTower.isInRange(spiderPos.x, spiderPos.y)) {
                this.isAttacking = true;
                this.targetTower = mainTower;
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
let SPRITE_WIDTH = 192;  // 768/4
let SPRITE_HEIGHT = 192; // 768/4
let SPRITE_SCALE = 0.5;  // Scale down the sprite to make it more manageable
let FRAMES_PER_ROW = 4;
let TOTAL_FRAMES = 16;
let lastFrameTime = 0;
let FRAME_DURATION = 400; // milliseconds per frame

// Enemy movement properties
let lastMoveTime = 0;
let MOVE_INTERVAL = 16; // approximately 60 FPS

// Wave system properties
let currentWave = 0;
let spidersSpawnedInWave = 0;
let lastSpawnTime = 0;
let SPIDER_SPAWN_DELAY = 2500; // 2.5 seconds between each spider spawn
let WAVE_DELAY = 30000; // 30 seconds between waves
let SPIDERS_PER_WAVE = 15;

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

// Create background canvas for static elements
const backgroundCanvas = document.createElement('canvas');
const backgroundCtx = backgroundCanvas.getContext('2d');
let staticElementsDrawn = false;
let lastTowerStage = -1; // Track the last damage stage of the tower

// Function to draw static elements (map and main tower)
function drawStaticElements() {
    console.log('Drawing static elements...');
    
    // Clear the background canvas
    backgroundCtx.clearRect(0, 0, backgroundCanvas.width, backgroundCanvas.height);
    
    // Draw the map
    if (mapImage.complete && mapImage.naturalWidth > 0) {
        backgroundCtx.drawImage(mapImage, 0, 0, backgroundCanvas.width, backgroundCanvas.height);
    }
    
    // Draw the main tower
    if (mainTower) {
        console.log('Drawing main tower on background canvas');
        mainTower.draw(backgroundCtx);
        lastTowerStage = mainTower.getDamageStage();
    }
    
    staticElementsDrawn = true;
}

// Function to force redraw of static elements (e.g., when tower is damaged)
function redrawStaticElements() {
    staticElementsDrawn = false;
    drawStaticElements();
}

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

    getDamageStage() {
        const hpPercentage = this.hp / this.maxHp;
        if (hpPercentage <= 0.25) return 3;
        if (hpPercentage <= 0.5) return 2;
        if (hpPercentage <= 0.75) return 1;
        return 0;
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
        
        // Force redraw of static elements when tower is damaged
        redrawStaticElements();
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

    draw(context = ctx) {
        if (this.isDead) return;

        // Calculate which stage of damage to show
        const stage = this.getDamageStage();

        // Save the current context state
        context.save();
        
        // Calculate the offset based on the anchor point
        const scaledHeight = this.spriteHeight * this.scale;
        const offsetY = scaledHeight * this.anchorY;
        
        // Draw the tower sprite
        context.drawImage(
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
            context.fillStyle = 'red';
            context.beginPath();
            context.arc(this.x, this.y, 4, 0, Math.PI * 2);
            context.fill();
            
            // Draw a line to show the anchor point's position relative to the sprite
            context.strokeStyle = 'rgba(255, 0, 0, 0.5)';
            context.lineWidth = 1;
            context.beginPath();
            context.moveTo(this.x, this.y);
            context.lineTo(this.x, this.y - scaledHeight);
            context.stroke();
            
            // Draw text showing the anchor point percentage
            context.fillStyle = 'red';
            context.font = '12px Arial';
            context.fillText(`${Math.round(this.anchorY * 100)}%`, this.x + 5, this.y - 5);
        }
        
        // Draw health bar
        const healthBarWidth = 40;
        const healthBarHeight = 4;
        const healthPercentage = this.hp / this.maxHp;
        
        // Background of health bar
        context.fillStyle = 'red';
        context.fillRect(
            this.x - healthBarWidth/2,
            this.y - offsetY - 10,
            healthBarWidth,
            healthBarHeight
        );
        
        // Current health
        context.fillStyle = 'green';
        context.fillRect(
            this.x - healthBarWidth/2,
            this.y - offsetY - 10,
            healthBarWidth * healthPercentage,
            healthBarHeight
        );
        
        context.restore();
    }
}

// Base DefenseEntity class
class DefenseEntity {
    constructor(waypoint, properties = {}) {
        this.x = waypoint.x;
        this.y = waypoint.y;
        this.cost = properties.cost || 100;
        this.attackRadius = properties.attackRadius || 150;
        this.attackRate = properties.attackRate || 1000;
        this.attackDamage = properties.attackDamage || 10;
        this.lastAttackTime = 0;
        this.target = null;
    }

    canAttack(timestamp) {
        return timestamp - this.lastAttackTime >= this.attackRate;
    }

    findTarget() {
        let closestSpider = null;
        let minDistance = this.attackRadius;

        for (const spider of activeSpiders) {
            if (spider.isDead) continue;
            
            const spiderPos = spider.getCurrentPosition();
            const distance = Math.sqrt(
                Math.pow(spiderPos.x - this.x, 2) + 
                Math.pow(spiderPos.y - this.y, 2)
            );

            if (distance <= this.attackRadius && distance < minDistance) {
                minDistance = distance;
                closestSpider = spider;
            }
        }

        this.target = closestSpider;
        return closestSpider;
    }

    attack(timestamp) {
        if (!this.canAttack(timestamp)) return false;
        
        const target = this.findTarget();
        if (!target) return false;

        this.lastAttackTime = timestamp;
        target.hit(this.attackDamage);
        return true;
    }

    update(timestamp) {
        this.attack(timestamp);
    }

    draw() {
        // Draw a red square for the defense entity
        ctx.save();
        ctx.fillStyle = 'red';
        ctx.fillRect(this.x - 20, this.y - 20, 40, 40);
        ctx.restore();
    }
}

// Laser Tower - High damage, slow rate, high cost
class LaserTower extends DefenseEntity {
    constructor(waypoint, properties = {}) {
        super(waypoint, {
            ...properties,
            cost: 300,
            attackRadius: 200,
            attackRate: 3000, // 3 seconds between attacks
            attackDamage: 50,
            hp: 150
        });
    }

    draw() {
        super.draw();
        // Add laser beam effect when attacking
        if (this.target && !this.target.isDead) {
            const targetPos = this.target.getCurrentPosition();
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.7)';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(targetPos.x, targetPos.y);
            ctx.stroke();
            ctx.restore();
        }
    }
}

// Axolotl Gunner - Fast rate, low damage, low cost
class AxolotlGunner extends DefenseEntity {
    constructor(waypoint, properties = {}) {
        super(waypoint, {
            ...properties,
            cost: 100,
            attackRadius: 150,
            attackRate: 200, // 0.2 seconds between attacks
            attackDamage: 5,
            hp: 80
        });
    }

    draw() {
        super.draw();
        // Add rapid fire effect
        if (this.target && !this.target.isDead) {
            const targetPos = this.target.getCurrentPosition();
            ctx.save();
            ctx.strokeStyle = 'rgba(0, 255, 255, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(targetPos.x, targetPos.y);
            ctx.stroke();
            ctx.restore();
        }
    }
}

// Tank - Medium rate, high damage, medium cost
class Tank extends DefenseEntity {
    constructor(waypoint, properties = {}) {
        super(waypoint, {
            ...properties,
            cost: 200,
            attackRadius: 180,
            attackRate: 2000, // 2 seconds between attacks
            attackDamage: 30,
            hp: 200
        });
    }

    draw() {
        super.draw();
        // Add rocket trail effect
        if (this.target && !this.target.isDead) {
            const targetPos = this.target.getCurrentPosition();
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 165, 0, 0.7)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(targetPos.x, targetPos.y);
            ctx.stroke();
            ctx.restore();
        }
    }
}

// Turret Tower - Fast rate, low damage, medium cost
class TurretTower extends DefenseEntity {
    constructor(waypoint, properties = {}) {
        super(waypoint, {
            ...properties,
            cost: 150,
            attackRadius: 160,
            attackRate: 300, // 0.3 seconds between attacks
            attackDamage: 8,
            hp: 120
        });
    }

    draw() {
        super.draw();
        // Add machine gun effect
        if (this.target && !this.target.isDead) {
            const targetPos = this.target.getCurrentPosition();
            ctx.save();
            ctx.strokeStyle = 'rgba(255, 255, 0, 0.5)';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(this.x, this.y);
            ctx.lineTo(targetPos.x, targetPos.y);
            ctx.stroke();
            ctx.restore();
        }
    }
}

// Glue Turret - Slow rate, no damage, medium cost, slows enemies
class GlueTurret extends DefenseEntity {
    constructor(waypoint, properties = {}) {
        super(waypoint, {
            ...properties,
            cost: 175,
            attackRadius: 170,
            attackRate: 2500, // 2.5 seconds between attacks
            attackDamage: 0,
            hp: 100
        });
        this.gluePuddles = [];
    }

    attack(timestamp) {
        if (!this.canAttack(timestamp)) return false;
        
        const target = this.findTarget();
        if (!target) return false;

        this.lastAttackTime = timestamp;
        
        // Create a new glue puddle at the target's position
        const targetPos = target.getCurrentPosition();
        this.gluePuddles.push({
            x: targetPos.x,
            y: targetPos.y,
            createdAt: timestamp,
            duration: 10000 // 10 seconds
        });

        return true;
    }

    update(timestamp) {
        if (this.isDead) return;
        
        // Update glue puddles
        this.gluePuddles = this.gluePuddles.filter(puddle => {
            return timestamp - puddle.createdAt < puddle.duration;
        });

        // Check for spiders in glue puddles
        for (const spider of activeSpiders) {
            if (spider.isDead) continue;
            
            const spiderPos = spider.getCurrentPosition();
            for (const puddle of this.gluePuddles) {
                const distance = Math.sqrt(
                    Math.pow(spiderPos.x - puddle.x, 2) + 
                    Math.pow(spiderPos.y - puddle.y, 2)
                );
                
                if (distance < 20) { // Glue puddle radius
                    spider.speed = spider.speed * 0.2; // Slow down by 5x
                    break;
                }
            }
        }

        this.attack(timestamp);
    }

    draw() {
        super.draw();
        
        // Draw glue puddles
        for (const puddle of this.gluePuddles) {
            ctx.save();
            ctx.fillStyle = 'rgba(0, 255, 255, 0.3)';
            ctx.beginPath();
            ctx.arc(puddle.x, puddle.y, 20, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }
}

// Array to store active towers and defense entities
let mainTower = null;
let activeDefenses = [];

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

// Game flags and tracking variables
let waveStartTime = 0;

// Function to start a wave
function startWave() {
    currentWave++;
    waveStartTime = Date.now();
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
    return tower;
}

// Defense entity types and their properties
const DEFENSE_TYPES = {
    LASER_TOWER: {
        class: LaserTower
    },
    AXOLOTL_GUNNER: {
        class: AxolotlGunner
    },
    TANK: {
        class: Tank
    },
    TURRET_TOWER: {
        class: TurretTower
    },
    GLUE_TURRET: {
        class: GlueTurret
    }
};

// Game state
let gameState = {
    money: 1000,
    selectedDefenseType: null,
    previewEntity: null
};

// Function to create preview entity
function createPreviewEntity(defenseType) {
    return {
        x: 0,
        y: 0,
        draw: function() {
            ctx.save();
            ctx.fillStyle = 'rgba(255, 0, 0, 0.5)';
            ctx.fillRect(this.x - 20, this.y - 20, 40, 40);
            ctx.restore();
        }
    };
}

// Function to handle mouse movement
function handleMouseMove(event) {
    if (gameState.selectedDefenseType && gameState.previewEntity) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        gameState.previewEntity.x = (event.clientX - rect.left) * scaleX;
        gameState.previewEntity.y = (event.clientY - rect.top) * scaleY;
    }
}

// Function to handle mouse click
function handleMouseClick(event) {
    if (gameState.selectedDefenseType && gameState.previewEntity) {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        
        const x = (event.clientX - rect.left) * scaleX;
        const y = (event.clientY - rect.top) * scaleY;
        
        // Create the actual defense entity
        const defenseClass = gameState.selectedDefenseType.class;
        const newEntity = new defenseClass({ x, y }, {
            hp: 100,
            anchorY: 0.8
        });
        
        // Add to active defenses
        activeDefenses.push(newEntity);
        
        // Deduct cost
        gameState.money -= gameState.selectedDefenseType.cost;
        updateMoneyDisplay();
        
        // Clear selection and preview
        gameState.selectedDefenseType = null;
        gameState.previewEntity = null;
        
        // Reset menu item borders
        document.querySelectorAll('.menuItem').forEach(item => {
            item.style.borderColor = '#fff';
        });
    }
}

// Function to create menu items
function createMenuItems() {
    const menuBar = document.getElementById('menuBar');
    menuBar.innerHTML = ''; // Clear existing items

    Object.values(DEFENSE_TYPES).forEach(defenseType => {
        const menuItem = document.createElement('div');
        menuItem.className = 'menuItem';
        menuItem.innerHTML = `
            <div>${defenseType.name}</div>
            <div class="cost">$${defenseType.cost}</div>
        `;
        
        // Check if player can afford this defense
        const canAfford = gameState.money >= defenseType.cost;
        if (!canAfford) {
            menuItem.style.opacity = '0.5';
            menuItem.style.cursor = 'not-allowed';
        }
        
        // Add click handler
        menuItem.addEventListener('click', () => {
            if (canAfford) {
                gameState.selectedDefenseType = defenseType;
                gameState.previewEntity = createPreviewEntity(defenseType);
                
                // Visual feedback for selection
                document.querySelectorAll('.menuItem').forEach(item => {
                    item.style.borderColor = '#ff0';
                });
                menuItem.style.borderColor = '#ff0';
            } else {
                // Visual feedback for insufficient funds
                menuItem.style.animation = 'shake 0.5s';
                setTimeout(() => {
                    menuItem.style.animation = '';
                }, 500);
            }
        });

        menuBar.appendChild(menuItem);
    });
}

// Add CSS for shake animation
const style = document.createElement('style');
style.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
    }
`;
document.head.appendChild(style);

// Function to update money display and menu items
function updateMoneyDisplay() {
    const moneyDisplay = document.getElementById('moneyDisplay') || document.createElement('div');
    moneyDisplay.id = 'moneyDisplay';
    moneyDisplay.style.position = 'absolute';
    moneyDisplay.style.color = 'white';
    moneyDisplay.style.fontFamily = 'Arial, sans-serif';
    moneyDisplay.style.fontSize = '20px';
    moneyDisplay.style.zIndex = '1000'; // Ensure it's above the game canvas
    moneyDisplay.textContent = `$${gameState.money}`;
    
    // Position relative to the game canvas
    const canvasRect = canvas.getBoundingClientRect();
    moneyDisplay.style.left = `${canvasRect.left + canvasRect.width - 100}px`; // 100px from right edge of canvas
    moneyDisplay.style.top = `${canvasRect.top + 10}px`; // 10px from top of canvas
    
    if (!document.getElementById('moneyDisplay')) {
        document.getElementById('gameContainer').appendChild(moneyDisplay);
    }

    // Update menu items based on new money amount
    const menuItems = document.querySelectorAll('.menuItem');
    if (menuItems.length > 0) {
        Object.values(DEFENSE_TYPES).forEach((defenseType, index) => {
            if (index < menuItems.length) {
                const menuItem = menuItems[index];
                const canAfford = gameState.money >= defenseType.cost;
                menuItem.style.opacity = canAfford ? '1' : '0.5';
                menuItem.style.cursor = canAfford ? 'pointer' : 'not-allowed';
            }
        });
    }
}

// Initialize menu and money display
function initializeUI() {
    createMenuItems();
    updateMoneyDisplay();
}

// Function to handle window resize
function handleResize() {
    // Get window dimensions instead of relying on container
    const windowWidth = window.innerWidth;
    const windowHeight = window.innerHeight;
    
    // Ensure the map image is loaded and has valid dimensions
    if (!mapImage.complete || mapImage.naturalWidth === 0 || mapImage.naturalHeight === 0) {
        console.log('Map image not fully loaded yet, will resize later');
        // Schedule another resize once the image is loaded
        setTimeout(handleResize, 100);
        return;
    }
    
    // Log dimensions to help debug
    console.log('Window size:', windowWidth, 'x', windowHeight);
    
    // Ensure container is properly styled to take up full window
    const container = document.getElementById('gameContainer');
    if (container) {
        container.style.width = '100%';
        container.style.height = '100vh';
        container.style.overflow = 'hidden';
        container.style.position = 'relative';
        console.log('Applied full size to container');
    }
    
    // Position the button bar first
    const buttonBarHeight = 80; // Height of the button bar
    const menuBar = document.getElementById('menuBar');
    if (menuBar) {
        menuBar.style.position = 'absolute';
        menuBar.style.left = '0';
        menuBar.style.right = '0';
        menuBar.style.bottom = '0';
        menuBar.style.height = `${buttonBarHeight}px`;
        menuBar.style.display = 'flex';
        menuBar.style.justifyContent = 'center';
        menuBar.style.alignItems = 'center';
        menuBar.style.backgroundColor = '#333';
        menuBar.style.zIndex = '1000';
    }
    
    // Calculate available space for the game canvas
    const availableWidth = windowWidth;
    const availableHeight = windowHeight - buttonBarHeight;
    
    // Calculate scaling factors for width and height
    const scaleX = availableWidth / mapImage.naturalWidth;
    const scaleY = availableHeight / mapImage.naturalHeight;
    
    // Use the smaller scaling factor to ensure everything fits while maintaining aspect ratio
    const scale = Math.min(scaleX, scaleY);
    console.log('Scaling factors - X:', scaleX, 'Y:', scaleY, 'Using:', scale);
    
    // Calculate new dimensions with a minimum size
    const newWidth = Math.max(Math.round(mapImage.naturalWidth * scale), 100);
    const newHeight = Math.max(Math.round(mapImage.naturalHeight * scale), 100);
    console.log('New canvas display size:', newWidth, 'x', newHeight);
    
    // Set canvas internal resolution to match map image
    canvas.width = mapImage.naturalWidth;
    canvas.height = mapImage.naturalHeight;
    backgroundCanvas.width = mapImage.naturalWidth;
    backgroundCanvas.height = mapImage.naturalHeight;
    
    // Apply scaling to canvas display size
    canvas.style.width = `${newWidth}px`;
    canvas.style.height = `${newHeight}px`;
    
    // Position the canvas at the top of the screen, centered horizontally
    const leftPosition = Math.max(Math.floor((availableWidth - newWidth) / 2), 0);
    const topPosition = 0; // Start at the very top of the screen
    
    canvas.style.position = 'absolute';
    canvas.style.left = `${leftPosition}px`;
    canvas.style.top = `${topPosition}px`;
    canvas.style.marginLeft = '0';
    canvas.style.marginTop = '0';
    
    console.log('Canvas positioned at:', leftPosition, 'x', topPosition);
    
    // Update money display position relative to the game canvas
    updateMoneyDisplay();
    
    // Force redraw of static elements after resize
    drawStaticElements();
}

// Add style for game container on DOM load
document.addEventListener('DOMContentLoaded', function() {
    // Setup the game container styling
    const container = document.getElementById('gameContainer');
    if (container) {
        container.style.width = '100%';
        container.style.height = '100vh';
        container.style.overflow = 'hidden';
        container.style.position = 'relative';
        console.log('Initial container styling applied');
    } else {
        console.error('Game container not found!');
    }
    
    // Set initial size
    setTimeout(handleResize, 100);
});

// Game parameters
let gameParameters = null;
let lastParameterUpdate = 0;
const PARAMETER_UPDATE_INTERVAL = 200; // ms

// Function to fetch and update game parameters
async function updateGameParameters() {
    try {
        const response = await fetch('game_parameters.json');
        if (!response.ok) throw new Error('Failed to fetch parameters');
        gameParameters = await response.json();
        
        // Apply updated parameters
        SPRITE_SCALE = gameParameters.display.sprite_scale;
        FRAME_DURATION = gameParameters.animation.frame_duration_ms;
        MOVE_INTERVAL = gameParameters.animation.move_interval_ms;
        
        // Apply tower position
        const newTowerIndex = Math.floor(interpolatedWaypoints.length * gameParameters.map.tower_position_percentage);
        const newTowerWaypoint = interpolatedWaypoints[newTowerIndex];
        
        if (mainTower) {
            mainTower.x = newTowerWaypoint.x;
            mainTower.y = newTowerWaypoint.y;
            mainTower.attackRadius = gameParameters.main_tower.attack_radius;
            mainTower.attackRate = gameParameters.main_tower.attack_rate_ms;
            mainTower.attackDamage = gameParameters.main_tower.attack_damage;
            drawStaticElements(); // Redraw static elements with new tower position
        }
        
        // Update wave parameters
        SPIDERS_PER_WAVE = gameParameters.waves.spiders_per_wave;
        SPIDER_SPAWN_DELAY = gameParameters.waves.spawn_delay_ms;
        WAVE_DELAY = gameParameters.waves.wave_delay_ms;
        
        // Update defense entity costs and properties from parameters
        if (gameParameters.defense_entities) {
            let costsChanged = false;
            let namesChanged = false;
            
            Object.keys(DEFENSE_TYPES).forEach(type => {
                const paramName = type.toLowerCase();
                if (gameParameters.defense_entities[paramName]) {
                    const entityParams = gameParameters.defense_entities[paramName];
                    
                    // Check if cost has changed
                    if (DEFENSE_TYPES[type].cost !== entityParams.cost) {
                        costsChanged = true;
                        DEFENSE_TYPES[type].cost = entityParams.cost;
                    }
                    
                    // Check if name has changed
                    if (DEFENSE_TYPES[type].name !== entityParams.name) {
                        namesChanged = true;
                        DEFENSE_TYPES[type].name = entityParams.name;
                    }
                    
                    // Update existing defense entities
                    activeDefenses.forEach(defense => {
                        if (defense.constructor === DEFENSE_TYPES[type].class) {
                            defense.attackRadius = entityParams.attack_radius;
                            defense.attackRate = entityParams.attack_rate_ms;
                            defense.attackDamage = entityParams.attack_damage;
                            defense.hp = entityParams.hp;
                            defense.maxHp = entityParams.max_hp;
                        }
                    });
                }
            });
            
            // If costs or names changed, update the menu
            if (costsChanged || namesChanged) {
                const menuBar = document.getElementById('menuBar');
                if (menuBar) {
                    // Remove all existing menu items
                    menuBar.innerHTML = '';
                    // Recreate menu items with new costs and names
                    createMenuItems();
                }
                updateMoneyDisplay(); // Update UI to reflect new costs
            }
        }
    } catch (error) {
        console.error('Error updating game parameters:', error);
    }
}

// Function to initialize game parameters
async function initializeGameParameters() {
    await updateGameParameters();
    if (!gameParameters) {
        console.error('Failed to load game parameters');
        return;
    }
    
    // Apply initial parameters
    SPRITE_SCALE = gameParameters.display.sprite_scale;
    FRAME_DURATION = gameParameters.animation.frame_duration_ms;
    MOVE_INTERVAL = gameParameters.animation.move_interval_ms;
    
    // Initialize wave parameters
    SPIDERS_PER_WAVE = gameParameters.waves.spiders_per_wave;
    SPIDER_SPAWN_DELAY = gameParameters.waves.spawn_delay_ms;
    WAVE_DELAY = gameParameters.waves.wave_delay_ms;
    
    // Update UI to reflect new money value
    updateMoneyDisplay();
}

// Function to initialize the game
async function initializeGame() {
    try {
        // Load waypoints first
        await loadWaypoints();
        console.log('Waypoints loaded:', waypoints.length);
        
        // Generate interpolated waypoints
        generateInterpolatedWaypoints(20);
        console.log('Interpolated waypoints generated:', interpolatedWaypoints.length);
        
        // Initialize game parameters - do this after waypoints are ready
        await initializeGameParameters();
        
        // Calculate the tower position based on parameter percentage
        const towerIndex = Math.floor(interpolatedWaypoints.length * gameParameters.map.tower_position_percentage);
        const towerWaypoint = interpolatedWaypoints[towerIndex];
        
        // Create the main tower at the calculated position with properties from parameters
        mainTower = createTower(towerWaypoint, { 
            hp: gameParameters.main_tower.hp,
            anchorY: gameParameters.main_tower.anchor_y
        });
        console.log('Main tower created at position:', towerWaypoint);
        
        // Handle initial resize after everything is loaded
        handleResize();
        
        // Initialize UI after resize
        setTimeout(() => {
            initializeUI();
            
            // Add mouse event listeners
            canvas.addEventListener('mousemove', handleMouseMove);
            canvas.addEventListener('click', handleMouseClick);
            
            // Draw static elements (map and main tower)
            drawStaticElements();
            
            // Start the first wave
            startWave();
            console.log('First wave started');
            
            // Start the game loop
            requestAnimationFrame(gameLoop);
            console.log('Game loop started');
        }, 200);
        
        // Add resize event listener with debounce
        let resizeTimeout;
        window.addEventListener('resize', function() {
            clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(handleResize, 100);
        });
    } catch (error) {
        console.error('Error initializing game:', error);
    }
}

// Modify game loop to update parameters
function gameLoop(timestamp) {
    try {
        // Update game parameters periodically
        if (timestamp - lastParameterUpdate >= PARAMETER_UPDATE_INTERVAL) {
            updateGameParameters();
            lastParameterUpdate = timestamp;
        }

        // Clear the main canvas
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Draw the static elements from the background canvas
        ctx.drawImage(backgroundCanvas, 0, 0);
        
        // Draw the preview entity if it exists
        if (gameState.previewEntity) {
            gameState.previewEntity.draw();
        }
        
        // Spawn spiders for current wave
        spawnWaveSpiders(timestamp);
        
        // Update and draw all spiders
        activeSpiders.forEach(spider => {
            spider.update(timestamp);
            spider.draw();
        });

        // Update and draw all defense entities
        activeDefenses.forEach(defense => {
            defense.update(timestamp);
            defense.draw();
        });

        // Update and draw particles
        particles = particles.filter(particle => {
            particle.update();
            particle.draw();
            return particle.life > 0;
        });
        
        // Request the next frame
        requestAnimationFrame(gameLoop);
    } catch (error) {
        console.error('Error in game loop:', error);
    }
}

// Function to draw sprites (to be used later)
function drawSprite(sprite, x, y) {
    ctx.drawImage(sprite, x, y);
}