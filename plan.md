## Plan: Striker Animations (Shadow & Explosion)

This plan details the implementation of shadow and explosion animations for striker entities using PixiJS.

**I. Asset Preparation and Configuration (`strike.json`, `StrikeManager.js`)**

1.  **[DONE] Shadow Asset & Configuration (in `strike.json`):**
    *   A pre-blurred shadow image `bomber-blur.png` is provided.
    *   Add a new section to `strike.json` for the shadow plane:
        ```json
        "shadowPlane": {
            "texturePath": "public/assets/images/bomber-blur.png",
            "animationSpeed": 1200, // Pixels per second for its movement across the map
            "scale": 0.4,
            "alpha": 0.35         // Base transparency
        }
        ```
2.  **[DONE] Explosion Animation Configuration (Updates in `strike.json`):**
    *   The `Explosion1` folder contains 36 frames, named `0001.png` to `0036.png`.
    *   Update/confirm the `explosionAnimation` section in `strike.json`:
        ```json
        "explosionAnimation": {
            "folderPath": "public/assets/images/PixelSimulations/Explosion1/", // Ensure this path is correct from project root
            "filePrefix": "",
            "fileSuffix": ".png",
            "frameCount": 36,
            "digitsForZeroPadding": 4,
            "frameDurationMs": 50,
            "scale": 0.5,
            "anchorX": 0.5,
            "anchorY": 0.9
        }
        ```
3.  **[DONE] Asset Loading in `StrikeManager.js`:**
    *   **[DONE] Shadow Texture:**
        *   In `StrikeManager.loadConfig()`, load the shadow texture: `const shadowTexture = await PIXI.Assets.load(config.shadowPlane.texturePath);`.
        *   Store this loaded `PIXI.Texture` (e.g., `this.shadowTexture`) and the `shadowPlane` config object (e.g., `this.shadowPlaneConfig`).
        *   Can we bundle the texture and config into a single object please, called `strikerShadow` (Implemented as `this.strikerShadowData`).
    *   **[DONE] Explosion Textures (Modify `_loadExplosionFrames()`):**
        *   This method currently loads `Image` objects. It **must be changed** to load `PIXI.Texture` objects.
        *   Inside the loop: `const texture = await PIXI.Assets.load(fullPath);`
        *   Store the array of loaded `PIXI.Texture` objects in a property like `this.explosionPixiTextures`.
        *   The `this.loadedAnimationData` property should be updated or replaced by a new one (e.g., `this.pixiExplosionAnimationData`) to hold:
            *   `textures: PIXI.Texture[]` (the array of loaded PIXI textures)
            *   `frameDuration`, `scale`, `anchorX`, `anchorY` from the config.
        *   Here again, the bomb animation, config, and properties like strength should be bundled into a single object (i.e., we treat the whole package as an actual physical bomb which strikeManager passes to striker on dispatch.) That object is `bombPayload`. (Implemented via `this.pixiExplosionAnimationData` being part of `this.bombPayload`).

**II. `Striker.js` - Animation Orchestration**

1.  **[DONE] Constructor (`Striker.js`):**
    *   Modify the constructor to accept and store:
        *   `gameInstance`: The main `Game` object (passed from `StrikeManager`).
        *   The shadow object (`shadowTexture: PIXI.Texture`,`shadowConfig: object`), called `strikerShadow`.
        *   The bomb object (`explosionAnimationData: object` (containing `textures: PIXI.Texture[]`, `frameDuration`, etc.) and bomb strength and any other bomb related info).These will likely be passed via the `bombPayload` object from `StrikeManager`.
    *   Also ensure `StrikeManager.js` is updated to call the new constructor signature.

2.  **[DONE] New Internal Method: `async _playShadowAnimation(targetY)`:**
    *   Creates `const shadowSprite = new PIXI.Sprite(this.strikerShadow.texture);`.
    *   Sets `anchor.set(0.5, 0.5)`, `alpha`, `scale` based on `this.strikerShadow.config`.
    *   Sets initial `y` position: `targetY`.
    *   Sets initial `x` position: off-screen left (e.g., `-shadowConfig.scale*shadowSprite.width / 2`). Make sure sprite width is determined after texture load.
    *   Adds to `this.gameInstance.effectsLayer.addChild(shadowSprite);`.
    *   Animation:
        *   Calculate total distance: `this.gameInstance.app.screen.width + shadowConfig.scale*shadowSprite.width`.
        *   Calculate `durationMs = (totalDistance / shadowConfig.animationSpeed) * 1000;`.
        *   Use `this.gameInstance.app.ticker` for animation updates.
    *   Cleanup: When animation is complete, remove the sprite and destroy it: `shadowSprite.destroy({ children: true, texture: false, baseTexture: false });`.
    *   Return a `Promise` that resolves when the shadow animation is fully completed and cleaned up.

