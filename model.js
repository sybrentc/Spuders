// Utility functions
export function interpolate(p1, p2, t) {
    return {
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t
    };
}

// Particle class for death effects
export class Particle {
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

// Spider class definition
export class Spider {
    constructor(x, y, properties = {}) {
        this.x = x;
        this.y = y;
        this.health = properties.health || 100;
        this.maxHealth = this.health;
        this.speed = properties.speed || 1;
        this.attackStrength = properties.attackStrength || 10;
        this.attackCooldown = properties.attackCooldown || 1000;
        this.lastAttackTime = 0;
        this.sprite = properties.sprite || null;
        this.SPRITE_SCALE = properties.SPRITE_SCALE || 0.5;
        this.SPRITE_WIDTH = properties.SPRITE_WIDTH || 192;
        this.SPRITE_HEIGHT = properties.SPRITE_HEIGHT || 192;
        this.activeSpiders = properties.activeSpiders || [];
        this.particles = properties.particles || [];
        this.sounds = properties.sounds || {};
        this.isDead = false;
        this.waypoints = properties.waypoints || [];
        this.currentWaypointIndex = 0;
        this.reachedEnd = false;
        this.isFlashing = false;
        this.flashDuration = 200; // milliseconds
        this.lastFlashTime = 0;
        this.deathParticles = [];
        this.isAttacking = false;
        this.targetTower = null;
        this.attackRange = 50; // Same as tower's attack radius
        this.bounty = 5; // $5 bounty for killing this spider
        this.mainTower = properties.mainTower || null;
        this.lastMoveTime = properties.lastMoveTime || 0;
        this.MOVE_INTERVAL = properties.MOVE_INTERVAL || 16;
        
        // Animation parameters
        this.FRAME_DURATION = properties.FRAME_DURATION || 400;
        this.TOTAL_FRAMES = properties.TOTAL_FRAMES || 16;
        this.FRAMES_PER_ROW = properties.FRAMES_PER_ROW || 4;
    }

    hit(damage) {
        if (this.isDead) return;
        
        this.health -= damage;
        this.isFlashing = true;
        this.lastFlashTime = performance.now();

        // Play hit sound with pitch variation
        playSpiderHitSound();

        if (this.health <= 0) {
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
        if (!this.isAttacking && this.mainTower) {
            const spiderPos = this.getCurrentPosition();
            if (this.mainTower.isInRange(spiderPos.x, spiderPos.y)) {
                this.isAttacking = true;
                this.targetTower = this.mainTower;
            }
        }

        // If attacking, deal damage to tower
        if (this.isAttacking && this.targetTower && this.targetTower.canAttack(timestamp)) {
            this.targetTower.hit(this.attackStrength);
            this.targetTower.recordAttack(timestamp);
        }

        // Only move if not attacking
        if (!this.isAttacking && timestamp - this.lastMoveTime >= this.MOVE_INTERVAL) {
            if (this.currentWaypointIndex < this.waypoints.length - 1) {
                this.currentWaypointIndex += this.speed;
                if (this.currentWaypointIndex >= this.waypoints.length) {
                    this.currentWaypointIndex = this.waypoints.length - 1;
                }
            }
            this.lastMoveTime = timestamp;
        }

        // Update animation
        if (timestamp - this.lastFrameTime >= this.FRAME_DURATION) {
            this.currentFrame = (this.currentFrame + 1) % this.TOTAL_FRAMES;
            this.lastFrameTime = timestamp;
        }
    }

    draw() {
        if (this.isDead) return;

        const currentPoint = this.getCurrentPosition();
        if (!currentPoint) return;

        // Calculate the angle to the next point for rotation
        const nextIndex = Math.min(Math.floor(this.currentWaypointIndex) + 1, this.waypoints.length - 1);
        const nextPoint = this.waypoints[nextIndex];
        const angle = Math.atan2(nextPoint.y - currentPoint.y, nextPoint.x - currentPoint.x);

        // Calculate the current frame position in the sprite sheet
        const frameX = (this.currentFrame % this.FRAMES_PER_ROW) * this.SPRITE_WIDTH;
        const frameY = Math.floor(this.currentFrame / this.FRAMES_PER_ROW) * this.SPRITE_HEIGHT;

        // Save the current context state
        ctx.save();
        
        // Move to the spider's position
        ctx.translate(currentPoint.x, currentPoint.y);
        
        // Apply flash effect if needed
        if (this.isFlashing) {
            // Create a temporary canvas for the spider sprite
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = this.SPRITE_WIDTH * this.SPRITE_SCALE;
            tempCanvas.height = this.SPRITE_HEIGHT * this.SPRITE_SCALE;
            const tempCtx = tempCanvas.getContext('2d');
            
            // Draw the spider to the temporary canvas
            tempCtx.drawImage(
                this.sprite,
                frameX, frameY, this.SPRITE_WIDTH, this.SPRITE_HEIGHT,
                0, 0, this.SPRITE_WIDTH * this.SPRITE_SCALE, this.SPRITE_HEIGHT * this.SPRITE_SCALE
            );
            
            // Apply brightness filter
            tempCtx.filter = 'brightness(200%) contrast(200%)';
            tempCtx.drawImage(tempCanvas, 0, 0);
            
            // Draw the filtered spider
            ctx.drawImage(
                tempCanvas,
                -this.SPRITE_WIDTH*this.SPRITE_SCALE/2, -this.SPRITE_HEIGHT*this.SPRITE_SCALE/2, 
                this.SPRITE_WIDTH*this.SPRITE_SCALE, this.SPRITE_HEIGHT*this.SPRITE_SCALE
            );
        } else {
            // Draw the normal spider sprite
            ctx.drawImage(
                this.sprite,
                frameX, frameY, this.SPRITE_WIDTH, this.SPRITE_HEIGHT,
                -this.SPRITE_WIDTH*this.SPRITE_SCALE/2, -this.SPRITE_HEIGHT*this.SPRITE_SCALE/2, 
                this.SPRITE_WIDTH*this.SPRITE_SCALE, this.SPRITE_HEIGHT*this.SPRITE_SCALE
            );
        }
        
        // Draw health bar
        const healthBarWidth = 30;
        const healthBarHeight = 4;
        const healthPercentage = this.health / this.maxHealth;
        
        // Background of health bar
        ctx.fillStyle = 'red';
        ctx.fillRect(-healthBarWidth/2, -this.SPRITE_HEIGHT*this.SPRITE_SCALE/2 - 10, 
                    healthBarWidth, healthBarHeight);
        
        // Current health
        ctx.fillStyle = 'green';
        ctx.fillRect(-healthBarWidth/2, -this.SPRITE_HEIGHT*this.SPRITE_SCALE/2 - 10, 
                    healthBarWidth * healthPercentage, healthBarHeight);
        
        // Restore the context state
        ctx.restore();
    }

    getCurrentPosition() {
        const index = Math.floor(this.currentWaypointIndex);
        const nextIndex = Math.min(index + 1, this.waypoints.length - 1);
        const t = this.currentWaypointIndex - index;
        
        return interpolate(
            this.waypoints[index],
            this.waypoints[nextIndex],
            t
        );
    }
}

// Tower class definition
export class Tower {
    constructor(x, y, properties = {}) {
        this.x = x;
        this.y = y;
        this.health = properties.health || 1000;
        this.maxHealth = this.health;
        this.attackRadius = properties.attackRadius || 200;
        this.attackDamage = properties.attackDamage || 20;
        this.attackCooldown = properties.attackCooldown || 1000;
        this.lastAttackTime = 0;
        this.sprite = properties.sprite || null;
        this.SPRITE_SCALE = properties.SPRITE_SCALE || 0.5;
        this.SPRITE_WIDTH = properties.SPRITE_WIDTH || 192;
        this.SPRITE_HEIGHT = properties.SPRITE_HEIGHT || 192;
        this.activeSpiders = properties.activeSpiders || [];
        this.particles = properties.particles || [];
        this.sounds = properties.sounds || {};
        this.isDead = false;
        
        // Placement point configuration (0-1, where 0 is top, 1 is bottom)
        this.anchorY = properties.anchorY || 0.8; // Default to 80% down the sprite
        this.showDebug = properties.showDebug || false; // Show placement point indicator
    }

