import { distanceBetween } from '../utils/geometryUtils.js';
import * as PIXI from 'pixi.js'; // Import the PIXI library

const MIN_EFFECTIVE_DISTANCE = 1.0; // Moved to module scope for clarity, or could be static class member

export default class Striker {
    /**
     * Represents a single bomb strike event, handling its animation and damage application.
     * @param {object} gameInstance - The main Game object (e.g., for accessing PIXI layers, app).
     * @param {object} strikerShadow - Contains shadow texture and configuration for the shadow animation.
     * @param {object} bombPayload - Contains bomb properties (strength, explosion animation data, impact std dev).
     * @param {object} targetCoords - The intended {x, y} coordinates for the bomb's target.
     * @param {object} context - Either the main Game instance (for real strike) or an array of cloned defenders (for simulation).
     */
    constructor(gameInstance, strikerShadow, bombPayload, targetCoords, context) {
        this._isInitializedSuccessfully = false;
        this._damageDealtR = 0;
        this.completionPromise = null;

        // Store parameters
        this.gameInstance = gameInstance; 
        this.strikerShadow = strikerShadow; 
        this.bombPayload = bombPayload;
        this.targetCoords = targetCoords;
        this._spareNormal = null; // Initialize for _generateNormalRandom

        // --- Validate Core New Parameters ---
        if (!gameInstance || typeof gameInstance !== 'object') {
            console.error("Striker constructor: Invalid gameInstance provided.", gameInstance);
            return; // Initialization failed
        }
        // strikerShadow can be null or an object. If object, validate its structure if needed, or assume valid from StrikeManager.
        if (strikerShadow && typeof strikerShadow !== 'object') { 
            console.error("Striker constructor: Invalid strikerShadow provided (if not null, must be object).", strikerShadow);
            return; // Initialization failed
        }

        // --- Validate bombPayload (copied from previous correct version) ---
        if (!bombPayload ||
            typeof bombPayload.strengthA !== 'number' ||
            (bombPayload.strengthA < 0) || 
            !bombPayload.explosionAnimation || 
            typeof bombPayload.impactStdDevPixels !== 'number' || bombPayload.impactStdDevPixels < 0) {
            console.error("Striker constructor: Invalid bombPayload provided.", bombPayload);
            return; // Initialization failed
        }

        // --- Validate targetCoords (copied from previous correct version) ---
        if (!targetCoords || typeof targetCoords.x !== 'number' || typeof targetCoords.y !== 'number') {
            console.error("Striker constructor: Invalid targetCoords provided.", targetCoords);
            return; // Initialization failed
        }

        // --- Validate context and determine strike type (Original Logic based on 'context') ---
        if (!context) {
            console.error("Striker constructor: Invalid context (game or clonedDefenders) provided.");
            return; // Initialization failed
        }

        if (context.defenceManager && context.enemyManager) {
            this.isRealStrike = true;
            this.gameRef = context; // gameRef is the game instance FOR DAMAGE LOGIC
            this.optionalClonedDefenders = null;
        } else if (Array.isArray(context)) {
            this.isRealStrike = false;
            this.gameRef = null;
            this.optionalClonedDefenders = context; // context is cloned defenders FOR DAMAGE LOGIC
        } else {
            console.error("Striker constructor: Context is not a valid game instance or an array of defenders.", context);
            return; // Initialization failed
        }
        // --- End Original Context Logic ---

        this._isInitializedSuccessfully = true;

        this.completionPromise = new Promise(async (resolve, reject) => {
            if (!this._isInitializedSuccessfully) {
                reject(new Error("Striker not initialized successfully before attempting to execute strike."));
                return;
            }
            try {
                const damageDealt = await this._orchestrateStrikeSequence(); 
                resolve(damageDealt);
            } catch (error) {
                console.error("Striker: Error during strike sequence orchestration:", error);
                reject(error);
            }
        });
    }

    isInitializedSuccessfully() {
        return this._isInitializedSuccessfully;
    }

    /**
     * Generates a normally distributed random number.
     * Uses the Box-Muller transform.
     * @param {number} mean - The mean of the distribution.
     * @param {number} stdDev - The standard deviation of the distribution.
     * @returns {number} A random number from the specified normal distribution.
     */
    _generateNormalRandom(mean, stdDev) {
        if (this._spareNormal !== null) {
            const result = mean + stdDev * this._spareNormal;
            this._spareNormal = null;
            return result;
        }

        let u1, u2;
        do {
            u1 = Math.random();
        } while (u1 === 0);
        u2 = Math.random();

        const radius = Math.sqrt(-2.0 * Math.log(u1));
        const angle = 2.0 * Math.PI * u2;

        const standardNormal1 = radius * Math.cos(angle);
        const standardNormal2 = radius * Math.sin(angle);

        this._spareNormal = standardNormal2;

        return mean + stdDev * standardNormal1;
    }

