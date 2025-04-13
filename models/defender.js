export default class DefenceEntity {
    constructor(id, definition, position) {
        this.id = id; // e.g., 'laser_tower'
        this.definition = definition; // The raw data from defences.json
        this.x = position.x;
        this.y = position.y;
        this.target = null; // Current enemy target
        this.lastAttackTime = 0;

        // Stats
        this.hp = definition.stats.hp;
        this.maxHp = definition.stats.hp;
        this.attackRange = definition.stats.attackRange;
        this.attackRate = definition.stats.attackRate; // ms between attacks
        this.attackStrength = definition.stats.attackStrength;
        
        // --- Generalized Effects Setup --- 
        this.effects = definition.effects; // Store the whole effects object (or undefined)
        this.puddles = []; // Array for splash effects like puddles {x, y, createdAt, duration, radius, speedFactor}
        this.effectRadius = this.effects?.radius; // Optional chaining
        this.effectDuration = this.effects?.duration;
        this.effectSpeedFactor = this.effects?.speedFactor;
        // --- End Effects Setup --- 
        
        console.log(`DefenceEntity created: ${this.id} at (${this.x}, ${this.y})`);
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
        // console.log(`Target for ${this.id}: ${this.target ? this.target.id : 'None'}`);
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
            console.log(`${this.id} created splash effect near ${this.target.id}`);
        }
        
        // Apply direct damage if applicable
        if (this.attackStrength > 0) {
            this.target.hit(this.attackStrength);
            console.log(`${this.id} attacked ${this.target.id} for ${this.attackStrength} damage.`);
        }
        // --- End attack types --- 

        return true;
    }

    update(timestamp, deltaTime, enemies) {
        // 1. Find a target if we don't have one (or current one is dead)
        if (!this.target || this.target.isDead) {
            this.findTarget(enemies);
        }

        // 2. Try to attack the target
        this.attack(timestamp);
        
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
        // Simple red square representation for now
        ctx.save();
        // Color based on whether it has effects or direct damage
        ctx.fillStyle = (this.effects && this.effectSpeedFactor !== undefined) ? 'cyan' : (this.attackStrength > 0 ? 'red' : 'grey');
        const size = 30; // Adjust size as needed
        ctx.fillRect(this.x - size / 2, this.y - size / 2, size, size);        
        ctx.restore();
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
        // Update stats (handle HP carefully)
        const hpRatio = this.maxHp > 0 ? this.hp / this.maxHp : 1; // Preserve health percentage
        this.hp = Math.max(1, Math.round((updatedDef.stats.hp || this.maxHp) * hpRatio)); // Apply ratio to new max HP
        this.maxHp = updatedDef.stats.hp || this.maxHp;
        
        this.attackRange = updatedDef.stats.attackRange ?? this.attackRange;
        this.attackRate = updatedDef.stats.attackRate ?? this.attackRate;
        this.attackStrength = updatedDef.stats.attackStrength ?? this.attackStrength;
        
        // --- Update effects object and properties --- 
        this.effects = updatedDef.effects; // Overwrite the whole effects object
        this.effectRadius = this.effects?.radius; 
        this.effectDuration = this.effects?.duration;
        this.effectSpeedFactor = this.effects?.speedFactor;
        // --- End effects update --- 
        
        // Update the stored definition reference if needed
        this.definition = { ...this.definition, ...updatedDef }; 
        
        // console.log(`DefenceEntity ${this.id} updated.`);
    }
} 