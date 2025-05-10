# PixiJS Refactoring Plan

This plan outlines the steps to refactor the game's rendering pipeline to use PixiJS.

## In Progress

### Phase 3: UI Elements & Effects

**Phase 3.A: Refactor Health Bar System** (Base.js part is DONE)

15. **Integrate `healthBar.js` into Entities (e.g., `Enemy.js`, `Defender.js`):**
    *   In entity's initialization (e.g., `Enemy.loadAssets` or constructor): `this.healthBarDisplay = new HealthBarDisplay(this.pixiContainer, this.pixiSprite, this.game);` (adjust parent/sprite refs as needed).
    *   In entity's `update()`: `this.healthBarDisplay.update(this.currentHp, this.maxHp);`.
    *   In entity's destruction logic: `this.healthBarDisplay.setVisible(false);` or `this.healthBarDisplay.destroy();`.
    *   In entity's `reset()`: `this.healthBarDisplay.setVisible(true);` (or re-create), call `update()`.
    *   Remove old direct calls to `drawHealthBar` from these entities.

---

## Tasks To Do

### Phase 2: Asset Loading & Entity Rendering

**Phase 2.B: General Asset Loading & Other Entities**

11. **Defender Rendering (`Defender.js`, `DefenceManager.js`):**
    *   Apply similar changes as for Enemies.

### Phase 3: UI Elements & Effects

*(Phase 3.A is In Progress)*

**Phase 3.B: Other UI Elements & Effects**

16. **Placement Preview (`Game.js`):**
    *   Refactor `renderPlacementPreview` to use `PIXI.Graphics` to draw the preview square on the PixiJS stage.
17. **Defender Effects (Puddles in `Defender.js`):**
    *   Represent puddles with `PIXI.Graphics` objects, add/remove from an effects container on the PixiJS stage.
18. **Strike Manager Z-Buffer/Heatmap (`StrikeManager.js`):**
    *   Refactor `renderZBuffer` to use `PIXI.Graphics` to draw the heatmap cells onto a `PIXI.Graphics` object added to the stage.
19. **Striker Explosion Animation (`Striker.js`, `StrikeManager.js`):**
    *   Load explosion frames as a sequence of `PIXI.Texture`s.
    *   `Striker.js` creates and plays a `PIXI.AnimatedSprite` for explosions, adding it to an effects container on the PixiJS stage and removing it on completion.

*(Phase 3.C Hit Flash Effect is DONE, details moved to Completed section)*

### Phase 4: Main Render Loop & Cleanup

20. **New Main Render Loop (`Game.js`):**
    *   The primary game loop for rendering is now driven by PixiJS `Application.ticker`.
    *   The `Game.update()` method will still handle game logic updates for all entities.
    *   If a `Game.render()` method is kept, its role will shift from direct drawing to potentially triggering high-level PixiJS updates if not handled by individual entity `update` methods, or it might be removed entirely if the ticker and entity updates cover all needs.
    *   Y-sorting managed via `PIXI.Container` `sortableChildren` and `zIndex`, or manual reordering of children in a container.
21. **Cleanup:**
    *   Ensure all old direct canvas `ctx` drawing calls are removed from all files.
    *   Remove obsolete canvas properties and utility functions.
    *   Update event handling for PixiJS interactive objects if needed (e.g., for defence placement clicks).
    *   **Review `utils/renderUtils.js` for deletion:** Once `HealthBarDisplay` is fully integrated into ALL relevant entities (Base, Enemies, Defenders), `utils/renderUtils.js` should be checked. If `drawHealthBar` is its only export and no other code uses it, the file can be deleted. (User restored this file as other entities still use it).

---

## Completed Tasks

### Phase 1: Core Setup & Background (DONE)

1.  **(DONE) Install & Initialize PixiJS:**
    *   Add PixiJS to the project (npm install, import map in `index.html`).
    *   In `Game.js`, create `PIXI.Application`, append `app.canvas` to the container.
    *   **Crucially, remove old canvas/layer creation (`this.layers`, `this.bgCanvas`, `this.fgCanvas`, `this.bgCtx`, `this.fgCtx`).**
2.  **(DONE) Background Rendering:**
    *   Load background image using `PIXI.Assets.load()`.
    *   Create a `PIXI.Sprite` for the background, scale it, and add it to the PixiJS stage.
    *   Remove the old `Game.drawBackground` method.
3.  **(DONE) Gut Old `Game.render()` Method:**
    *   The existing `Game.render()` method, which previously orchestrated drawing to the old canvas contexts, has been emptied. Its calls to manager `render` methods have ceased.
    *   The new role of the game loop with PixiJS will be established in Phase 4.

