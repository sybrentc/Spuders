import { distanceBetween } from '../utils/geometryUtils.js';

export default class Striker {
    /**
     * Represents a single bomb strike event, handling its damage application.
     * @param {object} impactCoords - The {x, y} coordinates of the bomb's impact.
     * @param {number} bombStrengthA - The strength factor (A) of the bomb.
     * @param {Game} gameRef - A reference to the main Game instance.
     */
    constructor(impactCoords, bombStrengthA, gameRef) {
        if (!impactCoords || typeof impactCoords.x !== 'number' || typeof impactCoords.y !== 'number') {
            console.error("Striker constructor: Invalid impactCoords provided.", impactCoords);
            // Potentially throw an error or set a flag indicating an invalid state
            this.valid = false;
            return;
        }
        if (typeof bombStrengthA !== 'number' || bombStrengthA <= 0) {
            console.error("Striker constructor: Invalid bombStrengthA provided.", bombStrengthA);
            this.valid = false;
            return;
        }
        if (!gameRef) {
            console.error("Striker constructor: Invalid gameRef provided.");
            this.valid = false;
            return;
        }

        this.impactCoords = impactCoords;
        this.bombStrengthA = bombStrengthA;
        this.gameRef = gameRef;
        this.valid = true; // Mark as valid if all checks pass

        // For future animation/lifecycle, not used in this step
        // this.isFinished = false; 
    }

    /**
     * Applies bomb damage to defenders and, if real, to enemies.
     * @param {boolean} isRealStrike - True if this is a real bomb, false if a simulation.
     * @param {Array<DefenceEntity>} [optionalClonedDefenders=null] - For simulation, a list of cloned defenders.
     * @returns {number} The total Delta R (damage dealt to defenders).
     */
    applyExplosionDamage(isRealStrike, optionalClonedDefenders = null) {
        if (!this.valid) {
            console.error("Striker.applyExplosionDamage: Striker instance is not valid. Aborting damage application.");
            return 0;
        }

        let totalDeltaRFromDefenders = 0;
        const MIN_EFFECTIVE_DISTANCE = 1.0; // Prevent division by zero/extreme damage

        let defendersToProcess;
        if (isRealStrike) {
            if (!this.gameRef.defenceManager) {
                console.error("Striker.applyExplosionDamage: DefenceManager not found on gameRef for real strike.");
                return 0;
            }
            defendersToProcess = this.gameRef.defenceManager.getActiveDefences();
        } else {
            if (!optionalClonedDefenders || !Array.isArray(optionalClonedDefenders)) {
                console.error("Striker.applyExplosionDamage: Invalid or missing optionalClonedDefenders for simulated strike.");
                return 0;
            }
            defendersToProcess = optionalClonedDefenders;
        }

        // Process Defenders
        if (defendersToProcess && Array.isArray(defendersToProcess)) {
            for (const defender of defendersToProcess) {
                if (defender.isDestroyed) {
                    continue;
                }
                const dist = distanceBetween({ x: defender.x, y: defender.y }, this.impactCoords);
                const effectiveDistance = Math.max(dist, MIN_EFFECTIVE_DISTANCE);
                const potentialDamage = this.bombStrengthA / (effectiveDistance * effectiveDistance);

                if (potentialDamage > 0) {
                    const damageTaken = defender.hit(potentialDamage);
                    totalDeltaRFromDefenders += damageTaken;
                }
            }
        }

        // Process Enemies (Collateral Damage for Real Strikes)
        if (isRealStrike) {
            if (!this.gameRef.enemyManager) {
                console.error("Striker.applyExplosionDamage: EnemyManager not found on gameRef for real strike.");
                // Continue with defender damage, but log error for enemies
            } else {
                const enemiesToProcess = this.gameRef.enemyManager.getActiveEnemies();
                if (enemiesToProcess && Array.isArray(enemiesToProcess)) {
                    for (const enemy of enemiesToProcess) {
                        if (enemy.isDead) {
                            continue;
                        }
                        const enemyPos = enemy.getCurrentPosition ? enemy.getCurrentPosition() : { x: enemy.x, y: enemy.y };
                        if (!enemyPos || typeof enemyPos.x !== 'number' || typeof enemyPos.y !== 'number') {
                            console.warn("Striker.applyExplosionDamage: Could not determine valid position for an enemy. Skipping it.", enemy);
                            continue;
                        }
                        const dist = distanceBetween(enemyPos, this.impactCoords);
                        const effectiveDistance = Math.max(dist, MIN_EFFECTIVE_DISTANCE);
                        const potentialDamage = this.bombStrengthA / (effectiveDistance * effectiveDistance);

                        if (potentialDamage > 0) {
                            enemy.hit(potentialDamage);
                        }
                    }
                }
            }
        }
        return totalDeltaRFromDefenders;
    }
} 