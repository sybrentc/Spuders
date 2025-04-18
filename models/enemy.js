import { drawHealthBar } from '../utils/renderUtils.js'; // Import the utility function

export default class Enemy {
    constructor({
        id, name, extendedPath, sprite, 
        frameWidth, frameHeight, framesPerRow, totalFrames, frameDuration,
        scale, anchorX, anchorY,
        hp, speed, attackRate, attackStrength, attackRange,
        flashDuration,
        base
    }) {
        // Identification
        this.id = id;
        this.name = name;
        // Ensure base is provided, needed for bounty calculation
        if (!base) {
             throw new Error(`Enemy ${id} requires a valid Base instance.`);
        }
        this.base = base;
        
        // --- Path Setup --- 
        if (!extendedPath || extendedPath.length < 2) {
            console.error(`Enemy ${this.id}: Received invalid extended path. Cannot initialize position or movement.`);
            // Set defaults to prevent errors, but enemy won't move
            this.waypoints = [];
            this.x = 0;
            this.y = 0;
            this.targetWaypointIndex = Infinity; // Prevent movement updates
        } else {
            this.waypoints = extendedPath; // Use the received extended path
            // Enemy starts at the first waypoint of the extended path (index 0)
            this.x = this.waypoints[0].x;
            this.y = this.waypoints[0].y;
            // The first target is the second waypoint of the extended path (index 1)
            this.targetWaypointIndex = 1; 
        }
        // --- End Path Setup ---
        
        // Sprite and animation
        this.sprite = sprite;
        this.frameWidth = frameWidth;
        this.frameHeight = frameHeight;
        this.framesPerRow = framesPerRow;
        this.totalFrames = totalFrames;
        this.frameDuration = frameDuration;
        this.scale = scale;
        this.anchorX = anchorX;
        this.anchorY = anchorY;
        this.currentFrame = 0;
        this.lastFrameTime = 0;
        
        // Stats
        this.hp = hp;
        this.maxHp = hp;
        this.speed = speed;
        this.attackRate = attackRate;
        this.attackStrength = attackStrength;
        this.attackRange = attackRange;
        
        // State
        this.isDead = false;
        this.isFlashing = false;
        this.flashDuration = flashDuration;
        this.lastFlashTime = 0;
        this.isAttacking = false;
        this.targetTower = null;
        this.lastAttackTime = 0;
        this.speedModifier = 1.0;
    }
    
    update(timestamp, deltaTime, base) {
        if (this.isDead) return;
        
        // Update flash effect
        if (this.isFlashing && timestamp - this.lastFlashTime >= this.flashDuration) {
            this.isFlashing = false;
        }

        // --- Base Attack Logic --- 
        let distanceToBase = Infinity;
        if (base && !base.isDestroyed()) {
            const dxBase = base.x - this.x;
            const dyBase = base.y - this.y;
            distanceToBase = Math.sqrt(dxBase * dxBase + dyBase * dyBase);
        }
        if (distanceToBase <= this.attackRange && base && !base.isDestroyed()) {
            this.isAttacking = true; 
            if (timestamp - this.lastAttackTime >= this.attackRate) {
                base.takeDamage(this.attackStrength);
                this.lastAttackTime = timestamp;
            }
        } else {
            this.isAttacking = false; 
        }
        // --- End Base Attack ---
        
        // Move along path if not attacking and not past the final waypoint
        // Uses this.waypoints which is now the extended path
        if (!this.isAttacking && this.targetWaypointIndex < this.waypoints.length) {
            const target = this.waypoints[this.targetWaypointIndex];
            const dx = target.x - this.x;
            const dy = target.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const currentSpeed = this.speed * this.speedModifier;
            const moveDistance = currentSpeed * (deltaTime / 1000); 
            
            if (distance <= moveDistance || distance < 0.1) {
                this.x = target.x;
                this.y = target.y;
                this.targetWaypointIndex++;
            } else {
                const normX = dx / distance;
                const normY = dy / distance;
                this.x += normX * moveDistance;
                this.y += normY * moveDistance;
            }
        }
        
        // Update animation
        if (timestamp - this.lastFrameTime >= this.frameDuration) {
            this.currentFrame = (this.currentFrame + 1) % this.totalFrames;
            this.lastFrameTime = timestamp;
        }
    }
    
