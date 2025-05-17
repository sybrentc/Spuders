import { distanceBetween } from './utils/geometryUtils.js';
import Striker from './models/striker.js';
import * as PIXI from 'pixi.js';

export default class StrikeManager {
    constructor(game) {
        if (!game) {
            throw new Error("StrikeManager requires a valid Game instance.");
        }
        this.game = game;
        this.defenceManager = game.defenceManager; // Assuming game has defenceManager

        // Config properties
        this.bombStrengthA = null;
        this.targetMaxWipeoutRadiusPercent = null;
        this.zBufferResolution = null;
        this.stampMapResolution = null;
        this.configLoaded = false;

        // Z-buffer/grid properties
        this.zBuffer = null;
        this.gridWidth = 0;  // Based on zBufferResolution
        this.gridHeight = 0; // Based on zBufferResolution
        this.cellWidth = 0;
        this.cellHeight = 0;
        this.mapWidth = 0;   // From game canvas
        this.mapHeight = 0;  // From game canvas

        // Stamp map properties
        this.stampMap = null;
        this.stampMapCenterCol = 0;
        this.stampMapCenterRow = 0;

        // --- ADDED: Properties for Target Damage Calculation ---
        this.currentWaveNumber = 0;
        this.currentWaveStartTime = 0; // Timestamp (ms) when the current wave started
        this.currentWaveStartTotalR = 0; // Total R at the start of the current wave
        this.currentDn = 0; // Store the calculated dn for the current wave
        // --- END ADDED ---

        // --- NEW PROPERTIES based on plan2.md ---
        this.totalTargetDestructionR = 0;           // I.1
        this.K_current_wave = null;                 // I.2
        this.Rn_at_wave_start = 0;                  // I.3
        this.Rn_at_last_bounty_checkpoint = 0;      // I.4
        this.bountyCollectedSinceLastCheckpoint = 0;// I.5
        this.bountyUpdateThreshold_B_star = null;   // I.6
        this.totalBountyForCurrentWave_Bn = 0;      // I.7
        this.projectedDurationCurrentWave_Tn = 0;   // I.8
        // --- END NEW PROPERTIES ---

        // --- ADDED: Tracker for bomb damage dealt ---
        this.totalBombDamageDealtR = 0; // Initialize tracker
        // --- END ADDED ---

        // --- ADDED: Impact Randomization --- 
        this.impactStdDevPixels = null; // Standard deviation for impact inaccuracy
        // --- END ADDED ---

        // --- ADDED: Explosion Animation Properties ---
        this.explosionAnimationConfig = null; // To store the raw config object
        this.explosionFrames = []; // To store loaded Image objects for frames
        this.explosionFrameWidth = 0; // Width of a single animation frame
        this.explosionFrameHeight = 0; // Height of a single animation frame
        this.explosionFrameDuration = 0; // Duration each frame is displayed
        this.explosionScale = 1.0; // Display scale of the explosion
        this.explosionAnchorX = 0.5; // Horizontal anchor
        this.explosionAnchorY = 0.5; // Vertical anchor
        this.loadedAnimationData = null; // Will hold all processed animation data
        // --- END ADDED ---

        // --- ADDED: bombPayload (Plan I.2b) ---
        this.bombPayload = null;
        // --- END ADDED ---

        // --- ADDED: Store bombCost and targetDamageUpdatePoints, calculate bountyUpdateThreshold_B_star ---
        this.bombCost = null; // Store for potential future use
        this.targetDamageUpdatePoints = null; // Store for potential future use
        // --- END ADDED ---

        // Strikers
        this.strikers = [];
        this.nextStrikerId = 0;

        // --- ADDED: PixiJS Heatmap Properties ---
        this.renderHeatmapDebug = false; // Set to true in console to show heatmap
        this.heatmapDrawingGraphic = new PIXI.Graphics(); // Off-screen graphic for drawing
        this.heatmapRenderTexture = null; // Will be initialized in _initializeHeatmapPixiObjects
        this.heatmapSprite = null;        // Sprite to display the render texture, added to stage
        // --- END ADDED ---
    }