    _calculateImpactCoordinates() {
        if (!this.targetCoords) {
            console.error("Striker._calculateImpactCoordinates: targetCoords not available.");
            return { x: 0, y: 0 };
        }
        if (!this.bombPayload || typeof this.bombPayload.impactStdDevPixels !== 'number') {
            console.error("Striker._calculateImpactCoordinates: bombPayload or impactStdDevPixels not available/valid.");
            return { ...this.targetCoords };
        }

        const stdDev = this.bombPayload.impactStdDevPixels;

        if (stdDev <= 0) {
            return { ...this.targetCoords };
        }

        const offsetX = this._generateNormalRandom(0, stdDev);
        const offsetY = this._generateNormalRandom(0, stdDev);

        const impactX = this.targetCoords.x + offsetX;
        const impactY = this.targetCoords.y + offsetY;

        return { x: impactX, y: impactY };
    }

    async _executeStrikeInternal() {
        let totalDeltaRFromDefenders = 0;
        this.actualImpactCoords = null; // Initialize actualImpactCoords for this strike instance

        this.actualImpactCoords = this._calculateImpactCoordinates(); // Store on this instance
        if (!this.actualImpactCoords) {
            console.error("Striker._executeStrikeInternal: Failed to calculate impact coordinates.");
            throw new Error("Failed to calculate impact coordinates in Striker.");
        }

        // --- Play explosion animation FIRST ---
        if (this.bombPayload && this.bombPayload.explosionAnimation && this.actualImpactCoords) {
            this._playExplosionAnimation(this.actualImpactCoords);
        } else if (!this.actualImpactCoords) {
            console.warn("Striker: Explosion animation skipped as actualImpactCoords were not set (in _executeStrikeInternal).");
        }
        // --- END Explosion Animation ---

        // --- THEN Apply Damage ---
        let defendersToProcess = [];
        let enemiesToProcess = [];

        if (this.isRealStrike) {
            if (!this.gameRef || !this.gameRef.defenceManager || !this.gameRef.enemyManager) {
                console.error("Striker._executeStrikeInternal: Game reference or managers not available for real strike.");
                throw new Error("Missing game reference or managers for real strike in Striker.");
            }
            defendersToProcess = this.gameRef.defenceManager.getActiveDefences();
            enemiesToProcess = this.gameRef.enemyManager.getActiveEnemies();
        } else {
            if (!this.optionalClonedDefenders || !Array.isArray(this.optionalClonedDefenders)) {
                console.error("Striker._executeStrikeInternal: Invalid or missing optionalClonedDefenders for simulated strike.");
                throw new Error("Invalid cloned defenders for simulated strike in Striker.");
            }
            defendersToProcess = this.optionalClonedDefenders;
        }

        // Process Defenders
        if (defendersToProcess) {
            for (const defender of defendersToProcess) {
                if (!defender || defender.isDestroyed) {
                    continue;
                }
                if (typeof defender.x !== 'number' || typeof defender.y !== 'number' || typeof defender.hit !== 'function') {
                    console.warn("Striker: Skipping defender due to missing position or hit method.", defender);
                    continue;
                }

                const dist = distanceBetween({ x: defender.x, y: defender.y }, this.actualImpactCoords);
                const effectiveDistance = Math.max(dist, MIN_EFFECTIVE_DISTANCE);
                const potentialDamage = this.bombPayload.strengthA / (effectiveDistance * effectiveDistance);

                if (potentialDamage > 0) {
                    const damageTaken = defender.hit(potentialDamage);
                    if (typeof damageTaken === 'number') {
                        totalDeltaRFromDefenders += damageTaken;
                    }
                }
            }
        }

        // Process Enemies (Collateral Damage for Real Strikes)
        if (this.isRealStrike && enemiesToProcess) { 
            for (const enemy of enemiesToProcess) {
                 if (!enemy || enemy.isDead) { 
                    continue;
                }
                const enemyPos = enemy.getCurrentPosition ? enemy.getCurrentPosition() : (typeof enemy.x === 'number' && typeof enemy.y === 'number' ? { x: enemy.x, y: enemy.y } : null);
                if (!enemyPos || typeof enemy.hit !== 'function') {
                    console.warn("Striker: Skipping enemy due to missing position or hit method.", enemy);
                    continue;
                }

                const dist = distanceBetween(enemyPos, this.actualImpactCoords); 
                const effectiveDistance = Math.max(dist, MIN_EFFECTIVE_DISTANCE);
                const potentialDamage = this.bombPayload.strengthA / (effectiveDistance * effectiveDistance);

                if (potentialDamage > 0) {
                    enemy.hit(potentialDamage);
                }
            }
        }
        // --- END Apply Damage ---
        
        return totalDeltaRFromDefenders;
    }

