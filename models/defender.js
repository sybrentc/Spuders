import { drawHealthBar } from '../utils/renderUtils.js'; // Import the utility function

export default class DefenceEntity {
    constructor(id, definition, position, spriteDefinition) {
        this.id = id; // e.g., 'laser_tower'
        this.definition = definition; // The raw data from defences.json
        this.x = position.x;
        this.y = position.y;
        this.target = null; // Current enemy target
        this.lastAttackTime = 0;

        // Stats
        this.attackRange = definition.stats.attackRange;
        this.attackRate = definition.stats.attackRate; // ms between attacks
        this.attackStrength = definition.stats.attackStrength;
        
        // --- Wear properties --- UPDATED to use HP
        this.wearEnabled = definition.stats.wearEnabled ?? false;
        // REMOVED: this.totalHitsK = this.wearEnabled ? (definition.stats.totalHitsK ?? 1) : 1;
        // REMOVED: this.remainingHits = this.totalHitsK;
        this.maxHp = this.wearEnabled ? (definition.stats.maxHp ?? 1) : 1; // Get calculated maxHp
        this.hp = this.maxHp; // Initialize current HP
        this.wearDecrement = this.wearEnabled ? (definition.stats.wearDecrement ?? 0) : 0; // Get calculated decrement
        this.isDestroyed = false;
        // --- End Wear properties ---
        
        // --- Sprite and Animation Setup --- 
        this.spriteDefinition = spriteDefinition;
        this.spriteImage = null;
        this.isAttacking = false;
        this.currentFrame = 0;
        this.lastFrameChangeTime = 0;

        this.directionRowIndex = 2; // Default to facing down (row 2)

        if (this.spriteDefinition) {
            this.spriteImage = new Image();
            this.spriteImage.src = this.spriteDefinition.path;
            // TODO: Add error handling for image loading
        }
        // --- End Sprite Setup ---
        
        // --- Generalized Effects Setup --- 
        this.effects = definition.effects; // Store the whole effects object (or undefined)
        this.puddles = []; // Array for splash effects like puddles {x, y, createdAt, duration, radius, speedFactor}
        this.effectRadius = this.effects?.radius; // Optional chaining
        this.effectDuration = this.effects?.duration;
        this.effectSpeedFactor = this.effects?.speedFactor;
        // --- End Effects Setup --- 
        
        // --- Display Properties --- 
        this.displayScale = definition.display?.scale
        this.displayAnchorX = definition.display?.anchorX
        this.displayAnchorY = definition.display?.anchorY
        // --- End Display Properties ---
    }

