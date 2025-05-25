import { distanceBetween } from '../utils/geometryUtils.js';
import * as PIXI from 'pixi.js'; // Import the PIXI library

const MIN_EFFECTIVE_DISTANCE = 1.0; // Moved to module scope for clarity, or could be static class member

export default class Striker {
    /**
     * Represents a single bomb strike event, handling its animation and damage application.
     * @param {object} gameInstance - The main Game object (e.g., for accessing PIXI layers, app).
     * @param {object} strikerShadow - Contains shadow texture and configuration for the shadow animation.
     * @param {object} bombPayload - Contains bomb properties (strength, explosion animation data, impact std dev).
     * @param {object} determinedImpactCoords - The PRE-CALCULATED {x, y} coordinates for the bomb's actual impact.
     * @param {object} context - Either the main Game instance (for real strike) or an array of cloned defenders (for simulation).
     */
    constructor(gameInstance, strikerShadow, bombPayload, determinedImpactCoords, context) {
        this._isInitializedSuccessfully = false;
        this._damageDealtR = 0;
        this.completionPromise = null;

        // Store parameters
        this.gameInstance = gameInstance; 
        this.strikerShadow = strikerShadow; 
        this.bombPayload = bombPayload;
        // Store the pre-determined impact coordinates directly
        this.actualImpactCoords = determinedImpactCoords; // MODIFIED: Store determinedImpactCoords as actualImpactCoords
        // this._spareNormal = null; // REMOVED: No longer needed here

        // --- Validate Core New Parameters ---
        if (!gameInstance || typeof gameInstance !== 'object') {
            console.error("Striker constructor: Invalid gameInstance provided.", gameInstance);
            return; // Initialization failed
        }
        if (strikerShadow && typeof strikerShadow !== 'object') { 
            console.error("Striker constructor: Invalid strikerShadow provided (if not null, must be object).", strikerShadow);
            return; // Initialization failed
        }

        if (!bombPayload ||
            typeof bombPayload.strengthA !== 'number' ||
            (bombPayload.strengthA < 0) || 
            !bombPayload.explosionAnimation || 
            // bombPayload.impactStdDevPixels is no longer used by Striker directly for calculation
            typeof bombPayload.minDamageThreshold !== 'number' || bombPayload.minDamageThreshold < 0 ) {
            console.error("Striker constructor: Invalid bombPayload provided (impactStdDevPixels check removed).", bombPayload);
            return; // Initialization failed
        }

        // --- Validate determinedImpactCoords (previously targetCoords) ---
        if (!this.actualImpactCoords || typeof this.actualImpactCoords.x !== 'number' || typeof this.actualImpactCoords.y !== 'number') {
            console.error("Striker constructor: Invalid determinedImpactCoords provided.", this.actualImpactCoords);
            return; // Initialization failed
        }

        // --- Validate context and determine strike type ---
        if (!context) {
            console.error("Striker constructor: Invalid context (game or clonedDefenders) provided.");
            return; // Initialization failed
        }

        if (context.defenceManager && context.enemyManager) {
            this.isRealStrike = true;
            this.gameRef = context; 
            this.optionalClonedDefenders = null;
        } else if (Array.isArray(context)) {
            this.isRealStrike = false;
            this.gameRef = null;
            this.optionalClonedDefenders = context; 
        } else {
            console.error("Striker constructor: Context is not a valid game instance or an array of defenders.", context);
            return; // Initialization failed
        }
        
        this._isInitializedSuccessfully = true;

        this.completionPromise = new Promise(async (resolve, reject) => {
            if (!this._isInitializedSuccessfully) {
                reject(new Error("Striker not initialized successfully before attempting to execute strike."));
                return;
            }
            try {
                // Pass this.actualImpactCoords (which is the determined one) to _orchestrateStrikeSequence
                const damageDealt = await this._orchestrateStrikeSequence(this.actualImpactCoords); 
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

    async _executeStrikeInternal(impactCoords) { // Accepts impactCoords directly
        let totalDeltaRFromDefenders = 0;
        // actualImpactCoords is already set in constructor from determinedImpactCoords
        // No need to calculate it here.

        if (!impactCoords) { // Use the passed impactCoords
            console.error("Striker._executeStrikeInternal: impactCoords not provided.");
            throw new Error("Missing impactCoords in Striker._executeStrikeInternal.");
        }

        // --- Play explosion animation FIRST ---
        // Animation should use the final impactCoords
        if (this.bombPayload && this.bombPayload.explosionAnimation) {
            this._playExplosionAnimation(impactCoords); 
        } else {
            console.warn("Striker: Explosion animation skipped as payload or animation data missing (in _executeStrikeInternal).");
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

                // Use the passed impactCoords for distance calculation
                const dist = distanceBetween({ x: defender.x, y: defender.y }, impactCoords); 
                const effectiveDistance = Math.max(dist, MIN_EFFECTIVE_DISTANCE);
                const potentialDamage = this.bombPayload.strengthA / (effectiveDistance * effectiveDistance);

                if (potentialDamage >= (this.bombPayload.minDamageThreshold ?? 0)) {
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
                // Use the passed impactCoords for distance calculation
                const dist = distanceBetween(enemyPos, impactCoords); 
                const effectiveDistance = Math.max(dist, MIN_EFFECTIVE_DISTANCE);
                const potentialDamage = this.bombPayload.strengthA / (effectiveDistance * effectiveDistance);

                if (potentialDamage >= (this.bombPayload.minDamageThreshold ?? 0)) {
                    enemy.hit(potentialDamage);
                }
            }
        }
        // --- END Apply Damage ---
        
        return totalDeltaRFromDefenders;
    }

    async _orchestrateStrikeSequence(determinedImpactCoords) { // Accepts determinedImpactCoords
        // 1. Play shadow animation and wait for it. Uses INTENDED target Y from determinedImpactCoords (or original target if different).
        //    The plan implies shadow is at the optimal target, explosion/damage at determinedImpact.
        //    For simplicity now, let's assume shadow animation also uses the determinedImpactCoords.x and some relevant Y.
        //    If shadow needs to be at the *optimal grid cell center* before random offset, StrikeManager would need to pass that too.
        //    Current Striker constructor only gets one set of coords. Let's use determinedImpactCoords for shadow for now.
        
        // The shadow animation Y position might conceptually be the original optimal target's Y, 
        // while the actual impact (and thus explosion) is at determinedImpactCoords.y.
        // For now, using determinedImpactCoords.y for shadow as well, assuming it's close enough or the design detail needs clarification.
        const shadowTargetY = determinedImpactCoords.y; 

        if (this.strikerShadow && this.strikerShadow.texture && this.strikerShadow.config) {
            try {
                // Pass the Y coordinate for the shadow target
                await this._playShadowAnimation(shadowTargetY); 
            } catch (shadowError) {
                console.warn("Striker: Shadow animation failed, proceeding without it.", shadowError);
            }
        }

        // 2. Execute internal strike logic (explosion animation and damage) using determinedImpactCoords.
        //    _executeStrikeInternal now takes impactCoords as a parameter.
        const damageDealt = await this._executeStrikeInternal(determinedImpactCoords);
        this._damageDealtR = damageDealt; 

        return this._damageDealtR;
    }

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
        // --- ADDED: Trigger screen shake ---
        this._triggerScreenShake(300, 8, 20); // durationMs, maxOffsetPx, frequencyHz
        // --- END ADDED ---

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

    // --- ADDED: Screen Shake Effect ---
    _triggerScreenShake(durationMs, maxOffsetPx, frequencyHz) {
        const gameContainer = document.getElementById('gameContainer');
        const defenceMenu = document.getElementById('defenceMenu');

        if (!gameContainer || !defenceMenu) {
            console.warn("Striker: Could not find 'gameContainer' or 'defenceMenu' for screen shake.");
            return;
        }

        const startTime = performance.now();

        function animateShake(currentTime) {
            const elapsedTimeMs = currentTime - startTime;
            let progress = elapsedTimeMs / durationMs;

            if (progress >= 1) {
                progress = 1; // Ensure we end exactly at 0 offset
            }

            const decayFactor = 1 - progress; // Linear decay
            // For a more pronounced decay, one could use: Math.pow(1 - progress, 2) or Math.pow(1 - progress, 3)
            
            const timeSeconds = elapsedTimeMs / 1000;
            // Ensure that at the very end (progress = 1), sine wave or not, offset becomes 0 due to decayFactor
            const currentOffset = progress === 1 ? 0 : maxOffsetPx * decayFactor * Math.sin(2 * Math.PI * frequencyHz * timeSeconds);

            if (gameContainer) {
                gameContainer.style.transform = `translateX(${currentOffset}px)`;
            }
            if (defenceMenu) {
                defenceMenu.style.transform = `translateX(${currentOffset}px)`;
            }

            if (progress < 1) {
                requestAnimationFrame(animateShake);
            } else {
                // Explicitly clear transform if elements still exist
                if (gameContainer) {
                    gameContainer.style.transform = 'translateX(0px)';
                }
                if (defenceMenu) {
                    defenceMenu.style.transform = 'translateX(0px)';
                }
            }
        }

        requestAnimationFrame(animateShake);
    }
    // --- END ADDED ---
} 