# Game Reset Plan of Action

**Phase 1: Implement `resetForNewGame()` in `strikeManager.js`**
*(This part of the plan remains the same as it's not covered in `Game.reset()`)*
1.  Create a `resetForNewGame()` method in `strikeManager.js`.
    *   This method will:
        *   Reset `this.totalTargetDestructionR = 0;`
        *   Reset `this.cumulativeBombDamageDealtByStrikesR = 0;`
        *   Reset `this.averageBombDamageR = this.seedAverageBombDeltaR;` (its configured initial seed value).
        *   Reset all wave-specific properties (`currentWaveNumber`, `currentWaveStartTime`, `currentWaveStartTotalR`, `currentDn`, `K_current_wave`, `Rn_at_wave_start`, `Rn_at_last_bounty_checkpoint`, `bountyCollectedSinceLastCheckpoint`, `totalBountyForCurrentWave_Bn`, `projectedDurationCurrentWave_Tn`) to their initial zero/null states.
        *   Call `this.initializeBountyThreshold();` to recalculate `bountyUpdateThreshold_B_star` with the reset `averageBombDamageR`.
        *   Iterate through `this.strikers`, call `destroy()` on each active striker, and then clear the array: `this.strikers = [];`.

**Phase 2: Implement `resetForNewGame()` in `enemyManager.js`**
*(This method will handle the detailed cleanup that `Game.reset()` currently omits for enemies)*
1.  Create a `resetForNewGame()` method in `enemyManager.js`.
    *   This method will:
        *   Iterate through all enemies in `this.activeEnemies`. For each `enemy`:
            *   If `enemy.pixiContainer` exists and `enemy.pixiContainer.parent` is not null (i.e., it's on the stage/a layer), remove it: `enemy.pixiContainer.parent.removeChild(enemy.pixiContainer);`. (It's added to `this.game.groundLayer` in `createEnemy`).
            *   Call `enemy.destroyPixiObjects();` to clean up its sprites and health bar.
        *   After iterating and cleaning up, clear the main array: `this.activeEnemies = [];`.
        *   Reset other relevant `enemyManager` state:
            *   `this.currentWaveDeathDistances = [];`
            *   `this.lastDeathInfo = { distance: null, originalX: null, originalY: null };`

**Phase 3: Implement `resetForNewGame()` in `defenceManager.js`**
*(This method will handle the detailed cleanup that `Game.reset()` currently omits for defences and their effects like puddles)*
1.  Create a `resetForNewGame()` method in `defenceManager.js`.
    *   This method will:
        *   Iterate through all defences in `this.activeDefences`. For each `defence`:
            *   If `defence.pixiContainer` exists and `defence.pixiContainer.parent` is not null, remove it: `defence.pixiContainer.parent.removeChild(defence.pixiContainer);`. (It's added to `this.game.groundLayer` in `placeDefence`).
            *   Call `defence.destroyPixiObjects();` to clean up its sprites, health bar, and clear its internal puddle references.
        *   After iterating and cleaning up, clear the main array: `this.activeDefences = [];`.
        *   **Explicit Puddle Layer Cleanup:** To ensure all visual puddle effects are gone (as `DefenceEntity.destroyPixiObjects()` only clears its *references* and individual puddles expire over time), this method should also clear the `game.puddleLayer`:
            *   Check if `this.game && this.game.puddleLayer` exists.
            *   If so, iterate `this.game.puddleLayer.children`, call `destroy()` on each child graphic.
            *   Then call `this.game.puddleLayer.removeChildren();`.

**Phase 4: Modify `Game.reset()` in `game.js`**
*(Integrate the new manager-specific reset methods and ensure PIXI layers are fully cleared)*
1.  Locate the `reset()` method in `game.js` (around line 938).
2.  **Modify Enemy Manager Reset:**
    *   Replace the lines:
        ```javascript
        // if (this.enemyManager) {
        //     this.enemyManager.activeEnemies = [];
        //     this.enemyManager.currentWaveDeathDistances = [];
        //     this.enemyManager.lastDeathInfo = { distance: null, originalX: null, originalY: null };
        // }
        ```
    *   With a call to the new method:
        ```javascript
        if (this.enemyManager && typeof this.enemyManager.resetForNewGame === 'function') {
            this.enemyManager.resetForNewGame();
        }
        ```
3.  **Modify Defence Manager Reset:**
    *   Replace the lines:
        ```javascript
        // if (this.defenceManager) {
        //     this.defenceManager.activeDefences = [];
        //     // TODO: Reset any other state within DefenceManager if needed
        // }
        ```
    *   With a call to the new method:
        ```javascript
        if (this.defenceManager && typeof this.defenceManager.resetForNewGame === 'function') {
            this.defenceManager.resetForNewGame();
        }
        ```
4.  **Add Strike Manager Reset:**
    *   Add a new block to call the `strikeManager`'s reset method:
        ```javascript
        if (this.strikeManager && typeof this.strikeManager.resetForNewGame === 'function') {
            this.strikeManager.resetForNewGame();
        }
        ```
5.  **Ensure PIXI Layer Cleanup (Safeguard):**
    *   While the manager `resetForNewGame` methods should handle removing their specific entities from layers like `groundLayer` and `puddleLayer`, it's a good safeguard to explicitly clear these layers in `Game.reset()` *after* the manager resets have run. This ensures no stray PIXI objects remain.
    *   Add the following towards the end of `Game.reset()` (before any re-initialization logic if present, but after manager resets):
        ```javascript
        if (this.groundLayer) {
            // Children should have been destroyed by manager resets,
            // so just removing them should be sufficient.
            this.groundLayer.removeChildren();
        }
        if (this.effectsLayer) {
            // Destroy children explicitly if they are not managed elsewhere
            // and then remove them.
            this.effectsLayer.children.forEach(child => {
                if (typeof child.destroy === 'function') {
                    child.destroy({ children: true, texture: true, baseTexture: true }); // Thorough cleanup
                }
            });
            this.effectsLayer.removeChildren();
        }
        // The puddleLayer cleanup is now primarily handled by defenceManager.resetForNewGame().
        // If an additional safeguard is desired here:
        // if (this.puddleLayer) {
        //     this.puddleLayer.children.forEach(child => child.destroy()); // Assuming children are PIXI.Graphics
        //     this.puddleLayer.removeChildren();
        // }
        ```
    *   The `placementPreviewGraphic` should also be cleared/hidden if it's not already handled:
        ```javascript
        if (this.placementPreviewGraphic) {
            this.placementPreviewGraphic.clear();
            this.placementPreviewGraphic.visible = false;
        }
        ```
