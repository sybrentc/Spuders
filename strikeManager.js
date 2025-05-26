import { distanceBetween } from './utils/geometryUtils.js';
import Striker from './models/striker.js';
import * as PIXI from 'pixi.js';

export default class StrikeManager {
    constructor(game) {
        if (!game) {
            throw new Error("StrikeManager requires a valid Game instance.");
        }
        this.game = game;
        this.defenceManager = game.defenceManager;

        // Initialize all state categories
        this.initStaticState();
        this.initInitializedState();
        this.initRuntimeState();
    }

    /**
     * Initializes static state variables that are loaded from config and never change.
     * These are the raw configuration values.
     */
    initStaticState() {
        // Config properties
        this.targetMaxWipeoutRadiusPercent = null;
        this.zBufferResolution = null;
        this.stampMapResolution = null;
        this.configLoaded = false;
        this.targetDamageUpdatePoints = null;
        this.minWearDecrementForPayload = 0;
        this.seedAverageBombDeltaR = 0;
        this.impactStdDevPixels = null;
        this.explosionAnimationConfig = null;
        this.strikeFloorSafetyMarginPercent = 0.0; // ADDED: Safety margin for strike floor
        this.strikeCooldownDurationSeconds = 10.0; // ADDED: Cooldown duration
    }

    /**
     * Initializes state that is calculated/set up after config is loaded.
     * These values persist across game resets.
     */
    initInitializedState() {
        // Z-buffer/grid properties
        this.zBuffer = null;
        this.gridWidth = 0;
        this.gridHeight = 0;
        this.cellWidth = 0;
        this.cellHeight = 0;
        this.mapWidth = 0;
        this.mapHeight = 0;

        // Stamp map properties
        this.stampMap = null;
        this.stampMapCenterCol = 0;
        this.stampMapCenterRow = 0;

        // Animation properties
        this.explosionFrames = [];
        this.explosionFrameWidth = 0;
        this.explosionFrameHeight = 0;
        this.explosionFrameDuration = 0;
        this.explosionScale = 1.0;
        this.explosionAnchorX = 0.5;
        this.explosionAnchorY = 0.5;
        this.loadedAnimationData = null;
        this.strikerShadowData = null;
        this.pixiExplosionAnimationData = null;

        // Bomb properties
        this.bombStrengthA = null;
        this.bombPayload = null;
        this.averageBombDamageR = null;

        // ADDED: Cooldown state
        this.strikeCooldownActive = false;
        this.strikeCooldownEndTime = 0;
    }

    /**
     * Initializes runtime state variables that reset with each game.
     * These are the values that change during gameplay.
     */
    initRuntimeState() {
        // Wave-specific properties
        this.currentWaveNumber = 0;
        this.currentWaveStartTime = 0;
        this.currentWaveStartTotalR = 0;
        this.currentDn = 0;

        // Target damage and bounty properties
        this.totalTargetDestructionR = 0;
        this.K_current_wave = null;
        this.Rn_at_wave_start = 0;
        this.Rn_at_last_bounty_checkpoint = 0;
        this.bountyCollectedSinceLastCheckpoint = 0;
        this.cumulativeBountyThisWave = 0;
        this.bountyUpdateThreshold_B_star = Infinity;
        this.totalBountyForCurrentWave_Bn = 0;
        this.projectedDurationCurrentWave_Tn = 0;

        // Bomb damage tracking
        this.totalBombDamageDealtR = 0;
        this.cumulativeBombDamageDealtByStrikesR = 0;

        // Strikers
        this.strikers = [];
        this.nextStrikerId = 0;

        // Heatmap properties
        this.renderHeatmapDebug = false;
        this.heatmapDrawingGraphic = new PIXI.Graphics();
        this.heatmapRenderTexture = null;
        this.heatmapSprite = null;
        this._spareNormal = null; // Initialize for _generateNormalRandom

        // ADDED: Cache for Rn(B) calculation (Eq. 50)
        this._cachedRnB_C1 = null;
        this._cachedRnB_P = null;
        this._cachedRnB_C2 = null;
        this._cachedRnB_R_start_n = null;
        this._cachedRnB_alpha_inv = null;
        this._cachedRnB_useLinear = false;
        this._cachedRnB_waveNumber = -1; // Tracks if cache is valid for current wave

        // ADDED: Cooldown state
        this.strikeCooldownActive = false;
        this.strikeCooldownEndTime = 0;
    }

    _getCurrentWaveAverageBountyRate() {
        if (this.projectedDurationCurrentWave_Tn === 0) {
            // Avoid division by zero if projected duration is not set or is zero.
            // This might happen if the wave hasn't properly started or data is missing.
            console.warn("StrikeManager._getCurrentWaveAverageBountyRate: projectedDurationCurrentWave_Tn is 0. Cannot calculate bounty rate.");
            return 0; 
        }
        if (typeof this.totalBountyForCurrentWave_Bn !== 'number' || typeof this.projectedDurationCurrentWave_Tn !== 'number') {
            console.warn("StrikeManager._getCurrentWaveAverageBountyRate: Missing or invalid bounty/duration data for current wave.");
            return 0;
        }
        return this.totalBountyForCurrentWave_Bn / this.projectedDurationCurrentWave_Tn;
    }

    _cloneDefenderForSimulation(originalDefender) {
        if (!originalDefender) {
            console.warn("StrikeManager._cloneDefenderForSimulation: Missing original defender.");
            return null;
        }

        // Create an object that inherits from originalDefender's prototype (e.g., DefenceEntity.prototype)
        const clone = Object.create(Object.getPrototypeOf(originalDefender));

        // Copy own enumerable properties from the originalDefender to the clone.
        // This includes properties like id, x, y, hp, maxHp, wearEnabled, isDestroyed, gridCol, gridRow, definition, game, etc.
        // Crucially, 'hp' and 'isDestroyed' will be copied as own properties onto the clone.
        // When 'clone.hit()' is called, 'this' will refer to 'clone'.
        // If 'hit' modifies 'this.hp', it will modify the 'hp' property on the 'clone' object itself,
        // shadowing any 'hp' property that might exist on the prototype (which it shouldn't for instance state).
        for (const prop in originalDefender) {
            if (Object.prototype.hasOwnProperty.call(originalDefender, prop)) {
                clone[prop] = originalDefender[prop];
            }
        }
        
        // Ensure 'hp' is definitely an own property on the clone, copied from the original.
        // This is important so that modifications to clone.hp don't affect other instances or the prototype.
        // The loop above should handle this, but an explicit assignment is safest for critical state.
        clone.hp = originalDefender.hp;
        clone.isDestroyed = originalDefender.isDestroyed; // Also ensure this is an own property

        // The Striker needs:
        // - clone.x, clone.y (copied)
        // - clone.hp, clone.maxHp (hp is now an own property on clone, maxHp copied)
        // - clone.isDestroyed (now an own property on clone)
        // - clone.wearEnabled (copied)
        // - clone.hit (inherited from prototype, 'this' will correctly be the clone)
        return clone;
    }

    _generateNormalRandom(mean, stdDev) {
        // Box-Muller transform
        // this._spareNormal is a property that should be initialized in the constructor or relevant state
        // For StrikeManager, since this is now a utility here, ensure `this._spareNormal` is handled.
        // It's better to make _spareNormal a local static-like variable or handle it per call if this is purely a utility.
        // Let's assume strikeManager might have `this._spareNormal` if it calls this multiple times in a sequence for one operation.
        // For a single strike operation, it might be reset or managed locally within _calculateImpactCoordinates if only called once per strike.
        // For now, let's assume `this._spareNormal` exists on StrikeManager instance and is managed appropriately.
        if (this._spareNormal !== undefined && this._spareNormal !== null) { // Check for undefined as well as null
            const result = mean + stdDev * this._spareNormal;
            this._spareNormal = null;
            return result;
        }

        let u1, u2;
        do {
            u1 = Math.random();
        } while (u1 === 0); // Avoid Math.log(0)
        u2 = Math.random();

        const radius = Math.sqrt(-2.0 * Math.log(u1));
        const angle = 2.0 * Math.PI * u2;

        const standardNormal1 = radius * Math.cos(angle);
        const standardNormal2 = radius * Math.sin(angle);

        this._spareNormal = standardNormal2; // Store the spare for next call

        return mean + stdDev * standardNormal1;
    }

    _calculateImpactCoordinates(targetCoords, bombPayload) {
        if (!targetCoords) {
            console.error("StrikeManager._calculateImpactCoordinates: targetCoords not available.");
            return { x: 0, y: 0 };
        }
        if (!bombPayload || typeof bombPayload.impactStdDevPixels !== 'number') {
            console.error("StrikeManager._calculateImpactCoordinates: bombPayload or impactStdDevPixels not available/valid.");
            return { ...targetCoords }; // Return a copy
        }

        const stdDev = bombPayload.impactStdDevPixels;

        if (stdDev <= 0) {
            return { ...targetCoords }; // Return a copy if no randomness
        }

        const offsetX = this._generateNormalRandom(0, stdDev);
        const offsetY = this._generateNormalRandom(0, stdDev);

        // Ensure this._spareNormal is reset for the next independent calculation if _generateNormalRandom is used elsewhere.
        // If _calculateImpactCoordinates is the sole user for a given strike, this is fine.
        // Resetting it here to ensure independence if called multiple times for different purposes.
        this._spareNormal = null; 

        const impactX = targetCoords.x + offsetX;
        const impactY = targetCoords.y + offsetY;

        return { x: impactX, y: impactY };
    }

    async loadConfig(mapWidth, mapHeight, path = 'public/assets/strike.json') {
        try {
            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`HTTP error loading strike config! status: ${response.status}`);
            }
            const config = await response.json();