    findTarget(enemies) {
        // Basic target finding: closest enemy in range
        let closestEnemy = null;
        let minDistance = this.attackRange;

        for (const enemy of enemies) {
            if (enemy.isDead) continue;
            
            const enemyPos = enemy.getCurrentPosition(); // Assumes enemy has this method
            if (!enemyPos) continue;

            const dx = enemyPos.x - this.x;
            const dy = enemyPos.y - this.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance <= this.attackRange && distance < minDistance) {
                minDistance = distance;
                closestEnemy = enemy;
            }
        }
        this.target = closestEnemy;
    }

    attack(timestamp) {
        if (!this.target || this.target.isDead) {
            this.target = null; // Clear dead target
            return false;
        }
        
        // Check attack cooldown
        if (timestamp - this.lastAttackTime < this.attackRate) {
            return false;
        }

        // Check range again (enemy might have moved out)
        const enemyPos = this.target.getCurrentPosition();
        if (!enemyPos) return false;
        const dx = enemyPos.x - this.x;
        const dy = enemyPos.y - this.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        if (distance > this.attackRange) {
             this.target = null; // Target moved out of range
             return false;
        }
        
        this.lastAttackTime = timestamp;
        this.isAttacking = true; // Start animation
        this.lastFrameChangeTime = timestamp; // Reset animation timer
        this.currentFrame = 1; // Start from the second frame for attack animation
        
        // --- Handle attack types based on properties --- 
        // Check if this defence creates a splash/puddle effect (has necessary effect props)
        if (this.effects) {
            // Create a puddle at the target's position
            this.puddles.push({
                x: enemyPos.x,
                y: enemyPos.y,
                createdAt: timestamp,
                duration: this.effectDuration,
                radius: this.effectRadius,
                speedFactor: this.effectSpeedFactor
            });
        }
        
        // Apply direct damage if applicable
        if (this.attackStrength > 0) {
            this.target.hit(this.attackStrength);
            // --- Deplete Wear (HP) --- 
            if (this.wearEnabled && this.wearDecrement > 0) {
                // REMOVED: this.remainingHits--;
                this.hp -= this.wearDecrement;
            }
            // --- End Deplete Wear ---
        }
        return true;
    }

    update(timestamp, deltaTime, enemies) {
        // --- Check for Wear Destruction --- 
        // if (this.wearEnabled && this.remainingHits <= 0 && !this.isDestroyed) {
        if (this.wearEnabled && this.hp <= 0 && !this.isDestroyed) { // Check HP instead of hits
            this.isDestroyed = true;
            //console.log(`Defender ${this.id} worn out!`); // Optional log
            // TODO: Trigger removal logic? (Handled by Manager filter for now)
            return; // Stop further updates if destroyed by wear
        }
        // --- End Check ---

        // 1. Find a target if we don't have one (or current one is dead)
        if (!this.target || this.target.isDead) {
            this.findTarget(enemies);
        }

        // --- Direction Update --- 
        if (this.target && !this.target.isDead) {
            const targetPos = this.target.getCurrentPosition();
            if (targetPos) {
                const dx = targetPos.x - this.x;
                const dy = targetPos.y - this.y; // Y increases downwards
                
                // Calculate angle using atan2(y, x)
                const angle = Math.atan2(dy, dx);

                // Map angle to row index (0:Up, 1:Right, 2:Down, 3:Left)
                // Angle ranges based on atan2 output (-PI to PI)
                if (angle > -3 * Math.PI / 4 && angle <= -Math.PI / 4) {
                    this.directionRowIndex = 0; // Up (-Y direction)
                } else if (angle > -Math.PI / 4 && angle <= Math.PI / 4) {
                    this.directionRowIndex = 1; // Right (+X direction)
                } else if (angle > Math.PI / 4 && angle <= 3 * Math.PI / 4) {
                    this.directionRowIndex = 2; // Down (+Y direction)
                } else { // Covers angle > 3*PI/4 or angle <= -3*PI/4
                    this.directionRowIndex = 3; // Left (-X direction)
                }
            }
        } else {
            // Optional: If no target, default to a direction (e.g., down)
            // this.directionRowIndex = 2; // Already defaulted in constructor
        }
        // --- End Direction Update ---

        // 2. Try to attack the target
        this.attack(timestamp);
        
        // --- Animation Update --- 
        if (this.isAttacking && this.spriteDefinition) {
            const frameDuration = this.spriteDefinition.frameDuration;
            const framesInRow = this.spriteDefinition.framesPerRow;
            // Assuming frame 0 is idle and frames 1 to N-1 are the attack animation
            const lastAttackFrameIndex = framesInRow - 1; 

            if (timestamp - this.lastFrameChangeTime > frameDuration) {
                 // Check if we are still within the attack animation frames (1 to lastAttackFrameIndex)
                 if (this.currentFrame < lastAttackFrameIndex) {
                    this.currentFrame++; // Advance to the next frame
                    this.lastFrameChangeTime = timestamp;
                 } else {
                    // Animation cycle finished
                    this.isAttacking = false;
                    this.currentFrame = 0; // Reset to idle frame (frame 0)
                 }
            }
        } else {
            // Not attacking, ensure we are on the idle frame
            this.currentFrame = 0;
        }
        // --- End Animation Update ---

        // 3. Update Effects (Puddles/Slow)
        // Check if this entity manages puddles (has effect properties)
        if (this.effects) {
            // Remove expired puddles
            this.puddles = this.puddles.filter(puddle => 
                timestamp - puddle.createdAt < puddle.duration
            );

            // Apply slow effect to enemies
            enemies.forEach(enemy => {
                if (enemy.isDead) return;
                
                let slowed = false;
                const enemyPos = enemy.getCurrentPosition();
                if (!enemyPos) return;

                for (const puddle of this.puddles) {
                    const dx = enemyPos.x - puddle.x;
                    const dy = enemyPos.y - puddle.y;
                    const distance = Math.sqrt(dx * dx + dy * dy);
                    
                    // Use puddle's stored speedFactor
                    if (distance < puddle.radius) {
                        enemy.speedModifier = puddle.speedFactor;
                        slowed = true;
                        break; // Only apply one puddle effect
                    }
                }
                // Reset speed if not slowed by any puddle this frame
                if (!slowed) {
                    enemy.speedModifier = 1.0; 
                }
            });
        }
        
        // TODO: Add other update logic (animations, health regen, etc.)
    }

    render(ctx) {
        // Draw sprite if available
        if (this.spriteImage && this.spriteImage.complete && this.spriteDefinition) {
            const { frameWidth, frameHeight, framesPerRow } = this.spriteDefinition;

            // --- Calculate Source Frame --- 
            const row = this.directionRowIndex; // Use the calculated direction row
            const col = this.currentFrame; // Use the calculated frame

            const sourceX = col * frameWidth;
            const sourceY = row * frameHeight;
            // --- End Source Frame Calculation --- 

            // --- Calculate Destination Size and Position --- 
            const destWidth = frameWidth * this.displayScale;
            const destHeight = frameHeight * this.displayScale;
            // Adjust position based on anchor point
            const drawX = this.x - (destWidth * this.displayAnchorX);
            const drawY = this.y - (destHeight * this.displayAnchorY);
            // --- End Destination Calculation --- 

            ctx.save();
            ctx.drawImage(
                this.spriteImage, 
                sourceX, sourceY,           // Source x, y (top-left corner of frame)
                frameWidth, frameHeight,    // Source width, height (size of frame)
                drawX, drawY,               // Destination x, y (where to draw on canvas)
                destWidth, destHeight       // Destination width, height (how big to draw it)
            );

            // --- Draw Wear/Durability Bar --- 
            if (this.wearEnabled) {
                // Reuse the existing health bar logic, treating remaining hits as 'current health'
                // REMOVED: drawHealthBar(ctx, this.remainingHits, this.totalHitsK, drawX, drawY, destWidth, destHeight);
                drawHealthBar(ctx, this.hp, this.maxHp, drawX, drawY, destWidth, destHeight); // Use hp and maxHp
            }
            // --- End Draw Wear Bar ---

            ctx.restore();
        } else {
            // Fallback rendering if sprite isn't loaded/defined
            ctx.save();
            ctx.fillStyle = (this.effects && this.effectSpeedFactor !== undefined) ? 'cyan' : (this.attackStrength > 0 ? 'red' : 'grey');
            const size = 30;
            ctx.fillRect(this.x - size / 2, this.y - size / 2, size, size);
            ctx.restore();
        }
    }

    // Renders effects (like puddles) - called separately to draw under enemies
    renderEffects(ctx) {
        // Check if this entity creates puddles
        if (this.effects && this.effectRadius !== undefined && this.effectDuration !== undefined && this.effectSpeedFactor !== undefined) {
            ctx.save();
            ctx.fillStyle = 'rgba(0, 255, 255, 0.3)'; // Translucent cyan (generalize color later?)
            this.puddles.forEach(puddle => {
                ctx.beginPath();
                ctx.arc(puddle.x, puddle.y, puddle.radius, 0, Math.PI * 2);
                ctx.fill();
            });
            ctx.restore();
        }
    }

    // Method to apply updates from new definitions
    applyUpdate(updatedDef) {
        // Update stats 
        this.attackRange = updatedDef.stats.attackRange ?? this.attackRange;
        this.attackRate = updatedDef.stats.attackRate ?? this.attackRate;
        this.attackStrength = updatedDef.stats.attackStrength ?? this.attackStrength;
        
        // --- Update Wear/HP Properties --- 
        const wasEnabled = this.wearEnabled;
        this.wearEnabled = updatedDef.stats.wearEnabled ?? this.wearEnabled;
        
        if (this.wearEnabled) {
            // Preserve health percentage if wear remains enabled or becomes enabled
            const hpRatio = (this.maxHp > 0) ? (this.hp / this.maxHp) : (wasEnabled ? 0 : 1); // If just enabled, start full
            
            // Update maxHp and wearDecrement from the new definition
            this.maxHp = updatedDef.stats.maxHp ?? (wasEnabled ? this.maxHp : 1); // Use new value or keep old if wear was enabled
            this.wearDecrement = updatedDef.stats.wearDecrement ?? (wasEnabled ? this.wearDecrement : 0);
            
            // Apply the ratio to the potentially updated maxHp
            this.hp = this.maxHp * hpRatio;
            this.hp = Math.max(0, this.hp); // Ensure HP doesn't go negative

        } else {
            // Wear is disabled in the update
            this.maxHp = 1; // Reset HP values (or keep them? Setting to 1/0)
            this.hp = 1;
            this.wearDecrement = 0;
        }
        // Ensure hp doesn't exceed maxHp (could happen due to rounding or edge cases)
        this.hp = Math.min(this.hp, this.maxHp);
        // --- End Wear/HP Update --- 

        // --- Update effects object and properties --- 
        this.effects = updatedDef.effects; // Overwrite the whole effects object
        this.effectRadius = this.effects?.radius; 
        this.effectDuration = this.effects?.duration;
        this.effectSpeedFactor = this.effects?.speedFactor;
        // --- End effects update --- 
        
        // --- Update Sprite and Display ---
        if (updatedDef.sprite) {
            // Check if sprite path changed to reload image
            if (!this.spriteDefinition || this.spriteDefinition.path !== updatedDef.sprite.path) {
                this.spriteImage = new Image();
                this.spriteImage.src = updatedDef.sprite.path;
                // TODO: Add error handling for image loading
            }
            // Update the rest of the sprite definition
            this.spriteDefinition = { ...this.spriteDefinition, ...updatedDef.sprite }; 
        } else {
            // Handle case where sprite info might be removed
            this.spriteDefinition = undefined;
            this.spriteImage = null;
        }

        if (updatedDef.display) {
            this.displayScale = updatedDef.display.scale ?? this.displayScale;
            this.displayAnchorX = updatedDef.display.anchorX ?? this.displayAnchorX;
            this.displayAnchorY = updatedDef.display.anchorY ?? this.displayAnchorY;
        } else {
             // Handle case where display info might be removed
             // Reset to defaults or keep existing? Decide based on desired behavior.
             // Keeping existing for now:
             // this.displayScale = 1.0; 
             // this.displayAnchorX = 0.5;
             // this.displayAnchorY = 0.5;
        }
        // --- End Sprite and Display Update ---

        // Update the stored definition reference if needed
        this.definition = { ...this.definition, ...updatedDef }; 
    }
} 