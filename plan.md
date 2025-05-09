**Architectural Refactor: Generic Layer-Based Render Job System**

**Overall Goal:** Transition to a highly flexible rendering system. Entities generate "render jobs" (from a shared pool) and assign them to one of N generic render layers in `Game.js`. Each layer in `Game.js` can optionally perform depth-sorting on jobs that provide a `depth` value, allowing for a unified approach to y-sorting, z-indexing, and other layered effects.

**I. Core Architectural Changes:**

1.  **Generic Render Layers in `Game.js`:**
    *   `Game.js` defines a configurable number of generic render layers, managed as an array of queues (e.g., `this.layerQueues = [ [], [], [], ... ]`). The array index represents the layer's draw order (layer 0 drawn first, then layer 1 on top, etc.).
    *   The semantic meaning of each layer (e.g., "ground entities," "shadows," "UI") is by convention, decided by entities when they queue jobs.

2.  **Render Job Object Structure (and Shared Object Pool):**
    *   A standardized structure for "render job" objects. Each job includes:
        *   `depth`: (Optional) A numerical value. If provided, the job will be sorted within its layer based on this value (convention: higher values rendered on top).
        *   `data`: An object containing the `type` (e.g., `'sprite'`, `'rectangle'`) and all type-specific parameters for the draw call (image, coordinates, dimensions, color, etc.).
    *   **Shared Object Pool:** A single, global pool of render job objects, managed by `Game.js` (e.g., via `borrowJob()` and `returnJobToPool()` methods).

3.  **`Game.js` Manages Layer Queues:**
    *   `Game.js` holds the `layerQueues`. These are cleared each frame before entities populate them.

**II. Game Loop Structure in `Game.js`:**

1.  **`gameLoop(timestamp)`:**
    *   Calculate `deltaTime`.
    *   **Phase 1: Prepare Frame:** Clear all queues in `this.layerQueues`. Reset the render job object pool.
    *   **Phase 2: Update Game State:** Call `update(deltaTime)` on managers, which then call `update(deltaTime)` on entities (for game logic, state changes – **no render job queuing here**).
    *   **Phase 3: Collect Render Jobs:** Call `collectRenderJobs(layerQueues, jobPool)` on managers. Managers call `entity.queueRenderJobs(layerQueues, jobPool)` on entities. Entities borrow job objects, populate them (including `data` and optional `depth`), and push them to the appropriate, conventionally determined layer queue.
    *   **Phase 4: Render Frame:** For each `layerQueue` in `this.layerQueues` (sequentially by layer index):
        1.  Separate jobs in the current `layerQueue` into two groups: those *without* a `depth` value and those *with* a `depth` value.
        2.  **Render Non-Depth Jobs:** Execute render jobs from the "no depth" group (e.g., in submission order or another default).
        3.  **Render Depth-Sorted Jobs:** Sort jobs from the "with depth" group by their `depth` property (ascending). Execute these sorted render jobs.
        *   This two-step rendering (non-depth items, then depth-sorted items) occurs for each layer.
    *   Loop with `requestAnimationFrame`.

2.  **`executeRenderJob(job, ctx)` in `Game.js`:**
    *   Contains the actual canvas draw commands based on `job.data.type` and other info in `job.data`.

**III. Component Refactoring Responsibilities:**

1.  **`Game.js` (Orchestrator & Pool Manager):**
    *   Manages the job pool and the array of `layerQueues`.
    *   Orchestrates the distinct game loop phases.
    *   Implements the per-layer rendering logic (non-depth pass, then depth-sorted pass).
    *   Implements `executeRenderJob()`.

2.  **Entity Managers (`EnemyManager.js`, `DefenceManager.js`, `StrikeManager.js`):**
    *   `update(deltaTime)`: Focuses on entity game logic.
    *   `collectRenderJobs(layerQueues, jobPool)`: Iterates active entities, calling `entity.queueRenderJobs(layerQueues, jobPool)`.
    *   Remove old `render` methods.

3.  **Entity Classes (`Enemy.js`, `Defender.js`, `Striker.js`, etc.):**
    *   `update(deltaTime)`: Focuses on internal game logic.
    *   `queueRenderJobs(layerQueues, jobPool)` (called after entity's `update()`):
        *   Examines current state.
        *   Borrows job objects from `jobPool`.
        *   Populates job with `data` (including `type`) and optional `depth`.
        *   Pushes job to the conventionally determined layer queue in `layerQueues`.
    *   Remove old `render` methods.

**Key Outcomes:**

*   **Maximum Decoupling & Flexibility:** `Game.js` is highly agnostic. Entities have full control over which layer and depth their components render at.
*   **Unified Depth Sorting:** A single `depth` property handles various sorting needs within any layer.
*   **Performance Conscious:** Shared job pool and entities pushing to pre-defined layer queues.
*   **Maintainability & Extensibility:** Clear separation of concerns and easy to add new visual elements or layers by convention.