            // Load static config values
            this.targetMaxWipeoutRadiusPercent = config.targetMaxWipeoutRadiusPercent;
            this.zBufferResolution = config.zBufferResolution;
            this.stampMapResolution = config.stampMapResolution;
            this.targetDamageUpdatePoints = config.targetDamageUpdatePoints;
            this.seedAverageBombDeltaR = config.empiricalAverageBombDeltaR || 0;
            this.impactStdDevPixels = config.impactStdDevPercentWidth * mapWidth;
            this.explosionAnimationConfig = config.explosionAnimation;
            this.strikeFloorSafetyMarginPercent = config.strikeFloorSafetyMarginPercent || 0.0; // ADDED: Load safety margin
            this.strikeCooldownDurationSeconds = config.strikeCooldownDurationSeconds !== undefined ? config.strikeCooldownDurationSeconds : 10.0; // ADDED: Load cooldown
            this.strikeCooldownDurationMs = this.strikeCooldownDurationSeconds * 1000; // ADDED: Convert to MS

            // Set map dimensions
            this.mapWidth = mapWidth;
            this.mapHeight = mapHeight;

            // Calculate grid properties
            this.gridWidth = this.zBufferResolution.width;
            this.gridHeight = this.zBufferResolution.height;
            this.cellWidth = this.mapWidth / this.gridWidth;
            this.cellHeight = this.mapHeight / this.gridHeight;

            // Initialize Z-buffer
            this.zBuffer = Array(this.gridHeight).fill(null).map(() => Array(this.gridWidth).fill(0));

            // Mark config as loaded
            this.configLoaded = true;

            // Perform post-config initialization
            this._precomputeStampMap();
            await this._loadExplosionFrames();
            await this._loadShadowTexture(config.strikerShadow);
            this._initializeHeatmapPixiObjects();

