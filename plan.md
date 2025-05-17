# PixiJS Refactoring Plan

## In Progress: Striker Animations (Shadow & Explosion)

This plan details the implementation of shadow and explosion animations for striker bombs using PixiJS.

**I. Asset Preparation and Configuration (`strike.json`, `StrikeManager.js`)**

1.  **Shadow Asset & Configuration (in `strike.json`):**
    *   Create a pre-blurred, semi-transparent oval shadow image (e.g., `bomber_shadow.png`) using an image editor.
    *   Add a new section to `strike.json` for the shadow plane:
        ```json
        "shadowPlane": {
            "texturePath": "public/assets/images/effects/bomber_shadow.png", // You'll need to create this image and path
            "animationSpeed": 1200, // Pixels per second for its movement across the map (adjust for feel)
            "scaleY": 0.4,         // Example: To make it look like a flat, wide shadow
            "alpha": 0.35,         // Base transparency
            "verticalOffset": -60 // Pixels above the target Y, adjust for visual depth
        }
        ```
2.  **Explosion Animation Configuration (Updates in `strike.json`):**
    *   The `Explosion1` folder contains 36 frames, named `0001.png` to `0036.png`.
    *   Update/confirm the `explosionAnimation` section in `strike.json`:
        ```json
        "explosionAnimation": {
            "folderPath": "public/assets/images/PixelSimulations/Explosion1/", // Ensure this path is correct from project root
            "filePrefix": "", 
            "fileSuffix": ".png",
            "frameCount": 36,
            "digitsForZeroPadding": 4,
            "frameDuration": 50,  // Milliseconds per frame (50ms * 36 frames = 1.8s animation). Adjust for desired speed.
            "scale": 1.75,        // Adjust as needed for visual impact relative to other assets
            "anchorX": 0.5,
            "anchorY": 0.5
        }
        ```
3.  **Asset Loading in `StrikeManager.js`:**
    *   **Shadow Texture:**
        *   In `StrikeManager.loadConfig()`, load the shadow texture: `const shadowTexture = await PIXI.Assets.load(config.shadowPlane.texturePath);`.
        *   Store this loaded `PIXI.Texture` (e.g., `this.shadowTexture`) and the `shadowPlane` config object (e.g., `this.shadowPlaneConfig`).
    *   **Explosion Textures (Modify `_loadExplosionFrames()`):**
        *   This method currently loads `Image` objects. It **must be changed** to load `PIXI.Texture` objects.
        *   Inside the loop: `const texture = await PIXI.Assets.load(fullPath);`
        *   Store the array of loaded `PIXI.Texture` objects in a property like `this.explosionPixiTextures`.
        *   The `this.loadedAnimationData` property should be updated or replaced by a new one (e.g., `this.pixiExplosionAnimationData`) to hold:
            *   `textures: PIXI.Texture[]` (the array of loaded PIXI textures)
            *   `frameDuration`, `scale`, `anchorX`, `anchorY` from the config.

**II. `Striker.js` - Animation Orchestration**

1.  **Constructor (`Striker.js`):**
    *   Modify the constructor to accept and store:
        *   `gameInstance`: The main `Game` object (passed from `StrikeManager`).
        *   `shadowTexture: PIXI.Texture`
        *   `shadowConfig: object`
        *   `explosionAnimationData: object` (containing `textures: PIXI.Texture[]`, `frameDuration`, etc.)
    *   These will likely be passed via the `bombPayload` object from `StrikeManager`.
    *   Example: `this.game = gameInstance; this.shadowTexture = bombPayload.shadowTexture; ...`
2.  **New Internal Method: `async _playShadowAnimation(targetY)`:**
    *   Creates `const shadowSprite = new PIXI.Sprite(this.shadowTexture);`.
    *   Sets `anchor.set(0.5, 0.5)`, `alpha`, `scale.y` based on `this.shadowConfig`.
    *   Sets initial `y` position: `targetY + this.shadowConfig.verticalOffset`.
    *   Sets initial `x` position: off-screen left (e.g., `-shadowSprite.width / 2`). Make sure sprite width is determined after texture load if not fixed.
    *   Adds to `this.game.effectsLayer.addChild(shadowSprite);`.
    *   Animation:
        *   Calculate total distance: `this.game.mapWidth + shadowSprite.width`.
        *   Calculate `durationMs = (totalDistance / this.shadowConfig.animationSpeed) * 1000;`.
        *   Use a `Promise` with `requestAnimationFrame` or a simple tween logic to animate `shadowSprite.x` across the screen.
        *   Alternatively, use `this.game.app.ticker` for animation updates.
    *   Cleanup: When animation is complete, remove the sprite and destroy it: `shadowSprite.destroy();`.
    *   Return a `Promise` that resolves when the shadow animation is fully completed and cleaned up.
