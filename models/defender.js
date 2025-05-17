import * as PIXI from 'pixi.js';
import HealthBarDisplay from '../healthBar.js'; // <-- ADD IMPORT

export default class DefenceEntity {
    constructor(id, definition, position, pixiTextures, gameInstance) {
        if (!gameInstance) {
             throw new Error("DefenceEntity requires a valid Game instance.");
        }
        this.id = id; // e.g., 'laser_tower'
        this.definition = definition; // The raw data from defences.json
        this.game = gameInstance; // <-- STORE game instance
        this.x = position.x;
        this.y = position.y;
        this.target = null; // Current enemy target
        this.lastAttackTime = 0;
        this.gridCol = null; // <-- ADDED: Storage for Z-buffer grid column
        this.gridRow = null; // <-- ADDED: Storage for Z-buffer grid row

        // Stats
        this.attackRange = definition.stats.attackRange;
        this.attackRate = definition.stats.attackRate; // ms between attacks
        this.attackStrength = definition.stats.attackStrength;
        
        // --- Wear properties --- UPDATED to use HP
        this.wearEnabled = definition.stats.wearEnabled ?? false;
        this.maxHp = this.wearEnabled ? (definition.stats.maxHp ?? 1) : 1; // Get calculated maxHp
        this.hp = this.maxHp; // Initialize current HP
        this.wearDecrement = this.wearEnabled ? (definition.stats.wearDecrement ?? 0) : 0; // Get calculated decrement
        this.isDestroyed = false;
        // --- End Wear properties ---
        
        this.healthBarDisplay = null; // <-- Initialize healthBarDisplay

        // --- PixiJS Sprite Setup --- 
        this.pixiContainer = new PIXI.Container();
        this.pixiSprite = null;
        this.allSpriteFrames = pixiTextures || []; // Store all frames
        this.framesPerRow = definition.sprite?.framesPerRow || 1; // Store for texture index calculations

        this.isAttacking = false;
        this.currentFrame = 0; // Current animation frame index within a direction row (0 for idle)
        this.directionRowIndex = 2; // Default to facing down (row 2 of spritesheet)
        this.frameTimeAccumulator = 0; // Accumulator for animation timing

        if (this.allSpriteFrames.length > 0) {
            // Calculate initial texture index: frame 0 of the default direction row
            const initialTextureIndex = (this.directionRowIndex * this.framesPerRow) + 0;
            if (initialTextureIndex < this.allSpriteFrames.length) {
                this.pixiSprite = new PIXI.Sprite(this.allSpriteFrames[initialTextureIndex]);

                const anchorX = definition.display?.anchorX ?? 0.5;
                const anchorY = definition.display?.anchorY ?? 0.5;
                this.pixiSprite.anchor.set(anchorX, anchorY);

                const scale = definition.display?.scale ?? 1;
                this.pixiSprite.scale.set(scale);

                this.pixiContainer.addChild(this.pixiSprite);
            } else {
                console.warn(`Defender ${this.id}: Initial texture index out of bounds. Sprite not created.`);
            }
        } else {
            console.warn(`Defender ${this.id}: No sprite frames provided. Sprite not created.`);
        }
        
        this.pixiContainer.x = this.x;
        this.pixiContainer.y = this.y;
        // --- End PixiJS Sprite Setup ---
        
        // --- HealthBarDisplay Initialization ---
        if (this.pixiSprite && this.game) { // Ensure pixiSprite and game are available
            this.healthBarDisplay = new HealthBarDisplay(this.pixiContainer, this.pixiSprite, this.game);
        } else {
            // console.warn(`Defender ${this.id}: Could not initialize HealthBarDisplay. Missing pixiSprite or game instance.`);
            // this.healthBarDisplay remains null if conditions aren't met
        }
        // --- End HealthBarDisplay Initialization ---

        // --- Generalized Effects Setup --- 
        this.effects = definition.effects; // Store the whole effects object (or undefined)
        this.puddles = []; // Array for splash effects like puddles {x, y, createdAt, duration, radius, speedFactor}
        this.effectRadius = this.effects?.radius; // Optional chaining
        this.effectDuration = this.effects?.duration;
        this.effectSpeedFactor = this.effects?.speedFactor;
        // --- End Effects Setup --- 
        
        // --- Display Properties --- 
        // this.displayScale = definition.display?.scale // REMOVE
        // this.displayAnchorX = definition.display?.anchorX // REMOVE
        // this.displayAnchorY = definition.display?.anchorY // REMOVE
        // this.frameTimeAccumulator = 0; // Moved to PixiJS Sprite Setup section
        // --- End Display Properties ---
    }