    // --- ADDED: Plan II.4.b - Orchestration Method Shell ---
    async _orchestrateStrikeSequence() {
        // 1. Play shadow animation and wait for it. Uses INTENDED target Y.
        //    Handle cases where shadow animation might not be available or fails.
        if (this.strikerShadow && this.strikerShadow.texture && this.strikerShadow.config) {
            try {
                await this._playShadowAnimation(this.targetCoords.y);
            } catch (shadowError) {
                console.warn("Striker: Shadow animation failed, proceeding without it.", shadowError);
            }
        }

        // 2. Wait for the configured delay (or default if not set).
        let delayMs = 1000; // Default delay
        if (this.strikerShadow && this.strikerShadow.config && typeof this.strikerShadow.config.shadowToBombDelayMs === 'number' && this.strikerShadow.config.shadowToBombDelayMs >= 0) {
            delayMs = this.strikerShadow.config.shadowToBombDelayMs;
        } else if (this.strikerShadow && this.strikerShadow.config && (typeof this.strikerShadow.config.shadowToBombDelayMs !== 'number' || this.strikerShadow.config.shadowToBombDelayMs < 0)){
            console.warn(`Striker: Invalid shadowToBombDelayMs (${this.strikerShadow.config.shadowToBombDelayMs}) in config. Using default ${delayMs}ms.`);
        }
        await new Promise(resolve => setTimeout(resolve, delayMs));

        // 3. Call _executeStrikeInternal. This will now:
        //    - Internally call _calculateImpactCoordinates() and store result in this.actualImpactCoords.
        //    - Perform damage calculation using this.actualImpactCoords.
        //    - Trigger the explosion animation via _playExplosionAnimation(this.actualImpactCoords).
        //    - Return the total damage dealt.
        this._damageDealtR = await this._executeStrikeInternal();

        return this._damageDealtR; // Return the calculated damage.
    }
    // --- END ADDED ---

    // --- ADDED: Plan II.2 - Shadow Animation ---
    async _playShadowAnimation(targetY) {
        return new Promise((resolve, reject) => {
            if (!this.strikerShadow || !this.strikerShadow.texture || !this.strikerShadow.config || !this.gameInstance || !this.gameInstance.app || !this.gameInstance.effectsLayer) {
                console.warn("Striker: Missing data for shadow animation (shadow config, texture, gameInstance, app, or effectsLayer). Skipping shadow.");
                resolve(); // Resolve immediately if no shadow can be played
                return;
            }

            const shadowConfig = this.strikerShadow.config;
            const shadowSprite = new PIXI.Sprite(this.strikerShadow.texture);

            shadowSprite.anchor.set(0.5, 0.5);
            shadowSprite.alpha = shadowConfig.alpha;
            shadowSprite.scale.set(shadowConfig.scale);
            shadowSprite.y = targetY;

            // Ensure sprite width is determined after texture and scale are set for accurate initial positioning
            const initialX = -shadowConfig.scale * shadowSprite.width / 2; 
            shadowSprite.x = initialX;

            this.gameInstance.effectsLayer.addChild(shadowSprite);

            const mapWidth = this.gameInstance.app.screen.width; // Use app screen width as map width
            const totalDistance = mapWidth + (shadowConfig.scale * shadowSprite.width); // Sprite needs to go fully off-screen
            const animationSpeedPixelsPerSec = shadowConfig.animationSpeed;

            if (animationSpeedPixelsPerSec <= 0) {
                console.warn("Striker: Shadow animationSpeed is zero or negative. Skipping animation logic.");
                // Clean up immediately if speed is invalid, sprite is already added
                if (shadowSprite.parent) {
                    shadowSprite.parent.removeChild(shadowSprite);
                }
                shadowSprite.destroy({ children: true, texture: false, baseTexture: false });
                resolve();
                return;
            }

            const durationMs = (totalDistance / animationSpeedPixelsPerSec) * 1000;
            let startTime = null;

            const tickerFunction = (ticker) => {
                if (!startTime) {
                    startTime = ticker.lastTime; // Use ticker's lastTime on first frame for consistency
                }

                const elapsedTime = ticker.lastTime - startTime;
                const progress = Math.min(elapsedTime / durationMs, 1);
                
                shadowSprite.x = initialX + (totalDistance * progress);

                if (progress >= 1) {
                    this.gameInstance.app.ticker.remove(tickerFunction);
                    if (shadowSprite.parent) {
                        shadowSprite.parent.removeChild(shadowSprite);
                    }
                    shadowSprite.destroy({ children: true, texture: false, baseTexture: false });
                    resolve();
                }
            };

            this.gameInstance.app.ticker.add(tickerFunction);
        });
    }
    // --- END ADDED ---