    applyUpdate(updatedDef) {
        // Update basic info
        this.name = updatedDef.name; // Assume name always exists in update

        // Update animation properties
        // Note: We don't update frameWidth/Height here as it could affect existing sprite logic
        // Remove defaults, assume properties exist in updatedDef
        this.framesPerRow = updatedDef.sprite?.framesPerRow;
        this.totalFrames = updatedDef.sprite?.totalFrames;
        this.frameDuration = updatedDef.sprite?.frameDuration;
        
        // Read scale and anchors directly from the display object
        this.scale = updatedDef.display?.scale; 
        this.anchorX = updatedDef.display?.anchorX;
        this.anchorY = updatedDef.display?.anchorY;

        // Update stats directly
        const hpRatio = this.hp / this.maxHp; // Keep track of current health percentage
        this.maxHp = updatedDef.stats?.hp; 
        // Need to handle potential undefined maxHp before Math.min
        if (this.maxHp !== undefined) { 
             this.hp = Math.min(this.hp, this.maxHp); // Ensure current HP doesn't exceed new max
        } else {
            console.warn(`Enemy ${this.id} applyUpdate: maxHp became undefined from tuning data.`);
            // Decide fallback: keep old maxHp? Set hp to 0? For now, log warning.
            // Resetting maxHp to a previous value might be safest if available.
        }

        this.speed = updatedDef.stats?.speed ?? this.speed; // Use nullish coalescing for safety
        this.attackRate = updatedDef.stats?.attackRate ?? this.attackRate;
        this.attackStrength = updatedDef.stats?.attackStrength ?? this.attackStrength;
        this.attackRange = updatedDef.stats?.attackRange ?? this.attackRange;

        // Update effects directly
        this.flashDuration = updatedDef.effects?.flashDuration ?? this.flashDuration;
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
        // Simplified: Just set the flag. Bounty awarded by EnemyManager.
        if (this.isDead) return; 
        this.isDead = true;
        // Get bounty dynamically
        const calculatedBounty = this.getBounty(); 
        if (this.base && calculatedBounty > 0) {
            this.base.addFunds(calculatedBounty);
        }
    }
    
    getCurrentPosition() {
        return { x: this.x, y: this.y };
    }
    
    render(ctx) {
        if (this.isDead) return;
        
        // Calculate source frame from spritesheet
        const frameX = (this.currentFrame % this.framesPerRow) * this.frameWidth;
        const frameY = Math.floor(this.currentFrame / this.framesPerRow) * this.frameHeight;
        
        // Calculate destination position and size using anchors
        const drawWidth = this.frameWidth * this.scale;
        const drawHeight = this.frameHeight * this.scale;
        const drawX = this.x - drawWidth * this.anchorX; // Use anchorX
        const drawY = this.y - drawHeight * this.anchorY; // Use anchorY
        ctx.save();
        
        // Apply flash effect if active using temporary canvas
        if (this.isFlashing) {
            // --- Use Temporary Canvas for Flash Effect --- 
            // 1. Create offscreen canvas
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = drawWidth; // Use calculated scaled dimensions
            tempCanvas.height = drawHeight;
            const tempCtx = tempCanvas.getContext('2d');
            if (!tempCtx) {
                console.error("Failed to get temporary canvas context for flash effect.");
                ctx.restore();
                return; // Cannot perform flash effect
            }

            // 2. Draw current sprite frame onto temp canvas
            tempCtx.drawImage(
                this.sprite,
                frameX, frameY, this.frameWidth, this.frameHeight,
                0, 0, // Draw at top-left corner of temp canvas
                drawWidth, drawHeight
            );

            // 3. Apply flash effect ONLY on temp canvas using 'source-in'
            tempCtx.globalCompositeOperation = 'source-in'; 
            tempCtx.fillStyle = 'white'; // Pure white
            tempCtx.fillRect(0, 0, drawWidth, drawHeight);
            // No need to reset composite op on tempCtx

            // 4. Draw the result (whitened sprite) onto the main canvas
            ctx.drawImage(
                tempCanvas, 
                drawX, drawY // Draw at the calculated final position
            );
            // --- End Temporary Canvas Logic --- 
        } else {
            // Draw the normal enemy sprite frame if not flashing
            ctx.drawImage(
                this.sprite,         // The spritesheet image
                frameX,              // Source X from spritesheet
                frameY,              // Source Y from spritesheet
                this.frameWidth,     // Source Width
                this.frameHeight,    // Source Height
                drawX,               // Destination X on canvas
                drawY,               // Destination Y on canvas
                drawWidth,           // Destination Width
                drawHeight           // Destination Height
            );
        }
        
        ctx.restore(); // Restore context state (e.g., transformations, composite operations if any)
        
        // --- Draw Health Bar using utility function --- 
        drawHealthBar(ctx, this.hp, this.maxHp, drawX, drawY, drawWidth, drawHeight);
    }

    /**
     * Calculates the bounty for this enemy based on its current stats and global factor.
     * Rounds the result to the nearest 5.
     * @returns {number} The calculated bounty value.
     */
    getBounty() {
        const alpha = this.base?.stats?.bountyFactor ?? 0; // Default to 0 if base or factor missing
        const currentHp = this.hp ?? 0; // Use current HP for bounty calculation? Or maxHp? Let's use maxHp as difficulty measure
        const currentSpeed = this.speed ?? 0;
        
        if (this.maxHp <= 0 || currentSpeed <= 0 || alpha <= 0) {
             return 0; // No bounty for invalid stats or factor
        }

        const rawBounty = alpha * this.maxHp * currentSpeed;
        const roundedBounty = Math.max(0, Math.round(rawBounty / 5) * 5); // Ensure non-negative
        return roundedBounty;
    }
}