    // --- ADDED: hit(damageAmount) method ---
    /**
     * Applies damage to the defender, updates its health, and flags it as destroyed if HP reaches zero.
     * @param {number} damageAmount - The amount of damage to apply.
     * @returns {number} The actual amount of damage taken, capped by current health.
     */
    hit(damageAmount) {
        if (this.isDestroyed) {
            return 0; // Cannot damage a destroyed entity
        }

        const actualDamageTaken = Math.min(damageAmount, this.hp);
        this.hp -= actualDamageTaken;
        this.hp = Math.max(0, this.hp); // Ensure HP doesn't go negative

        if (this.hp <= 0) {
            this.isDestroyed = true;
        }

        return actualDamageTaken;
    }
    // --- END ADDED ---

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
        if (this.effects && this.effectRadius !== undefined && this.effectDuration !== undefined && this.effectSpeedFactor !== undefined && this.game && this.game.app) {
            const puddleMetadata = {
                x: enemyPos.x,
                y: enemyPos.y,
                createdAt: timestamp,
                duration: this.effectDuration, // from this.effects.duration set in constructor/applyUpdate
                radius: this.effectRadius,   // from this.effects.radius
                speedFactor: this.effectSpeedFactor, // from this.effects.speedFactor
                color: this.effects.color || 'rgba(0, 255, 255, 0.3)' // from this.effects.color or default
            };

            const graphics = new PIXI.Graphics();
            const pixiColor = new PIXI.Color(puddleMetadata.color);
            
            graphics.circle(0, 0, puddleMetadata.radius);
            graphics.fill({ color: pixiColor.toNumber(), alpha: pixiColor.alpha });
            graphics.x = puddleMetadata.x;
            graphics.y = puddleMetadata.y;
            
            this.game.puddleLayer.addChild(graphics); // MODIFIED: Add to puddleLayer
            
            this.puddles.push({
                metadata: puddleMetadata,
                graphics: graphics
            });
        }
        