    async loadConfig(path = 'assets/strike.json') {
        try {
            const response = await fetch(path);
            if (!response.ok) {
                throw new Error(`HTTP error loading strike config! status: ${response.status}`);
            }
            const config = await response.json();

            // Check for required fields
            if (config.targetMaxWipeoutRadiusPercent === undefined || !config.zBufferResolution || !config.stampMapResolution) {
                throw new Error("Strike config file is missing required fields (targetMaxWipeoutRadiusPercent, zBufferResolution, stampMapResolution).");
            }
            if (typeof config.bombCost !== 'number' || config.bombCost <= 0) {
                throw new Error("Strike config file is missing required field 'bombCost' or it's invalid (must be a positive number).");
            }
            if (typeof config.targetDamageUpdatePoints !== 'number' || config.targetDamageUpdatePoints <= 0) {
                throw new Error("Strike config file is missing required field 'targetDamageUpdatePoints' or it's invalid (must be a positive number).");
            }
            if (config.targetMaxWipeoutRadiusPercent <= 0 || config.targetMaxWipeoutRadiusPercent > 1) {
                 console.warn(`StrikeManager: targetMaxWipeoutRadiusPercent (${config.targetMaxWipeoutRadiusPercent}) should be between 0 and 1. Clamping or using as is? Using as is for now.`);
            }

            // --- ADDED: Load Explosion Animation Config ---
            if (!config.explosionAnimation) {
                throw new Error("Strike config file is missing 'explosionAnimation' object.");
            }
            const animConfig = config.explosionAnimation;
            if (!animConfig.folderPath || typeof animConfig.frameDuration !== 'number' || typeof animConfig.scale !== 'number' || typeof animConfig.anchorX !== 'number' || typeof animConfig.anchorY !== 'number') {
                throw new Error("Strike config 'explosionAnimation' is missing required fields (folderPath, frameDuration, scale, anchorX, anchorY) or they are of incorrect type.");
            }
            this.explosionAnimationConfig = animConfig; // Store the raw config
            this.explosionFrameDuration = animConfig.frameDuration;
            this.explosionScale = animConfig.scale;
            this.explosionAnchorX = animConfig.anchorX;
            this.explosionAnchorY = animConfig.anchorY;
            // Note: explosionFrames, explosionFrameWidth, explosionFrameHeight will be populated by a separate method after this.
            // --- END ADDED ---

            // Store loaded config values
            this.targetMaxWipeoutRadiusPercent = config.targetMaxWipeoutRadiusPercent;
            this.zBufferResolution = config.zBufferResolution;
            this.stampMapResolution = config.stampMapResolution;
            this.bombStrengthA = null; // Explicitly null, calculated later

            // --- ADDED: Store bombCost and targetDamageUpdatePoints, calculate bountyUpdateThreshold_B_star ---
            this.bombCost = config.bombCost; // Store for potential future use
            this.targetDamageUpdatePoints = config.targetDamageUpdatePoints; // Store for potential future use
            this.bountyUpdateThreshold_B_star = this.bombCost / this.targetDamageUpdatePoints;
            if (!isFinite(this.bountyUpdateThreshold_B_star) || this.bountyUpdateThreshold_B_star <= 0) {
                console.error(`StrikeManager: Calculated bountyUpdateThreshold_B_star is invalid (${this.bountyUpdateThreshold_B_star}). Check bombCost and targetDamageUpdatePoints in strike.json.`);
                // Potentially throw an error or set a default, for now, logging error and proceeding with potentially problematic value
            } else {
                // console.log(`StrikeManager: bountyUpdateThreshold_B_star calculated to ${this.bountyUpdateThreshold_B_star}`);
            }
            // --- END ADDED ---

            // --- ADDED: Load and calculate impact deviation --- 
            if (typeof config.impactStdDevPercentWidth !== 'number' || config.impactStdDevPercentWidth < 0) {
                console.warn(`StrikeManager: Invalid or missing impactStdDevPercentWidth in config. Defaulting to 0 (no spread).`);
                this.impactStdDevPixels = 0;
            } else {
                 // Get map dimensions from game canvas (needs to be done before this)
                 this.mapWidth = this.game.canvas.width;
                 this.mapHeight = this.game.canvas.height;

                 this.impactStdDevPixels = config.impactStdDevPercentWidth * this.mapWidth;
                 //console.log(`StrikeManager: Impact std deviation set to ${this.impactStdDevPixels.toFixed(2)} pixels (${config.impactStdDevPercentWidth * 100}% of width).`);
            }
            // --- END ADDED ---

            // Get map dimensions from game canvas
            this.mapWidth = this.game.canvas.width;
            this.mapHeight = this.game.canvas.height;

            // Calculate Z-buffer grid properties
            this.gridWidth = this.zBufferResolution.width;
            this.gridHeight = this.zBufferResolution.height;
            this.cellWidth = this.mapWidth / this.gridWidth;
            this.cellHeight = this.mapHeight / this.gridHeight;

            // Initialize Z-buffer
            this.zBuffer = Array(this.gridHeight).fill(null).map(() => Array(this.gridWidth).fill(0));

            // --- MOVED configLoaded flag setting ---
            this.configLoaded = true; // Set flag BEFORE calling dependent functions
            // --- END MOVED ---

            // --- Call stamp map precomputation ---
            this._precomputeStampMap();
            // --- END Call ---

            // --- ADDED: Call to load explosion frames ---
            await this._loadExplosionFrames(); 
            // --- END ADDED ---

            // --- ADDED: Initialize Heatmap Pixi Objects ---
            this._initializeHeatmapPixiObjects();
            // --- END ADDED ---

        } catch (error) {
            console.error("StrikeManager: Failed to load configuration:", error);
            this.configLoaded = false;
            // Potentially re-throw or handle initialization failure
        }
    }