    // --- ADDED: Plan II.3 - Explosion Animation ---
    _playExplosionAnimation(impactCoords) {
        if (!this.bombPayload || !this.bombPayload.explosionAnimation || !this.bombPayload.explosionAnimation.textures || this.bombPayload.explosionAnimation.textures.length === 0) {
            console.warn("Striker: Missing data for explosion animation (payload, animation data, or textures). Skipping explosion.");
            return;
        }
        if (!this.gameInstance || !this.gameInstance.groundLayer) {
            console.warn("Striker: Missing gameInstance or groundLayer. Skipping explosion.");
            return;
        }
        if (!impactCoords || typeof impactCoords.x !== 'number' || typeof impactCoords.y !== 'number') {
            console.warn("Striker: Invalid impactCoords for explosion. Skipping explosion.", impactCoords);
            return;
        }

        const animData = this.bombPayload.explosionAnimation;
        const explosionSprite = new PIXI.AnimatedSprite(animData.textures);

        // Calculate animationSpeed for PIXI.AnimatedSprite
        // PIXI.AnimatedSprite.animationSpeed is a multiplier of Ticker.deltaMS (or a replacement for Ticker.speed if > 0)
        // If animData.frameDurationMs is, e.g., 50ms, we want 1 frame per 50ms.
        // If ticker runs at 60FPS, deltaTime is approx 16.67ms.
        // Speed = desired_frame_duration / typical_ticker_delta_time_ms. This is not quite right.
        // animationSpeed is frames per Ticker.deltaMS * Ticker.speed. Or frames per tick if Ticker.speed = 1.
        // If we want N frames per second: animationSpeed = N / 60 (assuming 60FPS ticker update rate).
        // If frameDurationMs is 50ms, then we want 1000/50 = 20 FPS for the animation.
        // So, animationSpeed = (1000 / animData.frameDurationMs) / 60.0; (This was from plan)
        // Let's test with this. PIXI docs say: "The speed that the AnimatedSprite will play at. Higher is faster, lower is slower."
        // And default is 1. If animData.frameDurationMs is the duration of one frame, then fps = 1000/frameDurationMs.
        // AnimatedSprite.animationSpeed seems to relate to how many animation frames to play per game frame. 
        // If ticker is 60fps, animationSpeed = 1 means 1 animation frame per game frame (very fast if many animation frames).
        // A better way: time between frames = animData.frameDurationMs. 
        // PIXI.AnimatedSprite.animationSpeed = 1 / (frames_per_animation_frame_update * Ticker.targetFPMS)
        // Let's try the plan's formula first and adjust if needed. Typical Ticker update is about 16.67ms (60FPS).
        if (animData.frameDurationMs > 0) {
            explosionSprite.animationSpeed = (1000 / animData.frameDurationMs) / (this.gameInstance.app?.ticker?.FPS || 60); // Normalize against actual FPS if possible
        } else {
            explosionSprite.animationSpeed = 1; // Default speed if frameDuration is 0 or invalid
        }
        
        explosionSprite.loop = false;
        explosionSprite.anchor.set(animData.anchorX, animData.anchorY);
        explosionSprite.scale.set(animData.scale);
        explosionSprite.position.set(impactCoords.x, impactCoords.y);
        explosionSprite.zIndex = impactCoords.y; // For sorting on groundLayer if sortableChildren is true

        this.gameInstance.groundLayer.addChild(explosionSprite);

        explosionSprite.onComplete = () => {
            if (explosionSprite.parent) {
                explosionSprite.parent.removeChild(explosionSprite);
            }
            // Do not destroy base textures if they are shared.
            explosionSprite.destroy({ children: true, texture: false, baseTexture: false });
        };

        explosionSprite.play();
    }
    // --- END ADDED ---
} 