3.  **[DONE] New Internal Method: `_playExplosionAnimation(impactCoords)`:**
    *   Creates `const explosionSprite = new PIXI.AnimatedSprite(this.bombPayload.explosionAnimation.textures);`.
    *   Sets properties:
        *   `explosionSprite.animationSpeed = (1000 / animData.frameDurationMs) / (this.gameInstance.app?.ticker?.FPS || 60);` (Adjusted formula for PIXI.AnimatedSprite).
        *   `explosionSprite.loop = false;`
        *   `explosionSprite.anchor.set(animData.anchorX, animData.anchorY);`
        *   `explosionSprite.scale.set(animData.scale);`
    *   Sets position: `explosionSprite.position.set(impactCoords.x, impactCoords.y);`.
    *   Z-Ordering: `explosionSprite.zIndex = impactCoords.y;`.
    *   Adds to `this.gameInstance.groundLayer.addChild(explosionSprite);`.
    *   Handles completion:
        ```javascript
        explosionSprite.onComplete = () => {
            if (explosionSprite.parent) {
                explosionSprite.parent.removeChild(explosionSprite);
            }
            // Do not destroy base textures if they are shared.
            explosionSprite.destroy({ children: true, texture: false, baseTexture: false });
        };
        ```
    *   Starts animation: `explosionSprite.play();`.

4.  **Refactor `Striker` Execution Flow:**
    *   **4.a.** Modify the existing `async _executeStrikeInternal()` method:
        *   At the beginning of the method, after calling `this._calculateImpactCoordinates()`, store its result in a new instance property, e.g., `this.actualImpactCoords = actualImpactCoords;`.
        *   The method should continue to use `this.actualImpactCoords` for damage calculations.
        *   **After all damage calculations are complete, and before returning `totalDeltaRFromDefenders`, add a call to `this._playExplosionAnimation(this.actualImpactCoords);`**. This ensures the explosion plays at the actual impact point.
        *   The method should continue to return `totalDeltaRFromDefenders`.
    *   **4.b.** Create a new primary internal async method named `async _orchestrateStrikeSequence()`.
    *   **4.c.** Implement the strike sequence within `_orchestrateStrikeSequence()`:
        ```javascript
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

            // 2. Wait 1 second (1000ms).
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 3. Call _executeStrikeInternal. This will now:
            //    - Internally call _calculateImpactCoordinates() and store result in this.actualImpactCoords.
            //    - Perform damage calculation using this.actualImpactCoords.
            //    - Trigger the explosion animation via _playExplosionAnimation(this.actualImpactCoords).
            //    - Return the total damage dealt.
            this._damageDealtR = await this._executeStrikeInternal();

            return this._damageDealtR; // Return the calculated damage.
        }
        ```
    *   **4.d.** The `completionPromise` in the `Striker` constructor should now call `_orchestrateStrikeSequence()`:
        ```javascript
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
        ```
    *   The original `_executeStrikeInternal` method is kept and modified to include the explosion animation call, not removed.

**III. `Game.js` - Effects Layer**

1.  **[DONE] Initialize `effectsLayer`:**
    *   In `Game.initialize()` (or constructor):
        ```javascript
        this.effectsLayer = new PIXI.Container();
        this.app.stage.addChild(this.effectsLayer);
        // Ensure it's above groundLayer, potentially by reordering stage children
        // or if groundLayer is added after, ensure effectsLayer is added after groundLayer
        // A common pattern:
        // this.app.stage.addChild(this.backgroundSprite);
        // this.app.stage.addChild(this.puddleLayer);
        // this.app.stage.addChild(this.groundLayer);
        // this.app.stage.addChild(this.effectsLayer); // <--- Add here
        // The layer which holds the defender placement preview square goes on top of that, as it is some UI related feature
        ```