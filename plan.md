# PixiJS Refactoring Plan

This plan outlines the steps to refactor the game's rendering pipeline to use PixiJS.

## Phase 1: Core Setup & Background

1.  **Install & Initialize PixiJS:**
    *   Add PixiJS to the project.
    *   In `Game.js`, create `PIXI.Application`, append `app.view` to the container.
    *   **Crucially, remove old canvas/layer creation (`this.layers`, `this.bgCanvas`, `this.fgCanvas`, `this.bgCtx`, `this.fgCtx`).**
2.  **Background Rendering:**
    *   Load background image using `PIXI.Assets.load()`.
    *   Create a `PIXI.Sprite` for the background and add it to the PixiJS stage.
    *   Remove the old `Game.drawBackground` method.
3.  **Gut Old `Game.render()` Method:**
    *   The existing `Game.render()` method, which previously orchestrated drawing to the old canvas contexts, will be effectively emptied or removed at this stage. Its calls to manager `render` methods (e.g., `enemyManager.render(ctx)`) will cease as the contexts are no longer available.
    *   The new role of the game loop with PixiJS will be established in Phase 4.

## Phase 2: Asset Loading & Basic Entity Rendering

4.  **Centralized Asset Loading:**
    *   Refactor all image loading (enemies, defenders, effects) to use `PIXI.Assets.load()`.
    *   Store loaded `PIXI.Texture` objects.
5.  **Enemy Rendering (`Enemy.js`, `EnemyManager.js`):**
    *   `Enemy.js`:
        *   Store `PIXI.Texture` instead of `Image`.
        *   Create and manage a `PIXI.Sprite` (or `PIXI.AnimatedSprite`).
        *   `render` method updates sprite properties (position, texture).
    *   `EnemyManager.js`:
        *   `loadSprite` to fetch textures.
        *   `createEnemy` passes textures; adds PIXI sprite to a stage container.
        *   Remove PIXI sprite on death.
        *   Old `render` method (if any was called by `Game.render`) becomes obsolete.
6.  **Defender Rendering (`Defender.js`, `DefenceManager.js`):**
    *   Apply similar changes as for Enemies:
        *   Store/use `PIXI.Texture` and `PIXI.Sprite`.
        *   Update sprite properties in `Defender.js`.
        *   `DefenceManager.js` handles PIXI sprite creation/removal and adding to stage.
        *   Old `render` method (if any was called by `Game.render`) becomes obsolete.

## Phase 3: UI Elements & Effects

7.  **Health Bars:**
    *   Refactor `drawHealthBar` to create/update `PIXI.Graphics` objects for health display.
8.  **Placement Preview (`Game.js`):**
    *   Use `PIXI.Graphics` to draw the preview square.
9.  **Defender Effects (Puddles in `Defender.js`):**
    *   Represent puddles with `PIXI.Graphics` objects, add/remove from an effects container.
10. **Strike Manager Z-Buffer/Heatmap (`StrikeManager.js`):**
    *   `renderZBuffer` to use `PIXI.Graphics` to draw the heatmap cells.
11. **Striker Explosion Animation (`Striker.js`, `StrikeManager.js`):**
    *   Load explosion frames as a sequence of `PIXI.Texture`s.
    *   `Striker.js` creates and plays a `PIXI.AnimatedSprite` for explosions, adding it to an effects container and removing it on completion.

## Phase 4: Main Render Loop & Cleanup

12. **New Main Render Loop (`Game.js`):**
    *   The primary game loop for rendering is now driven by PixiJS `Application.ticker`.
    *   The `Game.update()` method will still handle game logic updates.
    *   If a `Game.render()` method is kept, its role will shift from direct drawing to potentially triggering high-level PixiJS updates if not handled by individual entity `update` methods, or it might be removed entirely if the ticker and entity updates cover all needs.
    *   Updates involve changing PIXI object properties (position, texture, visibility).
    *   Y-sorting managed via `PIXI.Container` `sortableChildren` and `zIndex`, or manual reordering.
13. **Cleanup:**
    *   Ensure all old direct canvas `ctx` drawing calls are removed from all files.
    *   Remove obsolete canvas properties and utility functions.
    *   Update event handling for PixiJS interactive objects if needed.

## Key PixiJS Concepts

*   `PIXI.Application`, `PIXI.Assets` (or `PIXI.Loader`), `PIXI.Texture`, `PIXI.Sprite`, `PIXI.AnimatedSprite`, `PIXI.Graphics`, `PIXI.Container`, `app.stage`, `app.ticker`.
