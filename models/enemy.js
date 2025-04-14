import { drawHealthBar } from '../utils/renderUtils.js'; // Import the utility function

export default class Enemy {
    constructor({
        id, name, waypoints, sprite, startIndex = 0, // startIndex for original path, we'll adjust based on extension
        frameWidth, frameHeight, framesPerRow, totalFrames, frameDuration,
        scale, anchorX, anchorY,
        hp, speed, attackRate, attackStrength, attackRange, bounty,
        flashDuration,
        base // Add base dependency
    }) {
        // Identification
        this.id = id;
        this.name = name;
        this.base = base; // Store base reference
        
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
        this.anchorX = anchorX;
        this.anchorY = anchorY;
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
        this.speedModifier = 1.0; // Add speed modifier, 1.0 = normal speed
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
    
    update(timestamp, deltaTime, base) {
        if (this.isDead) return;
        
        // Update flash effect
        if (this.isFlashing && timestamp - this.lastFlashTime >= this.flashDuration) {
            this.isFlashing = false;
        }

        // --- Debugging Base Attack Logic ---
        const baseExists = !!base;
        const baseDestroyed = baseExists ? base.isDestroyed() : 'N/A';
        let distanceToBase = Infinity;
        let baseCoords = { x: 'N/A', y: 'N/A' };
        if (baseExists && !baseDestroyed) {
            const dxBase = base.x - this.x;
            const dyBase = base.y - this.y;
            distanceToBase = Math.sqrt(dxBase * dxBase + dyBase * dyBase);
            baseCoords = { x: base.x, y: base.y };
        }
        const isInRange = distanceToBase <= this.attackRange;
        // --- End Debugging ---

        // Check distance to base and determine if attacking
        if (distanceToBase <= this.attackRange && base && !base.isDestroyed()) {
            this.isAttacking = true; // Stop moving
            // Check if enough time has passed to attack again
            if (timestamp - this.lastAttackTime >= this.attackRate) {
                console.log(`Enemy ${this.id} attacking base!`); // Debug log
                base.takeDamage(this.attackStrength);
                this.lastAttackTime = timestamp;
            }
        } else {
            this.isAttacking = false; // Resume moving if base is destroyed or out of range
            // If we were just attacking, reset attack timer so we don't attack immediately upon re-entering range
            // Although, maybe we want that? Let's keep it simple for now.
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
            
            // Calculate distance to move this frame (use speedModifier)
            const currentSpeed = this.speed * this.speedModifier;
            const moveDistance = currentSpeed * (deltaTime / 1000); // Convert ms to seconds
            
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
        // TODO: Handle attacking specific towers if implemented later
    }
    
    // New method to apply updates from fetched definitions
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

        this.speed = updatedDef.stats?.speed; 
        this.attackRate = updatedDef.stats?.attackRate;
        this.attackStrength = updatedDef.stats?.attackStrength;
        this.attackRange = updatedDef.stats?.attackRange;
        this.bounty = updatedDef.stats?.bounty;

        // Update effects directly
        this.flashDuration = updatedDef.effects?.flashDuration;
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
        if (this.isDead) return; // Prevent dying multiple times
        this.isDead = true;
        console.log(`${this.name} (${this.id}) died.`);
        // Award bounty to the base
        if (this.base && this.bounty > 0) {
            this.base.addFunds(this.bounty);
        }
        // TODO: Add death animation/effect trigger here
    }
    
    getCurrentPosition() {
        // Simply return the current x, y coordinates
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
        //console.log(this.scale);
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
}