### Phase 2: Asset Loading & Entity Rendering (Partially DONE)

**Phase 2.A: Base Entity Rendering (`Base.js`, `Game.js`, `utils/renderUtils.js`) (DONE)**

4.  **(DONE) Modify `Base.js` - Asset Loading & Initialization:**
    *   Import `Assets`, `Texture`, `Sprite`, `Rectangle`, `Graphics`, `Container`, `TextureSource` from `pixi.js`.
    *   In `constructor`: add `this.pixiSprite`, `this.textures = []`, `this.pixiContainer`. (Old `this.healthBarGraphic` removed, new `this.healthBarDisplay` added).
    *   In `async loadAssets()`:
        *   Load base spritesheet using `await Assets.load(this.spritePath)`.
        *   Correctly determine `TextureSource` from loaded asset.
        *   Extract individual frame `Texture`s using `new Texture({ source: baseImageTextureSource, frame: frameRectangle })` and store them in `this.textures`.
        *   Create `this.pixiContainer`, set its `x`, `y`.
        *   Create `this.pixiSprite = new Sprite(this.textures[0])`, set anchor, scale, and add to `pixiContainer`.
        *   (New `HealthBarDisplay` instantiated here for Base).
    *   Remove the old `loadSprite(path)` method.
5.  **(DONE) Modify `Base.js` - Update Logic & Health Bar Link:**
    *   In `update(timestamp, deltaTime)`:
        *   Keep existing logic to calculate `this.currentFrame` based on HP percentage.
        *   Update `this.pixiSprite.texture = this.textures[this.currentFrame]`.
        *   Call to old `drawHealthBar` removed; replaced by `this.healthBarDisplay.update()`.
        *   Manage `this.pixiContainer.visible` based on `_isDestroyed` (in `takeDamage` and `reset`).
6.  **(DONE) Remove `Base.js` `render(ctx)` method.**
7.  **(DONE) Modify `utils/renderUtils.js` - Initial Refactor `drawHealthBar`:** (This step is now superseded by `HealthBarDisplay` logic. `renderUtils.js` is kept temporarily for other entities).
    *   Change signature to accept `(graphics, currentHp, maxHp, ...)` and use PixiJS drawing methods.
    *   Include logic to clear & return if health is full or <= 0.
8.  **(DONE) Modify `Game.js` - Add Base Sprite to Stage:**
    *   In `Game.initialize()`, after `this.base` is created, add `this.base.pixiContainer` to `this.app.stage`.

**Phase 2.B: General Asset Loading & Other Entities (Enemies DONE)**

9.  **(DONE) Centralized Asset Loading (Further Refinement):**
    *   Refactor remaining image loading (enemies, defenders, effects) to use `PIXI.Assets.load()`.
    *   Store loaded `PIXI.Texture` objects, potentially in a dedicated asset manager or within respective entity managers.
10. **(DONE) Enemy Rendering (`Enemy.js`, `EnemyManager.js`):**
    *   `Enemy.js`:
        *   Store `PIXI.Texture` instead of `Image` (or arrays of Textures for animations).
        *   Create and manage a `PIXI.Sprite` (or `PIXI.AnimatedSprite`) within a `PIXI.Container`.
        *   Old `render` method became obsolete.
        *   Will instantiate `HealthBarDisplay` (Phase 3.A).
        *   Hit flash logic implemented (Phase 3.C).
    *   `EnemyManager.js`:
        *   `loadSprite` (or equivalent) to fetch textures using `Assets.load()`.
        *   `createEnemy` passes textures; adds PIXI container to a stage container.
        *   Remove PIXI container on death.
        *   Old `render` method became obsolete.

**Rendering `spider_normal` (Enemy PixiJS Rendering - Part 1) (DONE)**
*   **A. (DONE) Asset Preparation (`EnemyManager.js`):**
    1.  **(DONE) Modify `EnemyManager.loadSprite(path)` to use `await PIXI.Assets.load(path)` and return the PixiJS asset.**
    2.  **(DONE) In `EnemyManager.load()`, after loading the sprite sheet asset for `spider_normal`:**
        *   **(DONE) Extract `PIXI.Texture[]` for each animation frame using `enemies.json` sprite details.**
        *   **(DONE) Store this texture array in `this.enemyTypes["spider_normal"].pixiTextures`.**
