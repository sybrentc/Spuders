import * as PIXI from 'pixi.js'; // Import PIXI
import HealthBarDisplay from '../healthBar.js'; // <-- ADD IMPORT

export default class Enemy {
    constructor({
        id, name, extendedPath, sprite, sharedHitSprite,
        frameWidth, frameHeight, framesPerRow, totalFrames, frameDuration,
        scale, anchorX, anchorY,
        hp, // This will be the SCALED max HP
        bounty, // This is the pre-calculated bounty
        healthScaleFactor, // The factor used for scaling
        speed, attackRate, attackStrength, attackRange,
        flashDuration, // This is the hit flash duration in MS
        base,
        pixiTextures, // Add pixiTextures to destructured parameters
        hitTextures, // Add hitTextures for the flash effect
        game // <-- ADD game TO DESTRUCTURED PARAMETERS
    }) {
        // Identification
        this.id = id;
        this.name = name;
        this.game = game; // <-- STORE THE GAME INSTANCE
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
        this.sharedHitSprite = sharedHitSprite;
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
        this.hp = hp;             // Initial HP is the scaled max HP
        this.maxHp = hp;          // Max HP is also the scaled max HP
        this.healthScaleFactor = healthScaleFactor; // Store the scale factor
        this.bounty = bounty;      // Store the pre-calculated bounty
        this.speed = speed;
        this.attackRate = attackRate;
        this.attackStrength = attackStrength;
        this.attackRange = attackRange;
        
        // State
        this.isDead = false;
        this.isTakingDamageFlashing = false; // Renamed from isFlashing
        this.flashDurationMs = flashDuration; // Renamed from flashDuration and stores the MS for texture flash
        this.lastDamageFlashTime = 0; // Renamed from lastFlashTime

        // Properties for hit flash effect (texture swapping)
        this.hitAnimationFrames = hitTextures; // Store the textures for the hit flash
        this.isHitFlashing = false;            // Is the enemy currently in "hit flash" (texture swapped) state?
        this.hitFlashTimer = 0;                // Countdown timer for the hit flash duration

        this.healthBarDisplay = null; // <-- INITIALIZE HEALTH BAR DISPLAY

        this.isAttacking = false;
        this.targetTower = null;
        this.lastAttackTime = 0;
        this.speedModifier = 1.0;
        this.frameTimeAccumulator = 0; // Accumulator for animation timing

        // PixiJS specific properties
        this.pixiContainer = new PIXI.Container();
        this.pixiSprite = null; 
        this.pixiContainer.x = this.x; // Set initial position from logical x
        this.pixiContainer.y = this.y; // Set initial position from logical y

        // --- Setup PixiJS AnimatedSprite if pixiTextures are provided ---
        if (pixiTextures && Array.isArray(pixiTextures) && pixiTextures.length > 0) {
            this.normalAnimationFrames = pixiTextures; // Store for reverting after hit flash
            this.pixiSprite = new PIXI.AnimatedSprite(this.normalAnimationFrames);
            
            // Configure the sprite (using existing properties from constructor where applicable)
            this.pixiSprite.anchor.set(this.anchorX || 0.5, this.anchorY || 0.5); // Use existing anchors, default to 0.5 if not defined
            this.pixiSprite.scale.set(this.scale || 1); // Use existing scale, default to 1 if not defined
            // TODO: Make animationSpeed configurable, e.g., from enemyDef.sprite.frameDuration or a new property in enemies.json
            // For now, derive a basic animation speed from frameDuration. Assuming frameDuration is in ms.
            // A common pattern: animationSpeed = 1 / (frameDuration_in_seconds * frames_per_second_of_game_ticker)
            // If ticker is 60fps, and frameDuration is 100ms (0.1s), then 1 / (0.1 * 60) = 1/6 = ~0.16. 
            // Pixi's animationSpeed is a multiplier; 1.0 means 1 frame per ticker update.
            // If frameDuration is the time one frame should be displayed, then we want X frames to play in Y seconds.
            // Let's aim for the animation to complete its cycle based on totalFrames and frameDuration.
            // If this.frameDuration is per frame, and totalFrames is N, total animation duration is N * this.frameDuration.
            // Pixi's animationSpeed means it advances 'animationSpeed' frames per game tick.
            // If game runs at 60FPS (approx 16.67ms per tick), and this.frameDuration is, say, 100ms.
            // We want one animation frame to last 100ms / 16.67ms_per_tick = ~6 ticks.
            // So, animationSpeed should be 1/6.
            if (this.frameDuration && this.frameDuration > 0) {
                 // Assuming 60 FPS for the ticker. (1000ms / 60fps = 16.66ms per tick)
                const ticksPerFrame = this.frameDuration / (1000 / 60); 
                this.pixiSprite.animationSpeed = ticksPerFrame > 0 ? 1 / ticksPerFrame : 0.1;
            } else {
                this.pixiSprite.animationSpeed = 0.1; // Fallback if frameDuration is not available
            }

            this.pixiSprite.play();
            
            this.pixiContainer.addChild(this.pixiSprite);

            // --- Initialize HealthBarDisplay ---
            if (this.pixiSprite && this.game) { 
                this.healthBarDisplay = new HealthBarDisplay(this.pixiContainer, this.pixiSprite, this.game);
            } else {
                this.healthBarDisplay = null; // Ensure it's null if conditions aren't met
                console.warn(`Enemy ${this.id}: Could not initialize HealthBarDisplay. Missing pixiSprite or game instance.`);
            }
            // --- End HealthBarDisplay Initialization ---
        }
        // --- End PixiJS AnimatedSprite Setup ---
    }
    