            // Seed initial values
            this.averageBombDamageR = this.seedAverageBombDeltaR;

        } catch (error) {
            console.error("StrikeManager: Failed to load configuration:", error);
            this.configLoaded = false;
            throw error;
        }
    }

    /**
     * Called by Game when all managers are loaded and game state is initialized.
     * This is the proper time to calculate dependent values that require
     * access to other managers and game state.
     */
    onGameInitialized() {
        if (!this.configLoaded) {
            console.error("StrikeManager.onGameInitialized: Config not loaded. Cannot initialize dependent calculations.");
            return;
        }
        this.updateDependentCalculations();
    }

    /**
     * Checks if all dependencies are ready and updates dependent calculations.
     * Called by Game when defence manager is loaded or when game state changes.
     */
    updateDependentCalculations() {
        if (!this.configLoaded || !this.defenceManager || !this.defenceManager.isLoaded) {
            console.warn("StrikeManager.updateDependentCalculations: Dependencies not ready. Skipping calculations.");
            return;
        }

        // Calculate bomb strength if not already calculated
        if (this.bombStrengthA === null) {
            this.calculateBombStrength();
        }

        // Update bounty threshold if we have all required values
        if (this.averageBombDamageR !== null && this.targetDamageUpdatePoints > 0) {
            this._updateBountyThreshold();
        }
    }

    // --- ADDED: Method to calculate bomb strength dynamically ---
    calculateBombStrength() {
        if (!this.configLoaded || !this.defenceManager) {
            console.error("StrikeManager.calculateBombStrength: Cannot calculate, config or DefenceManager not ready.");
            return;
        }
        if (!this.defenceManager.isLoaded) {
             console.warn("StrikeManager.calculateBombStrength: DefenceManager definitions not loaded yet. Skipping calculation. bombStrengthA remains null.");
             this.minWearDecrementForPayload = 0; // Ensure it's reset if definitions not loaded
             this._tryAssembleBombPayload();
             return;
        }

        const definitions = this.defenceManager.getDefinitions();
        let minWearDecrement = Infinity;

        // Find the minimum *non-zero* wear decrement across all definitions
        for (const id in definitions) {
            const stats = definitions[id]?.stats;
            if (stats && stats.wearEnabled && typeof stats.wearDecrement === 'number' && stats.wearDecrement > 1e-9) { // Use a small epsilon to avoid floating point issues near zero
                minWearDecrement = Math.min(minWearDecrement, stats.wearDecrement);
            }
        }

        if (!isFinite(minWearDecrement)) {
            console.error("StrikeManager.calculateBombStrength: Could not find a valid minimum non-zero wear decrement. Cannot calculate Bomb Strength A. Ensure wear is enabled and calculated for at least one defender.");
            this.bombStrengthA = 0;
            this.minWearDecrementForPayload = 0; // Fallback to zero if none found
            this._tryAssembleBombPayload();
            return;
        }

        this.minWearDecrementForPayload = minWearDecrement; // Store for payload

        // Calculate target radius in pixels
        const targetRadiusPx = this.targetMaxWipeoutRadiusPercent * this.mapWidth;

        // Calculate A = r^2 * h_min (where h_min is minWearDecrement)
        const calculatedA = targetRadiusPx * targetRadiusPx * minWearDecrement;
        this.bombStrengthA = Math.max(0, calculatedA); 

        this._tryAssembleBombPayload(); 
    }
    // --- END ADDED ---

    // --- Helper Function Stubs ---

    _calculateWipeoutRadius(scaledHealth) {
        if (scaledHealth <= 0 || this.bombStrengthA <= 0) {
            return 0;
        }
        return Math.sqrt(this.bombStrengthA / scaledHealth);
    }

    _world2grid(worldX, worldY) {
        if (this.cellWidth <= 0 || this.cellHeight <= 0) {
            console.error("StrikeManager._world2grid: Cell dimensions are not positive.");
            return { col: 0, row: 0 }; // Avoid division by zero
        }

        const col = Math.floor(worldX / this.cellWidth);
        const row = Math.floor(worldY / this.cellHeight);

        // Clamp values to be within grid bounds
        const clampedCol = Math.max(0, Math.min(col, this.gridWidth - 1));
        const clampedRow = Math.max(0, Math.min(row, this.gridHeight - 1));

        return { col: clampedCol, row: clampedRow };
    }

    _grid2world(col, row) {
        const worldX = (col + 0.5) * this.cellWidth;
        const worldY = (row + 0.5) * this.cellHeight;
        return { x: worldX, y: worldY };
    }

    _precomputeStampMap() {
        if (!this.stampMapResolution || !this.configLoaded) {
            console.error("StrikeManager._precomputeStampMap: Cannot precompute stamp map, config not loaded or resolution missing.");
            return;
        }

        const stampWidth = this.stampMapResolution.width;
        const stampHeight = this.stampMapResolution.height;

        // Ensure dimensions are odd for a true center
        if (stampWidth % 2 === 0 || stampHeight % 2 === 0) {
            console.warn(`StrikeManager._precomputeStampMap: Stamp map dimensions (${stampWidth}x${stampHeight}) should ideally be odd for a perfect center. Using floor for center calculation.`);
            // Calculation will still work, but symmetry might be slightly off depending on usage
        }

        this.stampMap = Array(stampHeight).fill(null).map(() => Array(stampWidth).fill(0));
        this.stampMapCenterCol = Math.floor(stampWidth / 2); // Use floor, works for odd/even
        this.stampMapCenterRow = Math.floor(stampHeight / 2);

        // Get world coordinates of the center of the central stamp map cell
        // Note: _grid2world uses the Z-BUFFER's cellWidth/Height for conversion
        const originWorldPos = this._grid2world(this.stampMapCenterCol, this.stampMapCenterRow);

        for (let r = 0; r < stampHeight; r++) {
            for (let c = 0; c < stampWidth; c++) {
                const currentWorldPos = this._grid2world(c, r);
                const dist = distanceBetween(originWorldPos, currentWorldPos);
                this.stampMap[r][c] = dist;
            }
        }
    }

    // --- Main Logic Stubs ---

    calculateZBuffer() {
        if (!this.configLoaded || !this.stampMap) {
            // Don't run if config or stamp map aren't ready
            return;
        }

        const defenders = this.defenceManager.getActiveDefences();

        // --- Optimization: Sort defenders by ID to minimize earning rate lookups --- 
        defenders.sort((a, b) => {
            if (a.id < b.id) return -1;
            if (a.id > b.id) return 1;
            return 0;
        });
        // --- End Optimization ---

        // --- State for optimization ---
        let currentDefenderTypeId = null;
        let currentEarningRate = 0;
        // --- End State ---

        // Clear the Z-buffer (fill with zeros)
        for (let r = 0; r < this.gridHeight; r++) {
            this.zBuffer[r].fill(0);
        }

        // Iterate through each active defender
        for (const defender of defenders) { // Looping through SORTED defenders
            const hp = defender.hp; // This is the scaled health
            const defenderGridCol = defender.gridCol;
            const defenderGridRow = defender.gridRow;

            // Skip if defender has no health, no grid position yet, OR if wear is not enabled
            if (hp <= 0 || defenderGridCol === null || !defender.wearEnabled) {
                continue;
            }

            // --- Optimization: Check if defender type changed ---
            if (defender.id !== currentDefenderTypeId) {
                currentDefenderTypeId = defender.id;
                // Look up earning rate ONCE per type change
                currentEarningRate = this.defenceManager.getEarningRateForType(currentDefenderTypeId);
                // Validate the fetched rate
                if (!currentEarningRate || currentEarningRate <= 0 || !isFinite(currentEarningRate)) {
                     // console.warn(`StrikeManager: Invalid earning rate (${currentEarningRate}) for type ${currentDefenderTypeId}. Skipping its Z-buffer contribution.`); // Optional log
                     currentEarningRate = 0; // Set to 0 to skip processing below
                }
            }
            // --- End Optimization Check ---

            // Skip processing if this defender type has no valid earning rate
            if (currentEarningRate <= 0) {
                continue;
            }

            // Calculate the wipeout radius in world units
            const wipeoutRadius = this._calculateWipeoutRadius(hp);
            if (wipeoutRadius <= 0) {
                continue;
            }

            // Calculate bounding box half-width in grid cell units
            // Use Math.min for cell dimensions if they aren't guaranteed square
            const minCellDim = Math.min(this.cellWidth, this.cellHeight);
            if (minCellDim <= 0) continue; // Avoid division by zero
            const radiusInCells = Math.ceil(wipeoutRadius / minCellDim);

            // Iterate through the bounding box using offsets relative to the defender's grid cell
            for (let offsetRow = -radiusInCells; offsetRow <= radiusInCells; offsetRow++) {
                for (let offsetCol = -radiusInCells; offsetCol <= radiusInCells; offsetCol++) {

                    // Calculate target Z-buffer indices
                    const targetCol = defenderGridCol + offsetCol;
                    const targetRow = defenderGridRow + offsetRow;

                    // Bounds Check 1: Z-buffer
                    if (targetCol < 0 || targetCol >= this.gridWidth || targetRow < 0 || targetRow >= this.gridHeight) {
                        continue;
                    }

                    // Calculate lookup indices for the stamp map
                    const stampCol = this.stampMapCenterCol + offsetCol;
                    const stampRow = this.stampMapCenterRow + offsetRow;

                    // Bounds Check 2: Stamp Map
                    if (stampCol < 0 || stampCol >= this.stampMapResolution.width || stampRow < 0 || stampRow >= this.stampMapResolution.height) {
                        // This offset is outside the precomputed area, assume it's outside the radius
                        continue;
                    }

                    // Look up pre-calculated distance from the stamp map
                    const distanceFromStamp = this.stampMap[stampRow][stampCol];

                    // Compare distance and increment Z-buffer if within radius
                    if (distanceFromStamp <= wipeoutRadius) {
                        // Add the cached earning rate for this defender type
                        this.zBuffer[targetRow][targetCol] += currentEarningRate; 
                    }
                }
            }
        }
    }

    // --- ADDED: Target Finding Logic ---
    findOptimalTarget() {
        if (!this.configLoaded || !this.zBuffer) {
            console.error("StrikeManager.findOptimalTarget: Cannot find target, config or zBuffer not ready.");
            return null;
        }

        // 1. Find Max Z-Value (same logic as in renderZBuffer)
        let maxZ = 0;
        for (let r = 0; r < this.gridHeight; r++) {
            for (let c = 0; c < this.gridWidth; c++) {
                if (this.zBuffer[r][c] > maxZ) {
                    maxZ = this.zBuffer[r][c];
                }
            }
        }

        // If maxZ is 0, it means no defenders contributed, no valid target
        if (maxZ <= 0) {
            // console.log("StrikeManager.findOptimalTarget: No potential targets found (maxZ = 0)."); // Optional log
            return null;
        }

        // 2. Identify all cells with the maximum Z-value
        const optimalCells = [];
        for (let r = 0; r < this.gridHeight; r++) {
            for (let c = 0; c < this.gridWidth; c++) {
                if (this.zBuffer[r][c] === maxZ) {
                    optimalCells.push({ col: c, row: r }); // Store coordinates
                }
            }
        }

        // Should not happen if maxZ > 0, but as a safeguard
        if (optimalCells.length === 0) {
             console.error("StrikeManager.findOptimalTarget: Found maxZ > 0 but no optimal cells. This indicates an error.");
             return null;
        }

        // 3. Randomly select one of the optimal cells
        const randomIndex = Math.floor(Math.random() * optimalCells.length);
        const selectedCell = optimalCells[randomIndex];

        // 4. Convert the selected cell's grid coordinates to world coordinates (center of the cell)
        const targetWorldCoords = this._grid2world(selectedCell.col, selectedCell.row);

        // console.log(`StrikeManager.findOptimalTarget: Found ${optimalCells.length} optimal cell(s) with z=${maxZ}. Selected [${selectedCell.col}, ${selectedCell.row}] -> World (${targetWorldCoords.x.toFixed(1)}, ${targetWorldCoords.y.toFixed(1)})`); // Optional log
        return targetWorldCoords;
    }
    // --- END ADDED ---

    // --- ADDED: Method to calculate required damage rate dn ---
    /**
     * Calculates the required fractional damage rate (dn) for a given wave number.
     * Uses Eq. 30: dn = (1 / alpha) - w + (1 / Tn) * (1 - (f / gamma_n))
     * where gamma_n = Tn+1 / Tn. Alpha (defender cost factor) and w (wear rate)
     * are fetched from the game instance.
     * @param {number} waveNumber - The wave number (n) to calculate dn for.
     * @returns {number} The calculated dn, or 0 if calculation fails or dn < 0.
     * @private
     */
    _calculateDn(waveNumber) {
        if (!this.game || !this.game.waveManager || !this.game.enemyManager || typeof this.game.getAlpha !== 'function' || typeof this.game.getWearParameter !== 'function') {
            console.error("StrikeManager._calculateDn: Missing required game managers, getAlpha, or getWearParameter methods.");
            return 0;
        }

        // 1. Get Parameters
        const f = this.game.waveManager.getDifficultyIncreaseFactor();
        const L = this.game.getTotalPathLength();
        const s_min = this.game.enemyManager.getMinimumEnemySpeed();
        const Tn = this.game.waveManager.getWaveDurationSeconds(waveNumber);
        const Tn_plus_1 = this.game.waveManager.getWaveDurationSeconds(waveNumber + 1);

        const alpha = this.game.getAlpha();
        const wearRateW = this.game.getWearParameter();

        console.log(`[StrikeManager._calculateDn W:${waveNumber}] Inputs: f=${f}, L=${L}, s_min=${s_min}, Tn=${Tn}, Tn+1=${Tn_plus_1}, alpha=${alpha}, W=${wearRateW}`);

        // 2. Validate Parameters
        if (f === undefined || f === null || f <= 0) { // f must be > 0, typically > 1 for difficulty increase
            console.error(`StrikeManager._calculateDn: Invalid difficulty increase factor (f=${f}). Must be > 0.`);
            return 0;
        }
        if (L === undefined || L === null || L <= 0) {
            console.error(`StrikeManager._calculateDn: Invalid total path length (L=${L}). Must be > 0.`);
            return 0;
        }
        if (s_min === undefined || s_min === null || s_min <= 0) {
            // This T0 calculation was not part of Eq. 30 directly, but Tn and gamma_n are.
            // The T0 term was from Eq. 32. Removing T0 from direct calculation here.
            // console.error(`StrikeManager._calculateDn: Invalid minimum enemy speed (s_min=${s_min}). Must be > 0.`);
            // return 0;
        }
        if (Tn === undefined || Tn === null || Tn <= 1e-6) { // Use epsilon for duration check
            console.warn(`StrikeManager._calculateDn: Invalid duration Tn (${Tn}) for wave ${waveNumber}. Cannot calculate dn.`);
            return 0;
        }
        if (Tn_plus_1 === undefined || Tn_plus_1 === null || Tn_plus_1 <= 1e-6) {
            console.warn(`StrikeManager._calculateDn: Invalid duration Tn+1 (${Tn_plus_1}) for wave ${waveNumber}. Cannot calculate dn.`);
            return 0;
        }
        if (alpha === undefined || alpha === null || alpha <= 0) {
            console.error(`StrikeManager._calculateDn (Eq.30): Invalid alpha (${alpha}). Must be > 0.`);
            return 0;
        }
        if (wearRateW === undefined || wearRateW === null || wearRateW < 0) {
            console.warn(`StrikeManager._calculateDn (Eq.30): Invalid wearRateW (${wearRateW}). Assuming 0 or handling error.`);
            return 0; // Or assign wearRateW = 0 if that's acceptable.
        }

        // 3. Calculate Intermediate Values
        // T0 is not directly in Eq. 30. The terms are 1/alpha, w, and the timing term.
        // const T0 = L / s_min; // Not needed for Eq. 30 directly
        // if (T0 <= 0) {
        //     console.error(`StrikeManager._calculateDn: Calculated T0 (${T0}) is not positive.`);
        //     return 0;
        // }

        const gamma_n = Tn_plus_1 / Tn;
        if (!isFinite(gamma_n) || gamma_n <= 0) { // gamma_n must be positive
            console.warn(`StrikeManager._calculateDn (Eq.30): Invalid gamma_n (${gamma_n}) calculated for wave ${waveNumber}.`);
            return 0;
        }
        console.log(`[StrikeManager._calculateDn W:${waveNumber}] Calculated gamma_n: ${gamma_n}`);

        // 4. Calculate dn using Eq. 30
        const term_1_alpha = 1 / alpha;
        // wearRateW is already fetched
        
        // Defensive check for division by zero if f = 0 and gamma_n = 0, though gamma_n check above helps.
        // Also f should be > 0.
        let timing_factor_content = 0;
        if (gamma_n !== 0) { // Ensure gamma_n is not zero before division
             timing_factor_content = 1 - (f / gamma_n);
        } else {
            // This case should be caught by gamma_n <= 0 check, but as an extra safeguard
            console.warn(`StrikeManager._calculateDn (Eq.30): gamma_n is zero, avoiding division by zero in timing factor for wave ${waveNumber}.`);
            // The behavior here depends on how you want to interpret this edge case.
            // If gamma_n is 0, it implies Tn+1 is 0, which is problematic.
            // Defaulting timing_factor_content to 0, which makes the timing factor 0.
        }

        const term_timing_factor = (1 / Tn) * timing_factor_content;

        const dn = term_1_alpha - wearRateW + term_timing_factor;
        console.log(`[StrikeManager._calculateDn W:${waveNumber}] Terms: 1/alpha=${term_1_alpha}, wearRateW=${wearRateW}, timingFactorContent=${timing_factor_content}, termTimingFactor=${term_timing_factor}, Final dn=${dn}`);

        return dn;
    }
    // --- END ADDED ---

    // --- ADDED: Method to handle start of a new wave --- 
    /**
     * Updates StrikeManager state when a new wave starts.
     * Called by WaveManager.
     * @param {number} waveNumber - The wave number that is starting.
     * @param {number} timestamp - The timestamp when the wave starts.
     */
    startWave(waveNumber, timestamp) {
        if (!this.game || !this.game.defenceManager || !this.game.waveManager || !this.configLoaded) {
            console.error("StrikeManager.startWave: Cannot start wave, dependencies missing or not ready.");
            return;
        }

        //console.log(`StrikeManager: Received start signal for Wave ${waveNumber} at ${timestamp.toFixed(0)}ms`);

        this.currentWaveNumber = waveNumber;
        this.currentWaveStartTime = timestamp;

        // Fetch and store R_n(0) for the new wave (existing logic, but Rn_at_wave_start will be the primary one for new calcs)
        if (typeof this.game.defenceManager.getCurrentTotalEarningRate === 'function') {
            this.currentWaveStartTotalR = this.game.defenceManager.getCurrentTotalEarningRate();
            if (typeof this.currentWaveStartTotalR !== 'number' || !isFinite(this.currentWaveStartTotalR)) {
                console.warn(`StrikeManager.startWave: Invalid currentWaveStartTotalR received (${this.currentWaveStartTotalR}). Setting to 0.`);
                this.currentWaveStartTotalR = 0;
            }
        } else {
             console.error("StrikeManager.startWave: DefenceManager.getCurrentTotalEarningRate method missing. Cannot get currentWaveStartTotalR. Setting to 0.");
             this.currentWaveStartTotalR = 0;
        }

        // Calculate and store dn for the new wave (existing logic)
        this.currentDn = this._calculateDn(this.currentWaveNumber);
        // --- ADDED: Ensure currentDn is not negative for K_current_wave calculation ---
        // If dn is theoretically negative, it means no additional damage is required from strikes
        // for this wave to maintain balance, beyond existing wear and wave progression.
        // Clamping to 0 prevents K_current_wave from becoming negative, which would lead to
        // totalTargetDestructionR decreasing.
        if (this.currentDn < 0) {
            // console.warn(`StrikeManager.startWave: Calculated dn for wave ${this.currentWaveNumber} was negative (${this.currentDn.toFixed(4)}). Clamping to 0 for K_n calculation.`);
            this.currentDn = 0;
        }
        // --- END ADDED ---

        // --- NEW LOGIC from plan2.md II.3 ---
        // Get total bounty for the current wave
        if (typeof this.game.waveManager.getWaveTotalBounty === 'function') {
            this.totalBountyForCurrentWave_Bn = this.game.waveManager.getWaveTotalBounty(waveNumber);
            if (typeof this.totalBountyForCurrentWave_Bn !== 'number' || this.totalBountyForCurrentWave_Bn < 0) {
                console.warn(`StrikeManager.startWave: Invalid totalBountyForCurrentWave_Bn (${this.totalBountyForCurrentWave_Bn}). Setting to 0.`);
                this.totalBountyForCurrentWave_Bn = 0;
            }
        } else {
            console.error("StrikeManager.startWave: waveManager.getWaveTotalBounty method missing. Setting totalBountyForCurrentWave_Bn to 0.");
            this.totalBountyForCurrentWave_Bn = 0;
        }

        // Get projected duration for the current wave
        if (typeof this.game.waveManager.getWaveDurationSeconds === 'function') {
            this.projectedDurationCurrentWave_Tn = this.game.waveManager.getWaveDurationSeconds(waveNumber);
            if (typeof this.projectedDurationCurrentWave_Tn !== 'number' || this.projectedDurationCurrentWave_Tn < 0) {
                console.warn(`StrikeManager.startWave: Invalid projectedDurationCurrentWave_Tn (${this.projectedDurationCurrentWave_Tn}). Setting to 0.`);
                this.projectedDurationCurrentWave_Tn = 0;
            }
        } else {
            console.error("StrikeManager.startWave: waveManager.getWaveDurationSeconds method missing. Setting projectedDurationCurrentWave_Tn to 0.");
            this.projectedDurationCurrentWave_Tn = 0;
        }

        // Get Rn_at_wave_start (player's total defender earning rate at the start of the wave)
        if (typeof this.game.defenceManager.getCurrentTotalEarningRate === 'function') {
            this.Rn_at_wave_start = this.game.defenceManager.getCurrentTotalEarningRate();
            if (typeof this.Rn_at_wave_start !== 'number' || !isFinite(this.Rn_at_wave_start) || this.Rn_at_wave_start < 0) {
                console.warn(`StrikeManager.startWave: Invalid Rn_at_wave_start received (${this.Rn_at_wave_start}). Setting to 0.`);
                this.Rn_at_wave_start = 0;
            }
        } else {
             console.error("StrikeManager.startWave: DefenceManager.getCurrentTotalEarningRate method missing. Cannot get Rn_at_wave_start. Setting to 0.");
             this.Rn_at_wave_start = 0;
        }

        // Calculate K_current_wave
        if (this.totalBountyForCurrentWave_Bn > 0) {
            this.K_current_wave = (this.currentDn * this.projectedDurationCurrentWave_Tn) / this.totalBountyForCurrentWave_Bn;
            if (!isFinite(this.K_current_wave)) {
                 console.warn(`StrikeManager.startWave: Calculated K_current_wave is not a finite number (${this.K_current_wave}). Setting to null. Dn=${this.currentDn}, Tn=${this.projectedDurationCurrentWave_Tn}, Bn=${this.totalBountyForCurrentWave_Bn}`);
                 this.K_current_wave = null;
            }
        } else {
            console.warn("StrikeManager.startWave: totalBountyForCurrentWave_Bn is 0. Cannot calculate K_current_wave. Setting to null.");
            this.K_current_wave = null;
        }

        // Initialize Rn_at_last_bounty_checkpoint
        this.Rn_at_last_bounty_checkpoint = this.Rn_at_wave_start;

        // Reset bountyCollectedSinceLastCheckpoint
        this.bountyCollectedSinceLastCheckpoint = 0;
        this.cumulativeBountyThisWave = 0; // ADDED: Reset for the new wave
        // --- END NEW LOGIC ---

        //console.log(`  -> Stored R_n(0)=${this.currentWaveStartTotalR.toFixed(4)}, dn=${this.currentDn.toFixed(4)}`); // Old log
        // New log reflecting new properties:
        // console.log(`StrikeManager.startWave Details for Wave ${waveNumber}:`);
        // console.log(`  Rn_at_wave_start: ${this.Rn_at_wave_start.toFixed(4)}`);
        // console.log(`  totalBountyForCurrentWave_Bn: ${this.totalBountyForCurrentWave_Bn.toFixed(2)}`);
        // console.log(`  projectedDurationCurrentWave_Tn: ${this.projectedDurationCurrentWave_Tn.toFixed(2)}s`);
        // console.log(`  currentDn: ${this.currentDn.toFixed(4)}`);
        // console.log(`  K_current_wave: ${this.K_current_wave !== null ? this.K_current_wave.toFixed(6) : 'null'}`);
        // console.log(`  Rn_at_last_bounty_checkpoint: ${this.Rn_at_last_bounty_checkpoint.toFixed(4)}`);
        // console.log(`  bountyCollectedSinceLastCheckpoint: ${this.bountyCollectedSinceLastCheckpoint.toFixed(2)}`);
    }
    // --- END ADDED ---

    // --- MODIFIED: Getter for the calculated target damage (Plan II.7) ---
    /**
     * Returns the total cumulative target destruction (Delta R).
     * This value is updated by bounty processing.
     * The timestamp parameter is no longer used.
     * @returns {number} The total target destruction Delta R, ensured non-negative.
     */
    getCumulativeTargetDamageR() {
        // The logic for calculating intra-wave deltaR based on time has been removed.
        // totalTargetDestructionR is now updated incrementally by recordBountyEarned and finalizeWaveDamage.
        return this.totalTargetDestructionR;
    }
    // --- END MODIFIED ---

    // --- MODIFIED: Method to finalize damage accumulation for a completed wave (Plan II.6) ---
    /**
     * Processes any remaining bounty at the end of a wave to update target destruction.
     * Called by WaveManager when a wave is cleared.
     * @param {number} waveNumber - The wave number that just finished.
     * @param {number} startTime - The timestamp (ms) when this wave started (currently unused, but kept for API consistency).
     * @param {number} clearTime - The timestamp (ms) when the last enemy of this wave was cleared (currently unused, but kept for API consistency).
     */
    finalizeWaveDamage(waveNumber, startTime, clearTime) {
        // console.log(`StrikeManager.finalizeWaveDamage: Received finalize signal for Wave ${waveNumber}.`);

        // Safety check: Ensure this finalization corresponds to the wave StrikeManager thinks is active.
        if (waveNumber !== this.currentWaveNumber) {
            console.warn(`StrikeManager.finalizeWaveDamage: Mismatch! WaveManager cleared wave ${waveNumber}, but StrikeManager is on wave ${this.currentWaveNumber}. Final bounty processing might be skipped or incorrect.`);
            // Optionally, could decide to not process if mismatched, or try to use stored K for that waveNumber if available.
            // For now, proceed cautiously if conditions below are met.
        }

        // Process any remaining bounty collected since the last B* checkpoint
        if (this.bountyCollectedSinceLastCheckpoint > 0) {
            // console.log(`StrikeManager.finalizeWaveDamage: Processing remaining bounty of ${this.bountyCollectedSinceLastCheckpoint.toFixed(2)} for wave ${waveNumber}.`);
            // We need to ensure K_current_wave and Rn_at_last_bounty_checkpoint are still valid for THIS wave.
            // If waveNumber !== this.currentWaveNumber, K_current_wave might be for the *new* current wave.
            // This logic assumes that finalizeWaveDamage is called *before* startWave for the *next* wave fully reinitializes K and R_checkpoint.
            // If K_current_wave is null (e.g., if startWave for next wave already ran and reset it, or if initial calc failed for current wave)
            // then _updateTargetDestructionForBatch will correctly do nothing.
            this._updateTargetDestructionForBatch(this.bountyCollectedSinceLastCheckpoint);
        }

        // Ensure bounty collected is reset for the next wave (startWave also does this, but good for safety).
        this.bountyCollectedSinceLastCheckpoint = 0;

        // --- REMOVED Old Time-Based Delta R Calculation --- 
        // The old logic based on effectiveDurationSec, Rn0_forCompletedWave, and dn_forCompletedWave is now gone.
        // this.totalAccumulatedTargetDamageR was the old property being updated here.
        // --- END REMOVED ---

        // console.log(`StrikeManager.finalizeWaveDamage: Wave ${waveNumber} finalized. totalTargetDestructionR is now ${this.totalTargetDestructionR.toFixed(2)}.`);
    }
    // --- END MODIFIED ---

    // --- ADDED: Orchestration for a single real bomb drop ---
    /**
     * Triggers a single real bomb drop at the given impact coordinates.
     * @param {object} impactCoords - The {x, y} coordinates for the bomb's impact.
     * @returns {number} The Delta R (damage dealt to defenders) from this bomb, or 0 if failed.
     */
    async dispatchStriker(targetCoords) {
        if (!this.isConfigLoaded()) {
            console.error("StrikeManager.dispatchStriker: Config not loaded. Cannot dispatch striker.");
            return Promise.reject("Config not loaded");
        }
        if (!this.bombPayload) {
            console.error("StrikeManager.dispatchStriker: Bomb payload not ready. Cannot dispatch striker.");
            return Promise.reject("Bomb payload not ready");
        }
        if (!this.strikerShadowData) {
            console.warn("StrikeManager.dispatchStriker: Striker shadow data not ready. Proceeding without shadow for this strike, but this is unexpected.");
            // Potentially create a dummy/null strikerShadowData if we want to allow strikes without shadows gracefully
            // For now, it will likely cause an error in Striker constructor if it expects an object.
            // The Striker constructor was updated to allow null for strikerShadow, so this should be fine but log a warning.
        }

        const striker = new Striker(this.game, this.strikerShadowData, this.bombPayload, targetCoords, this.game);

        // Striker's constructor will set up and start an async operation.
        // It needs to expose: 
        // 1. A synchronous way to check if initial setup was okay (e.g., isInitializedSuccessfully())
        // 2. A promise that resolves with the strike result (e.g., completionPromise)
        
        // --- START OF BLOCK TO REMOVE ---
        // --- DETAILED CHECK FOR STRIKER INITIALIZATION ---
        // console.log("[StrikeManager] Checking striker instance:", striker);
        // if (!striker) {
        //     console.error("[StrikeManager] dispatchStriker: Striker instance is null or undefined after creation.");
        //     return 0;
        // }
        // console.log(`[StrikeManager] typeof striker.isInitializedSuccessfully: ${typeof striker.isInitializedSuccessfully}`);

        // let initialized = false;
        // if (typeof striker.isInitializedSuccessfully === 'function') {
        //     try {
        //         initialized = striker.isInitializedSuccessfully();
        //         console.log(`[StrikeManager] striker.isInitializedSuccessfully() returned: ${initialized}`);
        //     } catch (e) {
        //         console.error("[StrikeManager] Error calling striker.isInitializedSuccessfully():", e);
        //         return 0; // Critical error
        //     }
        // } else {
        //     console.error("[StrikeManager] dispatchStriker: striker.isInitializedSuccessfully is NOT a function.");
        //     return 0;
        // }

        // if (!initialized) {
        //     console.error("[StrikeManager] dispatchStriker: Striker reported it was not initialized successfully.");
        //     return 0; 
        // }
        // --- END DETAILED CHECK ---
        // --- END OF BLOCK TO REMOVE ---

        // Reverting to the cleaner check, now that the underlying issue is fixed.
        if (!striker || typeof striker.isInitializedSuccessfully !== 'function' || !striker.isInitializedSuccessfully()) {
            console.error("StrikeManager.dispatchStriker: Striker could not be initialized successfully.");
            return 0; 
        }

        striker.isStrikeOperationComplete = false; // Initialize completion flag
        striker.completionPromise.finally(() => {
            striker.isStrikeOperationComplete = true;
        });

        // Add the successfully initialized striker to the array to be managed
        this.strikers.push(striker);

        try {
            // striker.completionPromise is a property/getter on the Striker instance,
            // set/managed by its constructor/internal async logic, resolving to the damage dealt.
            // This will be implemented in Striker.js
            if (typeof striker.completionPromise?.then !== 'function') {
                console.error("StrikeManager.dispatchStriker: Striker.completionPromise is not a valid promise.");
                return 0;
            }
            const damageDealtR = await striker.completionPromise;
            return damageDealtR;
        } catch (error) {
            console.error("StrikeManager.dispatchStriker: Error during strike execution:", error);
            return 0; // Or handle error more specifically, e.g., return Promise.reject(error)
        }
    }
    // --- END ADDED ---

    // --- ADDED: Method to load explosion frame images --- // MODIFIED FOR PIXI TEXTURES
    async _loadExplosionFrames() {
        if (!this.explosionAnimationConfig || !this.explosionAnimationConfig.folderPath) {
            console.error("StrikeManager._loadExplosionFrames: Explosion animation folderPath not configured.");
            this.pixiExplosionAnimationData = null;
            return;
        }
        // These checks are now more detailed in loadConfig, but good to have specific ones here too.
        if (typeof this.explosionAnimationConfig.frameCount !== 'number' || this.explosionAnimationConfig.frameCount <= 0) {
            console.error("StrikeManager._loadExplosionFrames: Invalid or missing frameCount in explosionAnimation config.");
            this.pixiExplosionAnimationData = null;
            return;
        }
        if (typeof this.explosionAnimationConfig.digitsForZeroPadding !== 'number' || this.explosionAnimationConfig.digitsForZeroPadding <= 0) {
            console.error("StrikeManager._loadExplosionFrames: Invalid or missing digitsForZeroPadding in explosionAnimation config.");
            this.pixiExplosionAnimationData = null;
            return;
        }

        const folderPath = this.explosionAnimationConfig.folderPath;
        const frameCount = this.explosionAnimationConfig.frameCount;
        const digits = this.explosionAnimationConfig.digitsForZeroPadding;
        const filePrefix = this.explosionAnimationConfig.filePrefix || "";
        const fileSuffix = this.explosionAnimationConfig.fileSuffix || ".png";

        try {
            let loadedPixiTextures = [];
            for (let i = 1; i <= frameCount; i++) {
                const frameNumberStr = i.toString().padStart(digits, '0');
                const fileName = filePrefix + frameNumberStr + fileSuffix;
                const fullPath = folderPath + fileName; 
                try {
                    const texture = await PIXI.Assets.load(fullPath);
                    loadedPixiTextures.push(texture);
                } catch (textureLoadError) {
                    console.error(`StrikeManager._loadExplosionFrames: Failed to load texture ${fullPath}:`, textureLoadError);
                    // Decide if one failed texture load should prevent all: for now, it will try to load others.
                    // If a complete set is crucial, you might throw here or set a flag.
                }
            }

            this.explosionFrames = []; // Clear old Image objects if any were populated
            
            if (loadedPixiTextures.length === frameCount) { // Ensure all frames loaded successfully
                this.pixiExplosionAnimationData = {
                    textures: loadedPixiTextures,
                    frameDurationMs: this.explosionAnimationConfig.frameDurationMs,
                    scale: this.explosionAnimationConfig.scale,
                    anchorX: this.explosionAnimationConfig.anchorX,
                    anchorY: this.explosionAnimationConfig.anchorY,
                    totalFrames: loadedPixiTextures.length
                    // frameWidth & frameHeight can be derived from textures[0].width/height if needed by Striker
                };
                // console.log("StrikeManager: Successfully loaded all explosion PIXI.Textures and prepared pixiExplosionAnimationData.");
            } else {
                console.error(`StrikeManager._loadExplosionFrames: Failed to load all ${frameCount} explosion frames. Loaded ${loadedPixiTextures.length}. Animation data will be null.`);
                this.pixiExplosionAnimationData = null;
            }

        } catch (error) {
            console.error(`StrikeManager._loadExplosionFrames: General error processing explosion frames from ${folderPath}:`, error);
            this.pixiExplosionAnimationData = null;
        }
        this._tryAssembleBombPayload(); // Attempt to assemble bomb payload now that explosion frames are processed
    }
    // --- END ADDED ---

    // --- NEW METHOD: Attempt to assemble bomb payload ---
    _tryAssembleBombPayload() {
        if (this.bombPayload) return; // Already assembled

        if (this.bombStrengthA !== null && // bombStrengthA can be 0, so just check for null
            this.pixiExplosionAnimationData && 
            this.strikerShadowData && 
            typeof this.impactStdDevPixels === 'number') {
            
            this.bombPayload = {
                strengthA: this.bombStrengthA,
                impactStdDevPixels: this.impactStdDevPixels,
                explosionAnimation: this.pixiExplosionAnimationData,
                // MODIFICATION: Pass the whole shadowData object which includes texture and config
                shadow: this.strikerShadowData, 
                minDamageThreshold: this.minWearDecrementForPayload
            };
            // console.log("StrikeManager: bombPayload successfully assembled.", this.bombPayload);
        } else {
            // Not an error, just means not all components are ready yet.
            // This method will be called again when other components become ready.
            // console.log("StrikeManager: Could not assemble bombPayload yet. Missing components.", {
            //     bombStrengthA_isSet: this.bombStrengthA !== null,
            //     pixiExplosionAnimationDataReady: !!this.pixiExplosionAnimationData,
            //     strikerShadowDataReady: !!this.strikerShadowData,
            //     impactStdDevPixels_isSet: typeof this.impactStdDevPixels === 'number'
            // });
        }
    }
    // --- END NEW METHOD ---

    // --- ADDED: Test function to trigger a strike --- MODIFIED FOR SIMULATION
    async strike(timestamp) { // ADDED timestamp parameter
        if (!this.isConfigLoaded()) {
            console.error("StrikeManager.strike(): Cannot strike, config not loaded.");
            return;
        }
        if (!this.bombPayload) {
            console.error("StrikeManager.strike(): Cannot strike, bombPayload not ready.");
            return;
        }

        // Cooldown is now primarily checked in update() before calling automated strike.
        // This remains a safeguard if strike() is called from elsewhere or for non-automated strikes.
        if (this.strikeCooldownActive && timestamp < this.strikeCooldownEndTime) {
            // console.log(`StrikeManager.strike(): Strike cooldown active. Ends at ${this.strikeCooldownEndTime.toFixed(0)}, current: ${timestamp.toFixed(0)}`);
            return;
        }

        // 1. Determine OPTIMAL target (same as before)
        this.calculateZBuffer(); 
        const optimalTargetCoords = this.findOptimalTarget();

        if (!optimalTargetCoords) {
            // console.log("StrikeManager.strike(): No optimal target found. Strike aborted.");
            return;
        }

        // 2. Calculate DETERMINED impact coordinates (with randomness)
        // This uses the bombPayload which contains impactStdDevPixels.
        // The _generateNormalRandom helper also needs `this._spareNormal`, ensure it's initialized in StrikeManager constructor or state.
        const determinedImpactCoords = this._calculateImpactCoordinates(optimalTargetCoords, this.bombPayload);
        if (!determinedImpactCoords) { // Should not happen if optimalTargetCoords is valid
            console.error("StrikeManager.strike(): Failed to determine impact coordinates. Strike aborted.");
            return;
        }
        // console.log(`StrikeManager.strike(): Optimal target at (${optimalTargetCoords.x.toFixed(1)}, ${optimalTargetCoords.y.toFixed(1)}), Determined impact at (${determinedImpactCoords.x.toFixed(1)}, ${determinedImpactCoords.y.toFixed(1)})`);

        // 3. Simulation Step
        const currentTotalR = this.game.defenceManager.getCurrentTotalEarningRate();
        // REMOVED: const bn = this._getCurrentWaveAverageBountyRate();

        const activeDefenders = this.game.defenceManager.getActiveDefences();
        const clonedDefenders = activeDefenders.map(def => this._cloneDefenderForSimulation(def)).filter(clone => clone !== null);

        if (clonedDefenders.length === 0 && activeDefenders.length > 0) {
            console.warn("StrikeManager.strike(): All active defenders failed to clone for simulation. Aborting strike.");
            // Potentially activate cooldown here too if this is a critical failure path
            return;
        } 
        // If activeDefenders is 0, clonedDefenders will be 0. Strike simulation will result in 0 damage.
        // This is fine, it means striking an empty field.

        // Instantiate a Striker for simulation
        // Pass `determinedImpactCoords` to the simulated striker.
        const simulatedStriker = new Striker(
            this.game,          // gameInstance (for Striker's internal needs, though less critical for sim)
            null,               // strikerShadow (null for simulation)
            this.bombPayload,   // bombPayload
            determinedImpactCoords, // THE DETERMINED IMPACT COORDINATES
            clonedDefenders     // context (array of cloned defenders)
        );

        if (!simulatedStriker.isInitializedSuccessfully()) {
            console.error("StrikeManager.strike(): Failed to initialize simulated Striker. Aborting strike.");
            return;
        }

        let simulatedTotalDeltaR = 0;
        try {
            simulatedTotalDeltaR = await simulatedStriker.completionPromise;
        } catch (simError) {
            console.error("StrikeManager.strike(): Error during strike simulation:", simError);
            // Decide if we abort or proceed without safety check. Aborting is safer.
            return; 
        }
        
        // console.log(`StrikeManager.strike() SIMULATION: currentTotalR=${currentTotalR.toFixed(2)}, bn=${bn.toFixed(2)}, simulatedTotalDeltaR=${simulatedTotalDeltaR.toFixed(2)}`);

        const simulatedPostStrikeR = currentTotalR - simulatedTotalDeltaR;

        // 4. Safety Check
        const targetFloorR = this._calculateTargetEarningRateFloor();
        const safetyFactor = 1.0 + this.strikeFloorSafetyMarginPercent;
        const adjustedTargetFloorR = targetFloorR * safetyFactor;

        if (simulatedPostStrikeR < adjustedTargetFloorR) { 
            console.log(`StrikeManager.strike(): Strike ABORTED. Simulated post-strike R (${simulatedPostStrikeR.toFixed(2)}) would be below adjusted target floor R (${adjustedTargetFloorR.toFixed(2)}; base: ${targetFloorR.toFixed(2)}, margin: ${this.strikeFloorSafetyMarginPercent*100}%).`);
            return; 
        }
        // END DEBUG

        // 5. Proceed with Real Strike (if safety check passes)
        // console.log(`StrikeManager.strike(): Safety check passed. Proceeding with real strike at (${determinedImpactCoords.x.toFixed(1)}, ${determinedImpactCoords.y.toFixed(1)}).`);
        try {
            // Pass `determinedImpactCoords` to the real striker.
            const deltaR = await this.dispatchStriker(determinedImpactCoords); 
            // console.log(`StrikeManager.strike(): Real strike completed. Delta R from defenders: ${deltaR !== undefined && deltaR !== null ? deltaR.toFixed(4) : 'N/A'}`);
            
                if (typeof deltaR === 'number' && deltaR >= 0) { 
                    if (this.averageBombDamageR === null) {
                        this.averageBombDamageR = deltaR; // First strike sets the average if not seeded
                    } else {
                        this.averageBombDamageR = (this.averageBombDamageR + deltaR) / 2;
                    }
                    // console.log(`StrikeManager.strike(): Updated averageBombDamageR: ${this.averageBombDamageR.toFixed(2)}`);
                    
                    // Update cumulativeBombDamageDealtByStrikesR (still needed for Outstanding Target Damage)
                    this.cumulativeBombDamageDealtByStrikesR += deltaR;
                    // console.log(`StrikeManager.strike(): Updated cumulativeBombDamageDealtByStrikesR: ${this.cumulativeBombDamageDealtByStrikesR.toFixed(2)}`);

                    // After updating average, update the bounty threshold (this is for ongoing updates)
                    this._updateBountyThreshold();

                    // Activate cooldown
                    this.strikeCooldownActive = true;
                    this.strikeCooldownEndTime = timestamp + this.strikeCooldownDurationMs;
                    // console.log(`StrikeManager: Strike cooldown activated for ${this.strikeCooldownDurationMs / 1000}s. Ends at ${this.strikeCooldownEndTime.toFixed(0)} (current: ${timestamp.toFixed(0)})`);
                }
                // --- END MODIFIED ---

            } catch (error) {
                console.error("StrikeManager.strike(): Error during dispatchStriker or strike execution:", error);
        }
    }
    // --- END ADDED ---

    // --- ADDED: Heatmap Pixi Object Initialization ---
    _initializeHeatmapPixiObjects() {
        if (this.mapWidth > 0 && this.mapHeight > 0 && this.game.app?.renderer) {
            if (this.heatmapRenderTexture) {
                this.heatmapRenderTexture.destroy(true);
            }
            this.heatmapRenderTexture = PIXI.RenderTexture.create({ width: this.mapWidth, height: this.mapHeight });

            if (this.heatmapSprite) {
                this.heatmapSprite.destroy();
            }
            this.heatmapSprite = new PIXI.Sprite(this.heatmapRenderTexture);
            this.heatmapSprite.visible = this.renderHeatmapDebug; // Set initial visibility

            // Add to stage - consider a specific layer or zIndex if needed
            // For now, add directly to the stage. Ensure it's on top of the game world.
            // Example: this.heatmapSprite.zIndex = 100; // If parent container sorts children
            this.game.app.stage.addChild(this.heatmapSprite);
        } else {
            console.warn("StrikeManager: Cannot initialize heatmap Pixi objects - map dimensions or renderer not ready.");
        }
    }
    // --- END ADDED ---

    // --- ADDED: Method to update PixiJS Heatmap Texture ---
    _updateHeatmapTexture() {
        if (!this.configLoaded || !this.zBuffer || !this.heatmapDrawingGraphic || !this.heatmapRenderTexture || !this.game.app?.renderer) {
            // console.warn("StrikeManager: Cannot update heatmap texture - dependencies not ready.");
            if (this.heatmapSprite) this.heatmapSprite.visible = false; // Hide if we can't draw
            return;
        }

        this.heatmapDrawingGraphic.clear();

        let maxZ = 0;
        for (let r = 0; r < this.gridHeight; r++) {
            for (let c = 0; c < this.gridWidth; c++) {
                if (this.zBuffer[r][c] > maxZ) {
                    maxZ = this.zBuffer[r][c];
                }
            }
        }

        for (let r = 0; r < this.gridHeight; r++) {
            for (let c = 0; c < this.gridWidth; c++) {
                const zValue = this.zBuffer[r][c];
                if (zValue > 0) {
                    // Adapted from old renderZBuffer logic, using PIXI colors/alpha
                    const intensity = (maxZ > 0) ? (zValue / (maxZ * 1.0)) : 0.1; // Normalize, ensure float division, provide base for zValue > 0 but maxZ might be low
                    const alpha = Math.min(1.0, 0.15 + intensity * 0.6); // Base alpha 0.15, scales up to 0.75
                    let cellColorHex = 0xff0000; // Red

                    if (maxZ > 0 && zValue === maxZ) {
                        cellColorHex = 0x00ff00; // Green for max Z value
                    }

                    const drawX = c * this.cellWidth;
                    const drawY = r * this.cellHeight;
                    
                    this.heatmapDrawingGraphic.rect(drawX, drawY, this.cellWidth, this.cellHeight)
                                             .fill({ color: cellColorHex, alpha: alpha });
                }
            }
        }
        
        // Render the drawing graphic to the render texture
        this.game.app.renderer.render({
            container: this.heatmapDrawingGraphic,
            target: this.heatmapRenderTexture,
            clear: true,
        });
    }
    // --- END ADDED ---

    // --- ADDED: Target Finding Logic ---
    update(timestamp, deltaTime) {
        // Update existing strikers
        for (let i = this.strikers.length - 1; i >= 0; i--) {
            const striker = this.strikers[i];
            if (striker.isStrikeOperationComplete) {
                this.strikers.splice(i, 1);
            }
        }

        // --- ADDED: Cooldown Update Logic ---
        if (this.strikeCooldownActive && timestamp >= this.strikeCooldownEndTime) {
            this.strikeCooldownActive = false;
            // console.log(`StrikeManager.update: Strike cooldown ended at ${timestamp.toFixed(0)}.`);
        }
        // --- END ADDED ---

        // --- ADDED: Heatmap Update Logic ---
        if (this.heatmapSprite && this.game.app?.renderer) { // Ensure Pixi objects are ready
            if (this.renderHeatmapDebug) {
                if (!this.heatmapSprite.visible) {
                    this.heatmapSprite.visible = true;
                }
                // Assuming calculateZBuffer() is called elsewhere (e.g., in Game.js update or before this manager's update)
                // and it updates this.zBuffer
                this.calculateZBuffer(); // Call before updating texture
                this._updateHeatmapTexture();
            } else {
                if (this.heatmapSprite.visible) {
                    this.heatmapSprite.visible = false;
                    // Optionally clear the drawing graphic if you want to free memory,
                    // though just hiding the sprite is usually enough.
                    // this.heatmapDrawingGraphic.clear(); 
                }
            }
        } else if (this.renderHeatmapDebug) {
            // Attempt to re-initialize if it failed before and debug flag is on
            this._initializeHeatmapPixiObjects();
        }
        // --- END ADDED ---

        // --- ADDED: Automated Strike Logic ---
        if (this.isConfigLoaded() && this.bombPayload && this.strikers.length === 0) {
            const outstandingDamage = this.getOutstandingTargetDamageR();
            // MODIFIED: Only strike if outstanding damage is greater than the average bomb damage (cost)
            // Treats null or 0 averageBombDamageR as 0 for the comparison, allowing initial strikes.
            // AND check if cooldown is not active
            if (outstandingDamage > (this.averageBombDamageR || 0) && !this.strikeCooldownActive) { 
                this.strike(timestamp).catch(error => console.error("Automated strike failed:", error)); // PASS timestamp
            }
        }
        // --- END ADDED ---
    }

    destroy() {
        // Destroy existing strikers
        this.strikers.forEach(striker => striker.destroy());
        this.strikers = [];

        // --- ADDED: Cleanup Heatmap Pixi Objects ---
        if (this.heatmapSprite) {
            if (this.heatmapSprite.parent) { // Check if it's on stage
                this.heatmapSprite.parent.removeChild(this.heatmapSprite);
            }
            this.heatmapSprite.destroy({ children: true, texture: false, baseTexture: false }); // Don't destroy render texture here
            this.heatmapSprite = null;
        }
        if (this.heatmapRenderTexture) {
            this.heatmapRenderTexture.destroy(true); // Destroy the render texture and its base texture
            this.heatmapRenderTexture = null;
        }
        if (this.heatmapDrawingGraphic) {
            this.heatmapDrawingGraphic.destroy();
            this.heatmapDrawingGraphic = null;
        }
        // --- END ADDED ---

        // console.log("StrikeManager destroyed.");
    }

    // --- ADDED: Getter for Outstanding Target Damage R ---
    getOutstandingTargetDamageR() {
        const outstandingDamage = this.getCumulativeTargetDamageR() - this.cumulativeBombDamageDealtByStrikesR;
        return outstandingDamage;
    }
    // --- END ADDED ---

    // --- NEW METHOD: To be called by Game when it's ready for initial B* calculation ---
    initializeBountyThreshold() {
        // console.log("StrikeManager: initializeBountyThreshold called by Game.");
        this._updateBountyThreshold();
    }
    // --- END NEW METHOD ---

    // --- NEW METHOD: _updateBountyThreshold (Plan II.5 related, but for B*) ---
    /**
     * Calculates and updates bountyUpdateThreshold_B_star based on current alpha and averageBombDamageR.
     * B* = (alpha * averageBombDamageR) / targetDamageUpdatePoints
     * @private
     */
    _updateBountyThreshold() {
        if (!this.game || typeof this.game.getAlpha !== 'function' || this.averageBombDamageR === null || typeof this.averageBombDamageR !== 'number' || this.targetDamageUpdatePoints === null || this.targetDamageUpdatePoints <= 0) {
            // console.warn("StrikeManager._updateBountyThreshold: Conditions not met for calculation (game, alpha, avgR, or targetDamageUpdatePoints invalid). Setting B* to Infinity.");
            this.bountyUpdateThreshold_B_star = Infinity;
            return;
        }

        const alpha = this.game.getAlpha();

        if (alpha === null || typeof alpha !== 'number' || alpha <= 0 || this.averageBombDamageR < 0) {
            // console.warn(`StrikeManager._updateBountyThreshold: Alpha (${alpha}) or averageBombDamageR (${this.averageBombDamageR}) is invalid for B* calculation. Setting B* to Infinity.`);
            this.bountyUpdateThreshold_B_star = Infinity;
            return;
        }

        // If averageBombDamageR is 0, B* will be 0. This causes an infinite loop in recordBountyEarned.
        // So, if the numerator (alpha * averageBombDamageR) is 0, B* should be Infinity.
        const numerator = alpha * this.averageBombDamageR;
        if (numerator === 0) {
            this.bountyUpdateThreshold_B_star = Infinity;
        } else {
            this.bountyUpdateThreshold_B_star = numerator / this.targetDamageUpdatePoints;
        }

        if (!isFinite(this.bountyUpdateThreshold_B_star) || this.bountyUpdateThreshold_B_star < 0) {
            // console.error(`StrikeManager: Calculated bountyUpdateThreshold_B_star is invalid (${this.bountyUpdateThreshold_B_star}). Setting to Infinity.`);
            this.bountyUpdateThreshold_B_star = Infinity;
        } else {
            // console.log(`StrikeManager: bountyUpdateThreshold_B_star updated to ${this.bountyUpdateThreshold_B_star.toFixed(4)} (alpha: ${alpha.toFixed(4)}, avgR: ${this.averageBombDamageR.toFixed(4)}, updPoints: ${this.targetDamageUpdatePoints})`);
        }
    }
    // --- END NEW METHOD ---

    resetForNewGame() {
        // Clean up any active strikers
        if (this.strikers && this.strikers.length > 0) {
            this.strikers.forEach(striker => {
                if (striker && typeof striker.destroy === 'function') {
                    striker.destroy();
                }
            });
        }

        // Reset only runtime state
        this.initRuntimeState();

        // Re-seed averageBombDamageR from the initialized state
        this.averageBombDamageR = this.seedAverageBombDeltaR;

        // Update dependent calculations
        this.updateDependentCalculations();
    }

    isConfigLoaded() {
        return this.configLoaded;
    }

    // --- ADDED: Method to load shadow texture ---
    async _loadShadowTexture(shadowConfig) {
        if (!shadowConfig || !shadowConfig.texturePath) {
            console.warn("StrikeManager: No shadow texture path provided in config.");
            return;
        }

        try {
            const texture = await PIXI.Assets.load(shadowConfig.texturePath);
            this.strikerShadowData = {
                texture: texture,
                config: shadowConfig
            };
            //console.log("StrikeManager: Shadow texture loaded successfully.");
        } catch (error) {
            console.error("StrikeManager: Failed to load shadow texture:", error);
            this.strikerShadowData = null;
        }
    }
    // --- END ADDED ---

    // --- ADDED: Method to record bounty earned and trigger target destruction updates ---
    /**
     * Records bounty earned by the player and updates target destruction calculation
     * if thresholds are met.
     * This method should be called by the Game or BountyManager whenever bounty is awarded to the player.
     * @param {number} bountyAmount - The amount of bounty earned from a single event (e.g., enemy kill).
     */
    recordBountyEarned(bountyAmount) {
        if (typeof bountyAmount !== 'number' || bountyAmount <= 0) {
            return;
        }
        // Ensure there's an active wave and K_current_wave is valid (e.g. total bounty for wave Bn > 0)
        if (this.currentWaveNumber === 0 || this.K_current_wave === null || this.K_current_wave === undefined) {
            // console.log("StrikeManager.recordBountyEarned: No active wave or K_current_wave is invalid, bounty not processed for target destruction.");
            return;
        }

        // ADDED: Accumulate total bounty for the current wave
        this.cumulativeBountyThisWave += bountyAmount;

        // Ensure bountyUpdateThreshold_B_star is a positive finite number for chunking.
        // If it's Infinity (e.g. averageBombDamageR is 0), all processing happens in finalizeWaveDamage.
        const isValidBStar = typeof this.bountyUpdateThreshold_B_star === 'number' && isFinite(this.bountyUpdateThreshold_B_star) && this.bountyUpdateThreshold_B_star > 0;

        this.bountyCollectedSinceLastCheckpoint += bountyAmount;
        // console.log(`StrikeManager.recordBountyEarned: Bounty ${bountyAmount.toFixed(2)} recorded. Total for wave: ${this.cumulativeBountyThisWave.toFixed(2)}. Total since checkpoint: ${this.bountyCollectedSinceLastCheckpoint.toFixed(2)} / ${isValidBStar ? this.bountyUpdateThreshold_B_star.toFixed(2) : 'Infinity'}`);

        // Process in B* chunks if B* is valid and positive
        if (isValidBStar) {
            while (this.bountyCollectedSinceLastCheckpoint >= this.bountyUpdateThreshold_B_star) {
                // console.log(`StrikeManager.recordBountyEarned: Processing a B* chunk of ${this.bountyUpdateThreshold_B_star.toFixed(2)}.`);
                this._updateTargetDestructionForBatch(this.bountyUpdateThreshold_B_star);
                this.bountyCollectedSinceLastCheckpoint -= this.bountyUpdateThreshold_B_star;
                // console.log(`StrikeManager.recordBountyEarned: Remaining bounty since checkpoint: ${this.bountyCollectedSinceLastCheckpoint.toFixed(2)}.`);
            }
        }
    }
    // --- END ADDED ---

    // --- NEW METHOD: _updateTargetDestructionForBatch (Implements logic from theory doc Eqs. 41,42 and subsequent paragraph) ---
    /**
     * Calculates and applies a batch of target destruction based on bounty earned.
     * This method updates totalTargetDestructionR and Rn_at_last_bounty_checkpoint.
     * @param {number} bountyAmountInBatch - The amount of bounty in this specific batch (e.g., B* or remaining bounty).
     * @private
     */
    _updateTargetDestructionForBatch(bountyAmountInBatch) {
        if (bountyAmountInBatch <= 0) {
            return; // No bounty, no change.
        }
        // K_current_wave should be (dn * Tn) / Bn. If Bn is 0, K_current_wave might be null/Infinity.
        if (this.K_current_wave === null || this.K_current_wave === undefined || !isFinite(this.K_current_wave)) {
            // console.warn("StrikeManager._updateTargetDestructionForBatch: K_current_wave is not valid. Cannot update target destruction.", this.K_current_wave);
            return;
        }
        if (this.Rn_at_last_bounty_checkpoint === null || this.Rn_at_last_bounty_checkpoint === undefined) {
            // console.warn("StrikeManager._updateTargetDestructionForBatch: Rn_at_last_bounty_checkpoint is not set. Cannot update target destruction.");
            return;
        }

        const R_chk = this.Rn_at_last_bounty_checkpoint;
        const K_n = this.K_current_wave; // This is (dn * Tn) / Bn

        // R'_chk = R_chk * e^(-K_n * bountyAmountInBatch)
        const R_prime_chk = R_chk * Math.exp(-K_n * bountyAmountInBatch);

        // deltaR for batch = R_chk - R'_chk
        const deltaR_for_batch = R_chk - R_prime_chk;

        if (typeof deltaR_for_batch === 'number' && isFinite(deltaR_for_batch)) {
            this.totalTargetDestructionR += deltaR_for_batch;
            // console.log(`StrikeManager: Batch bounty ${bountyAmountInBatch.toFixed(2)} processed. DeltaR: ${deltaR_for_batch.toFixed(4)}. New totalTargetDestructionR: ${this.totalTargetDestructionR.toFixed(4)}. K_n: ${K_n.toFixed(6)}, R_chk: ${R_chk.toFixed(4)}, R_prime_chk: ${R_prime_chk.toFixed(4)}`);
        } else {
            // console.warn(`StrikeManager._updateTargetDestructionForBatch: Invalid deltaR_for_batch calculated (${deltaR_for_batch}). K_n=${K_n}, R_chk=${R_chk}, bountyAmount=${bountyAmountInBatch}`);
        }

        // Update Rn_at_last_bounty_checkpoint for the next batch/calculation.
        // Ensure it doesn't go negative due to potential floating point inaccuracies or extreme K_n values.
        this.Rn_at_last_bounty_checkpoint = Math.max(0, R_prime_chk);

        // console.log(`StrikeManager: Updated Rn_at_last_bounty_checkpoint to ${this.Rn_at_last_bounty_checkpoint.toFixed(4)}`);
    }
    // --- END NEW METHOD ---

    // --- ADDED: Method to calculate target earning rate floor based on Eq. 50 ---
    _calculateTargetEarningRateFloor() {
        if (this.currentWaveNumber === 0) { // Should not happen if logic is correct, but safeguard
            return 0; // Or a very high value to prevent strikes if game not started
        }

        // Check if cache is valid for the current wave
        if (this.currentWaveNumber !== this._cachedRnB_waveNumber || this._cachedRnB_waveNumber === -1) {
            // Cache is stale or not initialized, recalculate constants
            const R_start_n = this.Rn_at_wave_start;
            const alpha = this.game.getAlpha();
            const wear_w = this.game.getWearParameter();
            const dn = this.currentDn;
            const Bn = this.totalBountyForCurrentWave_Bn;
            const Tn = this.projectedDurationCurrentWave_Tn;

            // Ensure alpha is positive
            if (alpha <= 1e-9) {
                console.error("StrikeManager._calculateTargetEarningRateFloor: Alpha is zero or negative. Cannot calculate floor.");
                // Cache values that would make the floor very high or prevent strikes
                this._cachedRnB_useLinear = true;
                this._cachedRnB_R_start_n = R_start_n; // Doesn't really matter
                this._cachedRnB_alpha_inv = Infinity; // This will make R(B) huge
                this._cachedRnB_waveNumber = this.currentWaveNumber;
                // No need to calculate C1, P, C2
            } else {
                const b_n = (Tn > 1e-6) ? Bn / Tn : 0; // Average bounty rate for wave n
                const sum_w_dn = wear_w + dn;

                if (Math.abs(sum_w_dn) < 1e-9) { // Case: w + dn approx 0
                    this._cachedRnB_useLinear = true;
                    this._cachedRnB_R_start_n = R_start_n;
                    this._cachedRnB_alpha_inv = 1 / alpha;
                    this._cachedRnB_C1 = null; // Not used
                    this._cachedRnB_P = null;  // Not used
                    this._cachedRnB_C2 = null;  // Not used
                } else { // Case: w + dn != 0
                    this._cachedRnB_useLinear = false;
                    const alpha_sum_w_dn = alpha * sum_w_dn;

                    if (Math.abs(alpha_sum_w_dn) < 1e-9) { // Denominator for C1 is zero
                        // This implies alpha is ~0 (handled above) or sum_w_dn is ~0 (linear case, handled above)
                        // However, if b_n is also 0, C1 could be NaN. If b_n!=0, C1 is Inf.
                        // Fallback: if somehow this condition is met and not caught by linear, treat as high floor.
                        // This state should ideally not be reached if alpha > 0 and sum_w_dn != 0.
                         this._cachedRnB_C1 = (b_n === 0) ? 0 : (b_n > 0 ? Infinity : -Infinity); // Avoid NaN
                    } else {
                         this._cachedRnB_C1 = b_n / alpha_sum_w_dn;
                    }
                    
                    this._cachedRnB_P = R_start_n - this._cachedRnB_C1;

                    if (Math.abs(b_n) < 1e-6) { // Denominator for C2 is zero
                        // If sum_w_dn > 0, e^(-Inf*B) -> 0 for B>0. R(B) -> C1.
                        // If sum_w_dn < 0, e^(+Inf*B) -> Inf for B>0. R(B) -> Inf.
                        this._cachedRnB_C2 = (sum_w_dn > 0) ? Infinity : (sum_w_dn < 0 ? -Infinity : 0);
                    } else {
                        this._cachedRnB_C2 = sum_w_dn / b_n;
                    }
                    this._cachedRnB_R_start_n = null; // Not used directly
                    this._cachedRnB_alpha_inv = null; // Not used directly
                }
                this._cachedRnB_waveNumber = this.currentWaveNumber;
            }
        }

        // Calculate R_n(B) using cached constants and current bounty B
        const currentB = this.cumulativeBountyThisWave;

        if (this._cachedRnB_useLinear) {
            if (this._cachedRnB_alpha_inv === Infinity) return Infinity; // Effectively alpha=0 case from cache
            return this._cachedRnB_R_start_n + this._cachedRnB_alpha_inv * currentB;
        } else {
            // Handle cases where C2 might lead to Math.exp exploding or becoming 0
            const exponentVal = -this._cachedRnB_C2 * currentB;
            let expTerm;
            if (exponentVal > 700) { // Prevent Math.exp overflow (approx e^709 is max double)
                expTerm = Infinity;
            } else if (exponentVal < -700) { // Prevent underflow to 0 if P is negative
                expTerm = 0;
            } else {
                expTerm = Math.exp(exponentVal);
            }
            
            // If C1 is Inf, P is -Inf (or Inf if R_start_n is also Inf). Result can be NaN.
            // If C1 is Inf, result should be Inf (assuming P*exp is not -Inf of same magnitude)
            if (this._cachedRnB_C1 === Infinity && this._cachedRnB_P * expTerm !== -Infinity) return Infinity;
            if (this._cachedRnB_C1 === -Infinity && this._cachedRnB_P * expTerm !== Infinity) return -Infinity;


            const result = this._cachedRnB_C1 + this._cachedRnB_P * expTerm;
            // If R_start_n was 0, C1 might be 0 (if b_n=0), P=0. Result 0.
            // If b_n=0, C1=0. C2=Inf. expTerm=0 (for B>0). Result=0. This matches R_n(B) decaying to 0.
            return result;
        }
    }
    // --- END ADDED ---
} 