*   **B. (DONE) Enemy Entity Setup (`models/enemy.js`):**
    1.  **(DONE) Modify `Enemy.js` constructor:**
        *   **(DONE) Import `PIXI.Container`, `PIXI.AnimatedSprite`.**
        *   **(DONE) Add `this.pixiContainer = new PIXI.Container();` and `this.pixiSprite = null;`.**
        *   **(DONE) Create `this.pixiSprite = new PIXI.AnimatedSprite(passed_in_pixiTextures);`.**
        *   **(DONE) Configure `this.pixiSprite` (anchor, scale, animationSpeed, play).**
        *   **(DONE) Add `this.pixiSprite` to `this.pixiContainer`.**
        *   **(DONE) Set initial `this.pixiContainer.x/y` from enemy's logical `this.x/y`.**
*   **C. (DONE) Integration & Stage Management (`EnemyManager.js`, `Game.js`):**
    1.  **(DONE) Modify `EnemyManager.createEnemy("spider_normal")` (now ID-agnostic for this part):**
        *   **(DONE) Ensure it adds `enemy.pixiContainer` to `this.game.app.stage`.**
    2.  **(DONE) Modify `Enemy.js -> update()`:**
        *   **(DONE) Update `this.pixiContainer.x = this.x;` and `this.pixiContainer.y = this.y;`.**
    3.  **(DONE) Modify `EnemyManager.update()` for enemy removal:**
        *   **(DONE) When a Pixi-rendered enemy is removed, remove its `enemy.pixiContainer` from the stage/layer.**
        *   **(DONE) Call a new `enemy.destroyPixiObjects();`.**
    4.  **(DONE) Add `Enemy.js -> destroyPixiObjects()` to destroy its `pixiContainer` and `pixiSprite`.**
*   **D. (DONE) Cleanup (Old Rendering for `spider_normal`):**
    1.  **(DONE) Remove `Enemy.render(ctx)` method.**
    2.  **(DONE) Remove `EnemyManager.render(ctx)` method.**

### Phase 3: UI Elements & Effects (DONE for Base Health Bar & Enemy Hit Flash)

**Phase 3.A: Refactor Health Bar System (DONE FOR BASE)**

12. **(DONE FOR BASE) Game Configuration for Health Bars (`Game.js`, `gameConfig.json`):**
    *   Ensure `gameConfig.json` has a `ui.healthBar` section with fixed `width`, `height`, `padding` (optional), and `healthyColor`, `damagedColor`, `borderColor`, `borderThickness`.
    *   In `Game.js`, load this config and provide a getter (e.g., `getHealthBarConfig()`).
13. **(DONE FOR BASE) Create `healthBar.js` Helper Class:**
    *   **Constructor:** `(containerParent, spriteToFollow, gameInstance)` where `containerParent` is the entity's main container and `spriteToFollow` is the entity's main sprite.
        *   **Note on `parentVisual` logic:** `HealthBarDisplay`'s graphics object is added to `containerParent`. Its `update()` method uses `spriteToFollow` to get accurate dimensions and anchor points for positioning.
    *   Creates and stores `this.graphics = new PIXI.Graphics()`. Adds it as a child to `containerParent`.
    *   Fetches and stores `this.healthBarConfig = gameInstance.getHealthBarConfig()`.
    *   **`update(currentHp, maxHp)` method:**
        *   Calculates the position (`this.graphics.x`, `this.graphics.y`) for its graphics object to be centered above `spriteToFollow`.
        *   The drawing logic is self-contained within this `update` method, using the loaded config.
    *   **`setVisible(isVisible)` method:** Sets `this.graphics.visible`.
    *   **`destroy()` method:** Clears/destroys `this.graphics`.
14. **(DONE - Superseded) Review `utils/renderUtils.js` for Deletion:**
    *   The primary drawing logic previously in `drawHealthBar` (from `utils/renderUtils.js`) has been incorporated into `HealthBarDisplay.update()`.
    *   `utils/renderUtils.js` is temporarily kept as other entities (Enemies, Defenders) still depend on it. Its final deletion is noted in Phase 4 Cleanup (Step 21).
15. **(DONE FOR BASE) Integrate `healthBar.js` into Entities (e.g., `Base.js`):**
    *   In `Base.loadAssets()`: `this.healthBarDisplay = new HealthBarDisplay(this.pixiContainer, this.pixiSprite, this.game);`.
    *   In `Base.update()`: `this.healthBarDisplay.update(this.currentHp, this.maxHp);`.
    *   In `Base.takeDamage` and `Base.reset`: `this.healthBarDisplay.setVisible()` and `this.healthBarDisplay.update()` are called.
    *   In `Base.destroySelf()`: `this.healthBarDisplay.destroy()` is called.
    *   Old direct calls to `drawHealthBar` and related `healthBarGraphic` property removed from `Base.js`.