    update(timestamp, deltaTime, base) {
        if (this.isDead) return;
        
        // Update generic flash effect (renamed, not texture swap)
        if (this.isTakingDamageFlashing && timestamp - this.lastDamageFlashTime >= this.flashDurationMs) {
            this.isTakingDamageFlashing = false;
        }

        // Update Hit Flash Effect (Texture Swapping)
        if (this.isHitFlashing) {
            this.hitFlashTimer -= deltaTime;
            if (this.hitFlashTimer <= 0) {
                this.isHitFlashing = false;
                this.hitFlashTimer = 0;
                // Revert to normal textures if sprite and normal frames are available
                if (this.pixiSprite && this.normalAnimationFrames) {
                    // Only revert if currently showing hit frames
                    if (this.pixiSprite.textures === this.hitAnimationFrames) {
                        const currentFrameIndex = this.pixiSprite.currentFrame;
                        this.pixiSprite.textures = this.normalAnimationFrames;
                        this.pixiSprite.gotoAndPlay(currentFrameIndex);
                    }
                }
            }
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
        // Uses effectiveDeltaTime via deltaTime parameter
        this.frameTimeAccumulator += deltaTime; 
        if (this.frameTimeAccumulator >= this.frameDuration) {
            this.currentFrame = (this.currentFrame + 1) % this.totalFrames;
            this.frameTimeAccumulator -= this.frameDuration; // Subtract duration, don't reset to 0
            // If frameTimeAccumulator is still >= frameDuration (e.g., large deltaTime), 
            // the loop will run again in the next frame, which is usually fine.
            // Or handle multiple frame skips in a loop here if needed for very low frame rates.
        }

        // --- Update PixiJS container position ---
        if (this.pixiContainer) {
            this.pixiContainer.x = this.x;
            this.pixiContainer.y = this.y;
        }
        // --- End Update PixiJS container position ---

        // --- Update HealthBarDisplay ---
        if (this.healthBarDisplay) {
            this.healthBarDisplay.update(this.hp, this.maxHp);
        }
        // --- End Update HealthBarDisplay ---
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
        // --- REMOVED HP/MaxHP update - These are set at creation via scaling ---
        this.speed = updatedDef.stats?.speed ?? this.speed; // Use nullish coalescing for safety
        this.attackRate = updatedDef.stats?.attackRate ?? this.attackRate;
        this.attackStrength = updatedDef.stats?.attackStrength ?? this.attackStrength;
        this.attackRange = updatedDef.stats?.attackRange ?? this.attackRange;

        // Update effects directly - flashDurationMs is now set at construction for hit flash
        // If there was another type of flash configured by "effects", that would be separate.
        // For now, assuming updatedDef.effects.flashDuration was for the generic flash.
        // If it was intended for the hit flash, it's now handled.
        // this.flashDuration = updatedDef.effects?.flashDuration ?? this.flashDuration;
    }
    
    hit(damage) {
        if (this.isDead) return;
        this.hp -= damage; // Subtract damage directly (already in correct units)
        
        // Existing generic flash logic (can be reviewed/removed later if redundant)
        this.isTakingDamageFlashing = true; 
        this.lastDamageFlashTime = performance.now(); 

        // New Hit Flash Logic (Texture Swapping)
        if (this.pixiSprite && this.hitAnimationFrames && this.normalAnimationFrames && this.flashDurationMs > 0) {
            this.isHitFlashing = true;
            this.hitFlashTimer = this.flashDurationMs;

            // Check if currently displaying normal frames before swapping to hit frames
            // This prevents issues if hit() is called multiple times rapidly during a flash
            if (this.pixiSprite.textures === this.normalAnimationFrames) {
                const currentFrameIndex = this.pixiSprite.currentFrame;
                this.pixiSprite.textures = this.hitAnimationFrames;
                this.pixiSprite.gotoAndPlay(currentFrameIndex);
            }
        }

        if (this.hp <= 0) {
            this.hp = 0; // Ensure hp doesn't go negative visually
            this.die();
        }
    }
    
    die() {
        // Simplified: Just set the flag. Bounty awarded by EnemyManager.
        if (this.isDead) return; 
        this.isDead = true;
        // Get bounty dynamically
        if (this.base && this.bounty > 0) { // Use stored bounty
            this.base.addFunds(this.bounty);
            // --- ADDED: Record bounty for StrikeManager (Plan III) ---
            if (this.game && this.game.strikeManager && typeof this.game.strikeManager.recordBountyEarned === 'function') {
                this.game.strikeManager.recordBountyEarned(this.bounty);
            } else {
                // console.warn(`Enemy ${this.id}: Could not record bounty for StrikeManager. strikeManager or recordBountyEarned method missing.`);
            }
            // --- END ADDED ---
        }
    }
    
    getCurrentPosition() {
        return { x: this.x, y: this.y };
    }
    
    destroyPixiObjects() {
        if (this.healthBarDisplay) { // <-- ADD DESTROY CALL FOR HEALTH BAR
            this.healthBarDisplay.destroy();
            this.healthBarDisplay = null;
        }
        if (this.pixiSprite) {
            this.pixiSprite.destroy();
            this.pixiSprite = null;
        }
        if (this.pixiContainer) {
            // Passing { children: true } ensures all children (like the sprite if not already destroyed) are also destroyed.
            this.pixiContainer.destroy({ children: true }); 
            this.pixiContainer = null;
        }
    }
}