    isConfigLoaded() {
        return this.configLoaded;
    }

    // --- ADDED: Method to calculate bomb strength dynamically ---
    calculateBombStrength() {
        if (!this.configLoaded || !this.defenceManager) {
            console.error("StrikeManager.calculateBombStrength: Cannot calculate, config or DefenceManager not ready.");
            return;
        }
        if (!this.defenceManager.isLoaded) {
             console.warn("StrikeManager.calculateBombStrength: DefenceManager definitions not loaded yet. Skipping calculation.");
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
            this.bombStrengthA = 0; // Set A to 0 as a fallback?
            return;
        }

        // Calculate target radius in pixels
        const targetRadiusPx = this.targetMaxWipeoutRadiusPercent * this.mapWidth;

        // Calculate A = r^2 * h_min (where h_min is minWearDecrement)
        const calculatedA = targetRadiusPx * targetRadiusPx * minWearDecrement;
        this.bombStrengthA = Math.max(0, calculatedA); // Ensure non-negative

        // --- ADDED: Initialize bombPayload (Plan I.2b) ---
        if (this.bombStrengthA !== null && this.bombStrengthA > 0) { 
            const animationData = this.getLoadedAnimationData();
            // Ensure impactStdDevPixels is a number (it could be 0 for no spread)
            if (animationData && typeof this.impactStdDevPixels === 'number') {
                 this.bombPayload = {
                    strengthA: this.bombStrengthA,
                    animation: animationData,
                    impactStdDevPixels: this.impactStdDevPixels
                };
                // console.log("StrikeManager: bombPayload initialized.", this.bombPayload); // Optional log for verification
            } else {
                console.warn("StrikeManager: Could not initialize bombPayload. Missing animation data or impactStdDevPixels is not set.", 
                             { animationDataReady: !!animationData, impactStdDevPixels: this.impactStdDevPixels });
            }
        } else {
            // If bombStrengthA is 0 or null, bombPayload remains null, which is fine.
            // dispatchStriker should later check if bombPayload is ready.
            // console.warn("StrikeManager: bombStrengthA is not valid (<=0 or null), bombPayload not initialized."); // Optional log
        }
        // --- END ADDED ---

        //console.log(`StrikeManager: Calculated Bomb Strength A = ${this.bombStrengthA.toFixed(2)} (using minWearDecrement=${minWearDecrement.toFixed(4)}, targetRadius=${targetRadiusPx.toFixed(1)}px)`);

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

    renderZBuffer(ctx) {
        // DEBUG: Check if function is called - MOVED TO VERY TOP
        //console.log("StrikeManager: renderZBuffer called - Entry Point");

        if (!this.configLoaded || !this.zBuffer) {
            return; // Don't render if not ready
        }

        // --- Find Max Z-Value --- 
        let maxZ = 0;
        for (let r = 0; r < this.gridHeight; r++) {
            for (let c = 0; c < this.gridWidth; c++) {
                if (this.zBuffer[r][c] > maxZ) {
                    maxZ = this.zBuffer[r][c];
                }
            }
        }
        // --- End Find Max Z --- 

        ctx.save();
        let cellsDrawn = 0; // DEBUG: Count cells
        // Iterate through the Z-buffer grid
        for (let r = 0; r < this.gridHeight; r++) {
            for (let c = 0; c < this.gridWidth; c++) {
                const zValue = this.zBuffer[r][c];

                if (zValue > 0) {
                    cellsDrawn++; // DEBUG: Increment count

                    // Check if this cell has the max value
                    if (maxZ > 0 && zValue === maxZ) {
                        // --- Max Value Color (Green) ---
                        ctx.fillStyle = 'rgba(0, 255, 0, 0.7)'; // Semi-transparent green
                    } else {
                        // --- Regular Heatmap Color (Red) ---
                        // const visualZValue = zValue * 50; // REMOVED Amplification
                        // Simple intensity scaling - USE zValue directly, adjust divisor to 5.0
                        const intensity = Math.min(1.0, zValue / 5.0);
                        // Use a semi-transparent red for the heatmap - INCREASED ALPHA
                        ctx.fillStyle = `rgba(255, 0, 0, ${0.2 + intensity * 0.5})`; // Start with base alpha, increase with intensity
                    }

                    // Calculate world coordinates for the top-left of the cell
                    const drawX = c * this.cellWidth;
                    const drawY = r * this.cellHeight;

                    // Draw the cell
                    ctx.fillRect(drawX, drawY, this.cellWidth, this.cellHeight);
                }
            }
        }
        // DEBUG: Log if any cells were drawn
        // if (cellsDrawn > 0) {
        //     console.log(`StrikeManager: Drew ${cellsDrawn} heatmap cells.`);
        // }
        ctx.restore();
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
     * Uses Eq. 32: dn = ((f - 1) / T0) + (1 / Tn) * (1 - (f / gamma_n))
     * where gamma_n = Tn+1 / Tn and T0 = L / s_min.
     * @param {number} waveNumber - The wave number (n) to calculate dn for.
     * @returns {number} The calculated dn, or 0 if calculation fails or dn < 0.
     * @private
     */
    _calculateDn(waveNumber) {
        if (!this.game || !this.game.waveManager || !this.game.enemyManager) {
            console.error("StrikeManager._calculateDn: Missing required game managers.");
            return 0;
        }

        // 1. Get Parameters
        const f = this.game.waveManager.getDifficultyIncreaseFactor();
        const L = this.game.getTotalPathLength();
        const s_min = this.game.enemyManager.getMinimumEnemySpeed();
        const Tn = this.game.waveManager.getWaveDurationSeconds(waveNumber);
        const Tn_plus_1 = this.game.waveManager.getWaveDurationSeconds(waveNumber + 1);

        // 2. Validate Parameters
        if (f === undefined || f === null || f <= 1) {
            console.error(`StrikeManager._calculateDn: Invalid difficulty increase factor (f=${f}). Must be > 1.`);
            return 0;
        }
        if (L === undefined || L === null || L <= 0) {
            console.error(`StrikeManager._calculateDn: Invalid total path length (L=${L}). Must be > 0.`);
            return 0;
        }
        if (s_min === undefined || s_min === null || s_min <= 0) {
            console.error(`StrikeManager._calculateDn: Invalid minimum enemy speed (s_min=${s_min}). Must be > 0.`);
            return 0;
        }
        if (Tn === undefined || Tn === null || Tn <= 1e-6) { // Use epsilon for duration check
            console.warn(`StrikeManager._calculateDn: Invalid duration Tn (${Tn}) for wave ${waveNumber}. Cannot calculate dn.`);
            return 0;
        }
        if (Tn_plus_1 === undefined || Tn_plus_1 === null) {
            console.warn(`StrikeManager._calculateDn: Duration Tn+1 not available for wave ${waveNumber}. Cannot calculate dn.`);
            // Potentially use dn = (f-1)/T0 as fallback? Returning 0 for now.
            return 0;
        }
        // Check Tn+1 specifically for <= 0, as gamma calculation needs positive divisor
        if (Tn_plus_1 <= 1e-6) {
             console.warn(`StrikeManager._calculateDn: Invalid duration Tn+1 (${Tn_plus_1}) for wave ${waveNumber}. Cannot calculate dn.`);
             return 0;
        }

        // 3. Calculate Intermediate Values
        const T0 = L / s_min;
        if (T0 <= 0) {
            console.error(`StrikeManager._calculateDn: Calculated T0 (${T0}) is not positive.`);
            return 0;
        }

        const gamma_n = Tn_plus_1 / Tn;
        // Check gamma_n validity (redundant due to Tn/Tn+1 checks, but safe)
        if (!isFinite(gamma_n) || gamma_n <= 0) {
            console.error(`StrikeManager._calculateDn: Invalid gamma_n (${gamma_n}) calculated for wave ${waveNumber}.`);
            return 0;
        }

        // 4. Calculate dn using Eq. 32
        const term1 = (f - 1) / T0;
        const term2_bracket = 1 - (f / gamma_n);
        const term2 = (1 / Tn) * term2_bracket;
        const dn = term1 + term2;

        // Ensure dn is not negative
        const final_dn = Math.max(0, dn);
        
        // Optional log for debugging
         //console.log(`_calculateDn(wave=${waveNumber}): f=${f.toFixed(2)}, T0=${T0.toFixed(2)}, Tn=${Tn.toFixed(2)}, Tn+1=${Tn_plus_1.toFixed(2)}, gamma_n=${gamma_n.toFixed(2)} => dn=${final_dn.toFixed(4)}`);

        return final_dn;
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
            if (!isFinite(this.K_current_wave) || this.K_current_wave < 0) {
                 console.warn(`StrikeManager.startWave: Calculated K_current_wave is invalid (${this.K_current_wave}). Setting to null. Dn=${this.currentDn}, Tn=${this.projectedDurationCurrentWave_Tn}, Bn=${this.totalBountyForCurrentWave_Bn}`);
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
        return Math.max(0, this.totalTargetDestructionR);
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
    async dispatchStriker(targetCoords, strikeContext) {
        if (!this.game) { 
            console.error("StrikeManager.dispatchStriker: Game instance not available.");
            return 0;
        }
        if (!this.bombPayload) {
            console.error("StrikeManager.dispatchStriker: bombPayload is not initialized. Cannot dispatch striker.");
            return 0;
        }
        if (!targetCoords || typeof targetCoords.x !== 'number' || typeof targetCoords.y !== 'number') {
            console.error("StrikeManager.dispatchStriker: Invalid targetCoords provided.", targetCoords);
            return 0;
        }
        if (!strikeContext) {
            console.error("StrikeManager.dispatchStriker: strikeContext (game or clonedDefenders) not provided.");
            return 0;
        }

        const striker = new Striker(this.bombPayload, targetCoords, strikeContext);

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

    // --- ADDED: Getter for loaded animation data ---
    getLoadedAnimationData() {
        if (!this.loadedAnimationData && this.configLoaded && this.explosionAnimationConfig) {
            // This is a placeholder. In a real scenario, _loadExplosionFrames would populate this.
            // For now, we'll construct it if the base elements are there.
            // This assumes _loadExplosionFrames has been called and populated the frame-specific details.
             if (this.explosionFrames.length > 0 && this.explosionFrameWidth > 0 && this.explosionFrameHeight > 0) {
                this.loadedAnimationData = {
                    frames: this.explosionFrames,
                    frameWidth: this.explosionFrameWidth,
                    frameHeight: this.explosionFrameHeight,
                    frameDuration: this.explosionFrameDuration,
                    scale: this.explosionScale,
                    anchorX: this.explosionAnchorX,
                    anchorY: this.explosionAnchorY,
                    totalFrames: this.explosionFrames.length
                };
             } else {
                // console.warn("StrikeManager.getLoadedAnimationData: Explosion frames not loaded or dimensions undetermined.");
                return null;
             }
        }
        return this.loadedAnimationData;
    }
    // --- END ADDED ---

    // --- ADDED: Method to load explosion frame images ---
    async _loadExplosionFrames() {
        if (!this.explosionAnimationConfig || !this.explosionAnimationConfig.folderPath) {
            console.error("StrikeManager._loadExplosionFrames: Explosion animation folderPath not configured.");
            return;
        }
        if (typeof this.explosionAnimationConfig.frameCount !== 'number' || this.explosionAnimationConfig.frameCount <= 0) {
            console.error("StrikeManager._loadExplosionFrames: Invalid or missing frameCount in explosionAnimation config.");
            return;
        }
        if (typeof this.explosionAnimationConfig.digitsForZeroPadding !== 'number' || this.explosionAnimationConfig.digitsForZeroPadding <= 0) {
            console.error("StrikeManager._loadExplosionFrames: Invalid or missing digitsForZeroPadding in explosionAnimation config.");
            return;
        }

        const folderPath = this.explosionAnimationConfig.folderPath;
        const frameCount = this.explosionAnimationConfig.frameCount;
        const digits = this.explosionAnimationConfig.digitsForZeroPadding;
        const fileSuffix = '.png'; // Assuming .png, could be made configurable if needed

        try {
            let fileNames = [];
            for (let i = 1; i <= frameCount; i++) {
                const frameNumberStr = i.toString().padStart(digits, '0');
                fileNames.push(frameNumberStr + fileSuffix);
            }

            // Actual image loading logic (conceptual for now, replace with real JS Image loading)
            // In your actual JS environment, this.explosionFrames should end up as an array of Image objects.
            this.explosionFrames = []; // Reset before loading
            const imagePromises = fileNames.map(fileName => {
                const fullPath = folderPath + fileName; // Ensure folderPath ends with '/'
                // In real JS:
                return new Promise((resolve) => { // Simplified error handling for clarity, real version might reject or resolve with null
                    const img = new Image();
                    img.onload = () => {
                        // console.log(`Successfully loaded image: ${fullPath}`);
                        resolve(img);
                    };
                    img.onerror = () => {
                        console.error(`Failed to load image: ${fullPath}`);
                        resolve(null); // Resolve with null on error to not break Promise.all
                    };
                    img.src = fullPath;
                });
                // return Promise.resolve(fullPath); // Placeholder: resolves with path for now, representing successful load intent
            });

            const loadedImages = await Promise.all(imagePromises);
            // Filter out any nulls from failed loads and ensure they are Image objects
            this.explosionFrames = loadedImages.filter(img => img instanceof Image);

            if (this.explosionFrames.length > 0) {
                const firstImage = this.explosionFrames[0];
                // Ensure the first image is actually loaded and has dimensions
                if (firstImage.complete && firstImage.naturalWidth > 0 && firstImage.naturalHeight > 0) {
                    this.explosionFrameWidth = firstImage.naturalWidth;
                    this.explosionFrameHeight = firstImage.naturalHeight;
                } else {
                    // This case might happen if the first image object exists but its data isn't ready
                    // or it failed to load in a way not caught by onerror (less common)
                    // Or if it's a 0x0 image.
                    console.error("StrikeManager._loadExplosionFrames: First frame image not fully loaded or has no dimensions. Using config/defaults.");
                    this.explosionFrameWidth = this.explosionAnimationConfig.frameWidth || 64; // Fallback
                    this.explosionFrameHeight = this.explosionAnimationConfig.frameHeight || 64; // Fallback
                }
            } else {
                console.error("StrikeManager._loadExplosionFrames: No explosion frames were successfully loaded as Image objects.");
                // Keep width/height as 0 or default from config if needed elsewhere
                this.explosionFrameWidth = this.explosionAnimationConfig.frameWidth || 0;
                this.explosionFrameHeight = this.explosionAnimationConfig.frameHeight || 0;
            }

            // Populate loadedAnimationData once frames are processed
            if (this.explosionFrames.length > 0 && this.explosionFrameWidth > 0 && this.explosionFrameHeight > 0) {
                this.loadedAnimationData = {
                    frames: this.explosionFrames, // Array of Image objects (or paths for now)
                    frameWidth: this.explosionFrameWidth,
                    frameHeight: this.explosionFrameHeight,
                    frameDuration: this.explosionFrameDuration,
                    scale: this.explosionScale,
                    anchorX: this.explosionAnchorX,
                    anchorY: this.explosionAnchorY,
                    totalFrames: this.explosionFrames.length
                };
            } else {
                 this.loadedAnimationData = null; // Ensure it's null if loading fails
                 // Error already logged if no frames were loaded, or if dimensions are zero.
            }

        } catch (error) {
            console.error(`StrikeManager._loadExplosionFrames: Error processing explosion frames from ${folderPath}:`, error);
            this.explosionFrames = [];
            this.loadedAnimationData = null;
        }
    }
    // --- END ADDED ---

    // --- ADDED: Test function to trigger a strike ---
    async strike() {
        if (!this.isConfigLoaded()) {
            console.error("StrikeManager.strike(): Cannot strike, config not loaded.");
            return;
        }
        if (!this.bombPayload) {
            console.error("StrikeManager.strike(): Cannot strike, bombPayload not ready.");
            return;
        }

        //console.log("StrikeManager.strike(): Attempting to find optimal target...");
        const targetCoords = this.findOptimalTarget();

        if (targetCoords) {
            //console.log(`StrikeManager.strike(): Optimal target found at (${targetCoords.x.toFixed(1)}, ${targetCoords.y.toFixed(1)}). Dispatching striker...`);
            try {
                // dispatchStriker is async and returns a promise that resolves with damageDealtR
                const deltaR = await this.dispatchStriker(targetCoords, this.game);
                console.log(`StrikeManager.strike(): Strike completed. Delta R from defenders: ${deltaR !== undefined && deltaR !== null ? deltaR.toFixed(4) : 'N/A'}`);
                
                // If you need to update the totalBombDamageDealtR for real strikes, this is where it would happen
                // (though the plan moved this responsibility outside dispatchStriker)
                // For this test function, we're just logging.
                // if (typeof deltaR === 'number' && deltaR > 0) {
                //     this.totalBombDamageDealtR += deltaR;
                //     console.log(`   Updated totalBombDamageDealtR: ${this.totalBombDamageDealtR.toFixed(4)}`);
                // }

            } catch (error) {
                console.error("StrikeManager.strike(): Error during dispatchStriker or strike execution:", error);
            }
        } else {
            console.log("StrikeManager.strike(): No optimal target found. Strike aborted.");
        }
    }
    // --- END ADDED ---

    // --- NEW METHOD: _updateTargetDestructionForBatch (Plan II.5) ---
    /**
     * Calculates ΔR for a completed bounty batch (B*) and updates totalTargetDestructionR.
     * @param {number} bountyProcessedThisBatch - The amount of bounty in this batch (typically B*).
     * @private
     */
    _updateTargetDestructionForBatch(bountyProcessedThisBatch) {
        if (this.K_current_wave === null || this.K_current_wave <= 0 || this.Rn_at_last_bounty_checkpoint <= 0) {
            // console.log("StrikeManager._updateTargetDestructionForBatch: Conditions not met for destruction calculation.", 
            //              { K: this.K_current_wave, R_checkpoint: this.Rn_at_last_bounty_checkpoint });
            return; // No destruction to apply if K is invalid or no earning rate to destroy
        }

        const Rn_before_segment = this.Rn_at_last_bounty_checkpoint;
        // K_current_wave already incorporates Bn in its denominator, so the exponent is -K_n * B_processed
        const exp_decay_factor = Math.exp(-this.K_current_wave * bountyProcessedThisBatch);
        const Rn_after_segment = Rn_before_segment * exp_decay_factor;
        const deltaR_increment = Rn_before_segment - Rn_after_segment;

        this.totalTargetDestructionR += deltaR_increment;
        this.Rn_at_last_bounty_checkpoint = Rn_after_segment;

        // console.log(`StrikeManager._updateTargetDestructionForBatch: Processed bounty ${bountyProcessedThisBatch}. ` +
        //             `Rn_before: ${Rn_before_segment.toFixed(2)}, Rn_after: ${Rn_after_segment.toFixed(2)}, ` +
        //             `deltaR: ${deltaR_increment.toFixed(2)}, totalTargetDestructionR: ${this.totalTargetDestructionR.toFixed(2)}`);
    }

    // --- NEW METHOD: recordBountyEarned (Plan II.4) ---
    /**
     * Called by game logic whenever bounty is awarded for an enemy kill.
     * Accumulates bounty and triggers updates to target destruction when threshold B* is met.
     * @param {number} bountyIncrement - The amount of bounty earned (ΔB).
     */
    recordBountyEarned(bountyIncrement) {
        if (!this.configLoaded || this.K_current_wave === null || this.Rn_at_wave_start <= 0 || this.bountyUpdateThreshold_B_star === null || this.bountyUpdateThreshold_B_star <= 0) {
            // console.log("StrikeManager.recordBountyEarned: Conditions not met for processing bounty.",
            //              { configLoaded: this.configLoaded, K: this.K_current_wave, R_start: this.Rn_at_wave_start, B_star: this.bountyUpdateThreshold_B_star });
            return; // Cannot process if not configured, K is invalid, no initial R, or B* is invalid
        }

        if (typeof bountyIncrement !== 'number' || bountyIncrement <= 0) {
            // console.warn(`StrikeManager.recordBountyEarned: Invalid bountyIncrement (${bountyIncrement}). Ignoring.`);
            return;
        }

        this.bountyCollectedSinceLastCheckpoint += bountyIncrement;
        // console.log(`StrikeManager.recordBountyEarned: Bounty ${bountyIncrement.toFixed(2)} recorded. ` +
        //             `Collected since last checkpoint: ${this.bountyCollectedSinceLastCheckpoint.toFixed(2)} / ${this.bountyUpdateThreshold_B_star.toFixed(2)}`);

        // Process completed B* batches
        while (this.bountyCollectedSinceLastCheckpoint >= this.bountyUpdateThreshold_B_star) {
            // console.log(`StrikeManager.recordBountyEarned: Threshold B* met. Processing batch of ${this.bountyUpdateThreshold_B_star.toFixed(2)}.`);
            this._updateTargetDestructionForBatch(this.bountyUpdateThreshold_B_star);
            this.bountyCollectedSinceLastCheckpoint -= this.bountyUpdateThreshold_B_star;
            // console.log(`StrikeManager.recordBountyEarned: Remaining collected bounty: ${this.bountyCollectedSinceLastCheckpoint.toFixed(2)}`);
        }
    }

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
            striker.update(deltaTime);
            if (striker.isDone()) {
                striker.destroy(); // Ensure Pixi objects are cleaned up
                this.strikers.splice(i, 1);
            }
        }

        // --- ADDED: Heatmap Update Logic ---
        if (this.heatmapSprite && this.game.app?.renderer) { // Ensure Pixi objects are ready
            if (this.renderHeatmapDebug) {
                if (!this.heatmapSprite.visible) {
                    this.heatmapSprite.visible = true;
                }
                // Assuming calculateZBuffer() is called elsewhere (e.g., in Game.js update or before this manager's update)
                // and it updates this.zBuffer
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
} 