**Phase 3.C: Hit Flash Effect (DONE)**
    *   **E.1: (DONE) Asset & Configuration Preparation (`EnemyManager.js`)**
        1.  **(DONE) Shared Hit Spritesheet:** `assets/sprites/spider-hit.png` is used.
        2.  **(DONE) Spider Configuration File (`assets/spiderConfig.json`):** Contains common display properties (frameWidth, frameHeight, etc.) and hit effect properties (`hit.commonHitSpriteSheetPath`, `hit.enemyFlashDurationMs`).
        3.  **(DONE) Initialize Properties (Constructor):** In `EnemyManager.constructor`, initialize `this.commonSpiderConfig = null;` and `this.allProcessedTextureArrays = [];`.
        4.  **(DONE) Load Common Spider Config:** In `EnemyManager.load()` (make it `async`), load and parse `assets/spiderConfig.json` into `this.commonSpiderConfig`.
        5.  **(DONE) Implement Spritesheet Processing Helper:** Create a helper method in `EnemyManager` (e.g., `async _processSpritesheet(assetPath, frameConfig)`) that loads an image asset from `assetPath`, then uses `frameConfig` (from `this.commonSpiderConfig.display`) to cut it into and return an array of `PIXI.Texture[]`.
        6.  **(DONE) Process Common Hit Spritesheet:** In `EnemyManager.load()`, use the helper to process `this.commonSpiderConfig.hit.commonHitSpriteSheetPath` and store the result in `this.allProcessedTextureArrays[0]`.
        7.  **(DONE) Process Normal Enemy Spritesheets & Store Index:** In `EnemyManager.load()`, after loading `enemies.json` into `this.enemyDefinitions` (preserving order):
            *   Iterate through `this.enemyDefinitions`. For each `enemyDef`:
                *   Use the helper method (`_processSpritesheet`) with `enemyDef.sprite.path` and `this.commonSpiderConfig.display` to get its normal animation textures.
                *   Push these textures to `this.allProcessedTextureArrays`.
                *   Store the index of this new entry on the definition: `enemyDef.normalTextureArrayIndex = this.allProcessedTextureArrays.length - 1;`.
    *   **E.2: (DONE) `EnemyManager.createEnemy(enemyId)` - Passing Data to `Enemy` Instance:**
        *   Find the `enemyDef` for `enemyId` (this definition will have `normalTextureArrayIndex`).
        *   `normalTextures = this.allProcessedTextureArrays[enemyDef.normalTextureArrayIndex]`.
        *   `hitTextures = this.allProcessedTextureArrays[0]`.
        *   `flashDuration = this.commonSpiderConfig.hit.enemyFlashDurationMs`.
        *   Pass these to the `Enemy` constructor, along with any other relevant display properties from `this.commonSpiderConfig.display` (like anchor, scale, frameDuration for animationSpeed) if `Enemy.js` needs them for sprite setup.
    *   **E.3: (DONE) `Enemy.js` - Storing Data & Initializing Flash Properties:**
        1.  **(DONE) Constructor:** Accept `normalTextures` (enemy-specific), `hitTextures` (common), `flashDuration`. Store them. Initialize `isHitFlashing = false`, `hitFlashTimer = 0`. Stored `pixiTextures` as `this.normalAnimationFrames`.
    *   **E.4: (DONE) `Enemy.js` - Implementing Flash Logic:**
        1.  **(DONE) `hit()` Method:** Set `isHitFlashing = true`, `hitFlashTimer = this.flashDurationMs`. Swap `this.pixiSprite.textures` to `this.hitAnimationFrames`, maintaining `currentFrame` and playing state.
        2.  **(DONE) `update(deltaTime)` Method:** If `isHitFlashing`, decrement `hitFlashTimer`. If timer expires, revert `this.pixiSprite.textures` to `this.normalAnimationFrames`, maintaining `currentFrame` and playing state.
    *   **E.5: (DONE) Testing:** Trigger `enemy.hit()` via defender attacks. (Verified working by user).

---
## Key PixiJS Concepts

*   `PIXI.Application`, `PIXI.Assets` (or `PIXI.Loader`), `PIXI.Texture`, `PIXI.Sprite`, `PIXI.AnimatedSprite`, `PIXI.Graphics`, `PIXI.Container`, `app.stage`, `app.ticker`.