        // Apply direct damage if applicable
        if (this.attackStrength > 0) {
            // --- ADDED: Calculate and apply SCALED damage --- 
            const targetEnemy = this.target; // Get the target
            if (targetEnemy && typeof targetEnemy.healthScaleFactor === 'number') {
                // Calculate scaled damage using the enemy's own scale factor
                const scaledAttackDamage = this.attackStrength * targetEnemy.healthScaleFactor;
                // Call hit with the correctly scaled damage value
                targetEnemy.hit(scaledAttackDamage);
            } else {
                // Log a warning if target or scale factor is missing (shouldn't happen if target is valid)
                console.warn(`Defender ${this.id}: Could not apply damage. Target invalid or missing healthScaleFactor.`);
            }
            // --- END ADDED --- 

            // --- Deplete Wear (HP) --- 
            if (this.wearEnabled && this.wearDecrement > 0) {
                this.hit(this.wearDecrement); // Call the new hit method for wear
            }
            // --- End Deplete Wear ---
        }
        return true;
    }

    update(timestamp, deltaTime, enemies) {
        // --- Check for Wear Destruction --- 
        // REMOVED: if (this.wearEnabled && this.remainingHits <= 0 && !this.isDestroyed) {
        // REMOVED: if (this.wearEnabled && this.hp <= 0 && !this.isDestroyed) { // Check HP instead of hits
        // REMOVED:     this.isDestroyed = true;
        // REMOVED:     //console.log(`Defender ${this.id} worn out!`); // Optional log
        // REMOVED:     // TODO: Trigger removal logic? (Handled by Manager filter for now)
        // REMOVED:     return; // Stop further updates if destroyed by wear
        // REMOVED: }
        // REMOVED: }
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
        // Ensure we have a sprite and frames to work with
        if (this.pixiSprite && this.allSpriteFrames && this.allSpriteFrames.length > 0) {
            const frameDuration = this.definition.sprite?.frameDuration || 100; // Default if not defined
            const framesInAttackAnimation = this.framesPerRow; // Total frames in one direction row

            if (this.isAttacking) {
                this.frameTimeAccumulator += deltaTime;

                while (this.frameTimeAccumulator >= frameDuration) {
                    this.frameTimeAccumulator -= frameDuration;
                    this.currentFrame++; // Advance frame

                    // Frame 0 is idle, frames 1 to framesPerRow-1 are attack frames for the current direction.
                    if (this.currentFrame >= framesInAttackAnimation) {
                        // Attack animation finished, revert to idle frame of the current direction
                        this.isAttacking = false;
                        this.currentFrame = 0; 
                        this.frameTimeAccumulator = 0;
                        break; // Exit loop, animation for this attack is done
                    }
                }
            } else {
                // Not attacking, ensure we are on the idle frame (frame 0 of current direction)
                this.currentFrame = 0;
                this.frameTimeAccumulator = 0; // Reset accumulator when not attacking
            }

            // Calculate the texture index for the current direction and frame
            let textureIndex = (this.directionRowIndex * this.framesPerRow) + this.currentFrame;
            
            // Ensure textureIndex is within bounds
            if (textureIndex >= 0 && textureIndex < this.allSpriteFrames.length) {
                this.pixiSprite.texture = this.allSpriteFrames[textureIndex];
            } else {
                // Fallback or error logging if index is out of bounds
                // console.warn(`Defender ${this.id}: Texture index ${textureIndex} out of bounds. Max: ${this.allSpriteFrames.length - 1}`);
                // Optionally, set to a default texture or the first frame
                if (this.allSpriteFrames.length > 0) {
                    this.pixiSprite.texture = this.allSpriteFrames[0]; 
                }
            }
        } else {
            // Not attacking, ensure we are on the idle frame
            // This case is if pixiSprite or allSpriteFrames are missing, already handled by the outer if
        }
        // --- End Animation Update --- 

        // Update HealthBarDisplay
        if (this.healthBarDisplay) {
            this.healthBarDisplay.update(this.hp, this.maxHp);
        }

        // Update zIndex for y-sorting
        if (this.pixiContainer && this.pixiSprite) {
            const effectiveY = this.pixiContainer.y + this.pixiSprite.height * (1 - this.pixiSprite.anchor.y);
            this.pixiContainer.zIndex = effectiveY;
        }
        
        // Reset speed modifier for all potentially affected enemies before checking puddles.
        enemies.forEach(enemy => {
            if (!enemy.isDead && enemy.speedModifier !== 1.0) { // Only reset if currently slowed and alive
                enemy.resetSpeedModifier();
            }
        });

        // Puddle lifecycle management and enemy effect application
        if (this.effects) { 
            this.puddles = this.puddles.filter(puddle => {
                const alive = timestamp - puddle.metadata.createdAt < puddle.metadata.duration;
                if (!alive) {
                    if (this.game && this.game.puddleLayer) { // MODIFIED: Check for puddleLayer
                        this.game.puddleLayer.removeChild(puddle.graphics); // MODIFIED: Remove from puddleLayer
                    }
                    puddle.graphics.destroy();
                    return false;
                }
                // Apply slow effect to enemies in range of this puddle
                enemies.forEach(enemy => {
                    if (!enemy.isDead && 
                        enemy.isInRange(puddle.metadata, puddle.metadata.radius)) {
                        enemy.setSlow(puddle.metadata.speedFactor); 
                    }
                });
                return true;
            });
        }
        
        // TODO: Add other update logic (animations, health regen, etc.)
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
            if (!this.allSpriteFrames.length > 0 || this.allSpriteFrames[0].texture.baseTexture.resource.source.src !== updatedDef.sprite.path) {
                this.allSpriteFrames = updatedDef.sprite.frames.map(frame => new PIXI.Sprite(frame));
                // TODO: Add error handling for image loading
            }
            // Update the rest of the sprite definition
            this.pixiSprite = this.allSpriteFrames[this.directionRowIndex * this.framesPerRow + this.currentFrame];
            if (this.pixiSprite) {
                const anchorX = updatedDef.display?.anchorX ?? 0.5;
                const anchorY = updatedDef.display?.anchorY ?? 0.5;
                this.pixiSprite.anchor.set(anchorX, anchorY);

                const scale = updatedDef.display?.scale ?? 1;
                this.pixiSprite.scale.set(scale);
            } else {
                console.warn(`Defender ${this.id}: No sprite frames provided. Sprite not updated.`);
            }
        } else {
            // Handle case where sprite info might be removed
            this.allSpriteFrames = [];
            this.pixiSprite = null;
        }

        if (updatedDef.display) {
            // this.displayScale = updatedDef.display.scale ?? this.displayScale; // REMOVE
            // this.displayAnchorX = updatedDef.display.anchorX ?? this.displayAnchorX; // REMOVE
            // this.displayAnchorY = updatedDef.display.anchorY ?? this.displayAnchorY; // REMOVE
        } else {
             // Handle case where display info might be removed
             // Reset to defaults or keep existing? Decide based on desired behavior.
             // Keeping existing for now:
             // // this.displayScale = 1.0; // REMOVE (already commented)
             // // this.displayAnchorX = 0.5; // REMOVE (already commented)
             // // this.displayAnchorY = 0.5; // REMOVE (already commented)
        }
        // --- End Sprite and Display Update ---

        // Update the stored definition reference if needed
        this.definition = { ...this.definition, ...updatedDef }; 
    }

    destroyPixiObjects() {
        if (this.pixiSprite) {
            this.pixiSprite.destroy();
            this.pixiSprite = null;
        }
        if (this.pixiContainer) {
            this.pixiContainer.destroy({ children: true }); 
            this.pixiContainer = null;
        }
        if (this.healthBarDisplay) {
            this.healthBarDisplay.destroy();
            this.healthBarDisplay = null;
        }
        // Puddles are not destroyed with the defender; they expire on their own schedule.
        // The Defender.update() method handles puddle expiration and graphics cleanup.
        // this.puddles array on the defender instance can be cleared if the defender is destroyed,
        // but the actual puddle graphics objects persist in game.puddleLayer until they time out.
        this.puddles = []; // Clear the defender's reference to its puddles
    }
} 