3.  **New Internal Method: `_playExplosionAnimation(impactCoords)`:**
    *   Creates `const explosionSprite = new PIXI.AnimatedSprite(this.explosionAnimationData.textures);`.
    *   Sets properties:
        *   `explosionSprite.animationSpeed = (1000 / this.explosionAnimationData.frameDuration) / 60;` (Assuming 60 FPS target for speed interpretation. Adjust or test this formula for desired playback speed).
        *   `explosionSprite.loop = false;`
        *   `explosionSprite.anchor.set(this.explosionAnimationData.anchorX, this.explosionAnimationData.anchorY);`
        *   `explosionSprite.scale.set(this.explosionAnimationData.scale);`
    *   Sets position: `explosionSprite.position.set(impactCoords.x, impactCoords.y);`.
    *   Z-Ordering: `explosionSprite.zIndex = impactCoords.y;`.
    *   Adds to `this.game.groundLayer.addChild(explosionSprite);`.
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
    *   Create a new primary internal async method, e.g., `async _orchestrateStrikeSequence()`:
        ```javascript
        async _orchestrateStrikeSequence() {
            // 1. Play shadow animation and wait for it. Uses INTENDED target Y.
            await this._playShadowAnimation(this.targetCoords.y);

            // 2. Wait 1 second (1000ms).
            await new Promise(resolve => setTimeout(resolve, 1000));

            // 3. Calculate ACTUAL impact coordinates (existing logic).
            const actualImpactCoords = this._calculateImpactCoordinates();
            if (!actualImpactCoords) { /* error handling */ }

            // 4. Perform damage calculation.
            //    Move the core damage logic from the current _executeStrikeInternal 
            //    (or its equivalent after prior refactors) into a new synchronous method, 
            //    e.g., _applyDamageAndCalculateDeltaR(actualImpactCoords).
            this._damageDealtR = this._applyDamageAndCalculateDeltaR(actualImpactCoords);

            // 5. Play explosion animation at ACTUAL impact coordinates.
            //    This is fire-and-forget from the sequence's perspective.
            this._playExplosionAnimation(actualImpactCoords);

            return this._damageDealtR; // Return the calculated damage.
        }
        ```
    *   The `completionPromise` in the `Striker` constructor should now call `_orchestrateStrikeSequence()`:
        ```javascript
        this.completionPromise = new Promise(async (resolve, reject) => {
            if (!this._isInitializedSuccessfully) { /* reject */ return; }
            try {
                const damageDealt = await this._orchestrateStrikeSequence();
                resolve(damageDealt);
            } catch (error) { /* reject */ }
        });
        ```
    *   The original `_executeStrikeInternal` is effectively replaced by `_orchestrateStrikeSequence` and `_applyDamageAndCalculateDeltaR`.

**III. `StrikeManager.js` - Passing Animation Data**

1.  **Update `calculateBombStrength()` (or where `bombPayload` is assembled):**
    *   When `this.bombPayload` is created/updated, it needs to include the animation data for the `Striker`.
    *   Instead of (or in addition to) just `animation: this.getLoadedAnimationData()`, it should be structured so `Striker` can access:
        *   `explosionAnimation: this.pixiExplosionAnimationData` (with `PIXI.Texture[]`)
        *   `shadowTexture: this.shadowTexture`
        *   `shadowConfig: this.shadowPlaneConfig`
2.  **`dispatchStriker(targetCoords, strikeContext)`:**
    *   Ensure the `bombPayload` passed to `new Striker(...)` contains all necessary data:
        ```javascript
        // In StrikeManager.calculateBombStrength or a similar setup method:
        this.bombPayload = {
            strengthA: this.bombStrengthA,
            impactStdDevPixels: this.impactStdDevPixels,
            explosionAnimation: this.pixiExplosionAnimationData, // Populated by _loadExplosionFrames
            shadowTexture: this.shadowTexture,                 // Populated by loadConfig
            shadowConfig: this.shadowPlaneConfig               // Populated by loadConfig
        };

        // In StrikeManager.dispatchStriker:
        // ...
        // The 'this.game' instance needs to be passed separately to the Striker constructor
        // if it's not already part of strikeContext in a way Striker expects.
        // Current Striker constructor: constructor(bombPayload, targetCoords, context)
        // We need to ensure 'context' can be the game instance or provide game instance additionally.
        // For clarity, let's assume Striker's constructor will be adjusted:
        // new Striker(this.bombPayload, targetCoords, strikeContext, this.game);
        // OR, if strikeContext is always this.game for real strikes:
        const striker = new Striker(this.bombPayload, targetCoords, this.game); // Simpler if context is game
        // Striker's constructor will then unpack from bombPayload and use the game instance.
        ```

**IV. `Game.js` - Effects Layer**

1.  **Initialize `effectsLayer`:**
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
        // this.app.stage.addChild(this.uiLayer); 
        ```
    *   Set `this.effectsLayer.zIndex` if your stage uses zIndex for direct children ordering (less common than containers). If `groundLayer` has a zIndex, `effectsLayer` needs a higher one. Simpler is explicit add order if not using zIndex on stage children.

**V. Create Shadow Asset**
1.  Open an image editor (Photoshop, GIMP, Krita, etc.).
2.  Create a new image with a transparent background (e.g., 256x64 pixels, adjust as needed).
3.  Draw a black or very dark grey oval.
4.  Apply a blur effect to make the edges soft.
5.  Adjust transparency of the layer/oval if needed.
6.  Export as `bomber_shadow.png` to the path specified in `strike.json` (e.g., `public/assets/images/effects/`).

This refined plan prioritizes performance for the shadow and clarifies data flow.