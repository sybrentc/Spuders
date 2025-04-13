export default class Enemy {
    constructor({
        id, name, waypoints, sprite, startIndex = 0, // startIndex for original path, we'll adjust based on extension
        frameWidth, frameHeight, framesPerRow, totalFrames, frameDuration, scale,
        hp, speed, attackRate, attackStrength, attackRange, bounty,
        flashDuration
    }) {
        // Identification
        this.id = id;
        this.name = name;
        
        // --- Waypoint Extension Logic ---
        const extendedWaypoints = this._extendWaypoints(
            waypoints,
            frameWidth,
            frameHeight,
            scale
        );
        this.waypoints = extendedWaypoints; // Use the extended path

        // Adjust starting position and target based on the *extended* path
        // Enemy starts at the newly added first waypoint (index 0)
        this.x = this.waypoints[0].x;
        this.y = this.waypoints[0].y;
        // The first target is the original starting waypoint (now index 1)
        this.targetWaypointIndex = 1;

        // ---------------------------------
        
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
        this.speed = speed; // Speed in pixels per second
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
    
    // Helper function to calculate the extended waypoint path
    _extendWaypoints(originalWaypoints, frameWidth, frameHeight, scale) {
        // Need at least 2 waypoints to determine direction
        if (!originalWaypoints || originalWaypoints.length < 2) {
            console.warn(`Enemy ${this.id}: Cannot extend path with less than 2 waypoints.`);
            return originalWaypoints; // Return original if extension isn't possible
        }

        // Calculate the diagonal size of the scaled sprite
        const spriteDiagonal = Math.sqrt(frameWidth * frameWidth + frameHeight * frameHeight) * scale;

        // --- Calculate Spawn Point ---
        const p0 = originalWaypoints[0]; // First original waypoint
        const p1 = originalWaypoints[1]; // Second original waypoint

        let normStartX = 0;
        let normStartY = 0;
        const dxStart = p1.x - p0.x;
        const dyStart = p1.y - p0.y;
        const distStart = Math.sqrt(dxStart * dxStart + dyStart * dyStart);

        // Calculate normalized vector from p0 to p1
        if (distStart > 0.001) { // Avoid division by zero
            normStartX = dxStart / distStart;
            normStartY = dyStart / distStart;
        }

        // Calculate spawn point by moving backwards from p0 along the normal vector
        const spawnPoint = {
            x: p0.x - normStartX * spriteDiagonal,
            y: p0.y - normStartY * spriteDiagonal
        };

        // --- Calculate Despawn Point ---
        const pn = originalWaypoints[originalWaypoints.length - 1]; // Last original waypoint
        const pn_1 = originalWaypoints[originalWaypoints.length - 2]; // Penultimate original waypoint

        let normEndX = 0;
        let normEndY = 0;
        const dxEnd = pn.x - pn_1.x;
        const dyEnd = pn.y - pn_1.y;
        const distEnd = Math.sqrt(dxEnd * dxEnd + dyEnd * dyEnd);

        // Calculate normalized vector from pn_1 to pn
        if (distEnd > 0.001) { // Avoid division by zero
            normEndX = dxEnd / distEnd;
            normEndY = dyEnd / distEnd;
        }

        // Calculate despawn point by moving forwards from pn along the normal vector
        const despawnPoint = {
            x: pn.x + normEndX * spriteDiagonal,
            y: pn.y + normEndY * spriteDiagonal
        };

        // Return the new array with added points
        return [spawnPoint, ...originalWaypoints, despawnPoint];
    }
    
    update(timestamp, deltaTime) {
        if (this.isDead) return;
        
        // Update flash effect
        if (this.isFlashing && timestamp - this.lastFlashTime >= this.flashDuration) {
            this.isFlashing = false;
        }
        
        // Move along path if not attacking and not past the final waypoint
        // Check against waypoints.length because targetWaypointIndex can reach length after the last move
        if (!this.isAttacking && this.targetWaypointIndex < this.waypoints.length) {
            // 1) Read current spider x,y coordinates (this.x, this.y)
            
            // 2) Read the spider's current target waypoint
            const target = this.waypoints[this.targetWaypointIndex];
            
            // Calculate vector from current position to target
            const dx = target.x - this.x;
            const dy = target.y - this.y;
            
            // Calculate distance to target
            const distance = Math.sqrt(dx * dx + dy * dy);
            
            // Calculate distance to move this frame
            const moveDistance = this.speed * (deltaTime / 1000); // Convert ms to seconds
            
            // Check if we have reached or passed the target waypoint
            if (distance <= moveDistance || distance < 0.1) { // Check if close enough or will pass it
                // Snap position to the target waypoint
                this.x = target.x;
                this.y = target.y;
                // Advance to the next waypoint index
                this.targetWaypointIndex++;
                // Note: This simple version doesn't handle overshooting precisely within the same frame.
            } else {
                // 3) Calculate a normal vector (unit vector)
                const normX = dx / distance;
                const normY = dy / distance;
                
                // 4) Multiply the normal vector by speed and time delta for displacement
                const deltaX = normX * moveDistance;
                const deltaY = normY * moveDistance;
                
                // 5) Update spider position coordinates
                this.x += deltaX;
                this.y += deltaY;
            }
        }
        
        // Update animation
        if (timestamp - this.lastFrameTime >= this.frameDuration) {
            this.currentFrame = (this.currentFrame + 1) % this.totalFrames;
            this.lastFrameTime = timestamp;
        }
        
        // Handle tower attacks (to be implemented with tower system)
    }
    
    // New method to apply updates from fetched definitions
    applyUpdate(updatedDef) {
        // Update basic info
        this.name = updatedDef.name;

        // Update animation properties
        // Note: We don't update frameWidth/Height here as it could affect existing sprite logic
        // If sprite sheets change format dynamically, more complex logic would be needed.
        this.framesPerRow = updatedDef.sprite.framesPerRow;
        this.totalFrames = updatedDef.sprite.totalFrames;
        this.frameDuration = updatedDef.sprite.frameDuration;
        this.scale = updatedDef.sprite.scale;

        // Update stats
        // Handle HP update carefully: maybe scale current HP based on maxHP change?
        // For simplicity, just updating maxHp and letting current HP stay unless it exceeds new max.
        const hpRatio = this.hp / this.maxHp; // Keep track of current health percentage
        this.maxHp = updatedDef.stats.hp;
        this.hp = Math.min(this.hp, this.maxHp); // Ensure current HP doesn't exceed new max

        this.speed = updatedDef.stats.speed; // This updates the speed in units per second
        this.attackRate = updatedDef.stats.attackRate;
        this.attackStrength = updatedDef.stats.attackStrength;
        this.attackRange = updatedDef.stats.attackRange;
        this.bounty = updatedDef.stats.bounty;

        // Update effects
        this.flashDuration = updatedDef.effects.flashDuration;
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
        
        // Current position is now stored directly in this.x, this.y
        const currentPoint = { x: this.x, y: this.y };
        
        // Calculate the current frame position in the sprite sheet
        const frameX = (this.currentFrame % this.framesPerRow) * this.frameWidth;
        const frameY = Math.floor(this.currentFrame / this.framesPerRow) * this.frameHeight;
        
        // Save the current context state
        ctx.save();
        
        // Move canvas origin to the enemy's position for easier drawing
        ctx.translate(currentPoint.x, currentPoint.y);
        
        // Apply flash effect if needed
        if (this.isFlashing) {
            // Draw the normal enemy sprite
            ctx.drawImage(
                this.sprite,
                frameX, frameY, this.frameWidth, this.frameHeight,
                -this.frameWidth * this.scale / 2, -this.frameHeight * this.scale / 2, // Center the sprite
                this.frameWidth * this.scale, this.frameHeight * this.scale
            );
             // Apply a white tint overlay
             ctx.globalCompositeOperation = 'source-atop';
             ctx.fillStyle = 'rgba(255, 255, 255, 0.7)'; // White with 70% opacity
             ctx.fillRect(
                 -this.frameWidth * this.scale / 2, -this.frameHeight * this.scale / 2,
                 this.frameWidth * this.scale, this.frameHeight * this.scale
             );

        } else {
            // Draw the normal enemy sprite centered at (0,0) relative to the translated origin
            ctx.drawImage(
                this.sprite,
                frameX, frameY, this.frameWidth, this.frameHeight,
                -this.frameWidth * this.scale / 2, -this.frameHeight * this.scale / 2, // Center the sprite
                this.frameWidth * this.scale, this.frameHeight * this.scale
            );
        }
        
        // Draw health bar above the sprite
        const healthBarWidth = 30;
        const healthBarHeight = 4;
        const healthPercentage = Math.max(0, this.hp / this.maxHp);
        const healthBarOffsetY = -this.frameHeight * this.scale / 2 - 10; // Position above centered sprite
        
        // Background of health bar
        ctx.fillStyle = 'red';
        ctx.fillRect(
            -healthBarWidth / 2, // Center the health bar
            healthBarOffsetY,
            healthBarWidth,
            healthBarHeight
        );
        
        // Current health
        ctx.fillStyle = 'green';
        ctx.fillRect(
            -healthBarWidth / 2, // Center the health bar
            healthBarOffsetY,
            healthBarWidth * healthPercentage,
            healthBarHeight
        );
        
        // Restore the context state (resets translation, composite operation, etc.)
        ctx.restore();
    }
}