    getDamageStage() {
        const hpPercentage = this.health / this.maxHealth;
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
        return timestamp - this.lastAttackTime >= this.attackCooldown;
    }

    // Add method to record attack
    recordAttack(timestamp) {
        this.lastAttackTime = timestamp;
    }

    hit(damage) {
        if (this.isDead) return;
        
        this.health -= damage;
        
        // Play hit sound
        towerHitSound.currentTime = 0; // Reset sound to start
        towerHitSound.play().catch(error => {
            console.error('Error playing tower hit sound:', error);
        });
        
        if (this.health <= 0) {
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
        const scaledHeight = this.SPRITE_HEIGHT * this.SPRITE_SCALE;
        const offsetY = scaledHeight * this.anchorY;
        
        // Draw the tower sprite only if it's loaded
        if (this.sprite && this.sprite.complete && this.sprite.naturalWidth > 0) {
            context.drawImage(
                this.sprite,
                stage * this.SPRITE_WIDTH, 0, this.SPRITE_WIDTH, this.SPRITE_HEIGHT,
                this.x - (this.SPRITE_WIDTH * this.SPRITE_SCALE) / 2,
                this.y - offsetY, // Offset based on anchor point
                this.SPRITE_WIDTH * this.SPRITE_SCALE,
                this.SPRITE_HEIGHT * this.SPRITE_SCALE
            );
        } else {
            // Draw a placeholder if sprite isn't loaded yet
            context.fillStyle = 'gray';
            context.fillRect(
                this.x - (this.SPRITE_WIDTH * this.SPRITE_SCALE) / 2,
                this.y - offsetY,
                this.SPRITE_WIDTH * this.SPRITE_SCALE,
                this.SPRITE_HEIGHT * this.SPRITE_SCALE
            );
        }
        
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
        const healthPercentage = this.health / this.maxHealth;
        
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
export class DefenseEntity {
    constructor(x, y, properties = {}) {
        this.x = x;
        this.y = y;
        this.health = properties.health || 100;
        this.maxHealth = this.health;
        this.attackRadius = properties.attackRadius || 100;
        this.attackDamage = properties.attackDamage || 10;
        this.attackCooldown = properties.attackCooldown || 1000;
        this.lastAttackTime = 0;
        this.sprite = properties.sprite || null;
        this.SPRITE_SCALE = properties.SPRITE_SCALE || 0.5;
        this.SPRITE_WIDTH = properties.SPRITE_WIDTH || 192;
        this.SPRITE_HEIGHT = properties.SPRITE_HEIGHT || 192;
        this.activeSpiders = properties.activeSpiders || [];
        this.particles = properties.particles || [];
        this.sounds = properties.sounds || {};
        this.isDead = false;
    }

    canAttack(timestamp) {
        return timestamp - this.lastAttackTime >= this.attackCooldown;
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
export class LaserTower extends DefenseEntity {
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
export class AxolotlGunner extends DefenseEntity {
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
export class Tank extends DefenseEntity {
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
export class TurretTower extends DefenseEntity {
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
export class GlueTurret extends DefenseEntity {
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