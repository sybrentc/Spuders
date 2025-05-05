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
        this.totalAccumulatedTargetDamageR = 0; // Delta R accumulated *before* the current wave
        this.currentDn = 0; // Store the calculated dn for the current wave
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
            if (config.targetMaxWipeoutRadiusPercent <= 0 || config.targetMaxWipeoutRadiusPercent > 1) {
                 console.warn(`StrikeManager: targetMaxWipeoutRadiusPercent (${config.targetMaxWipeoutRadiusPercent}) should be between 0 and 1. Clamping or using as is? Using as is for now.`);
                 // Consider clamping: this.targetMaxWipeoutRadiusPercent = Math.max(0.01, Math.min(config.targetMaxWipeoutRadiusPercent, 1.0));
            }

            // Store loaded config values
            this.targetMaxWipeoutRadiusPercent = config.targetMaxWipeoutRadiusPercent;
            this.zBufferResolution = config.zBufferResolution;
            this.stampMapResolution = config.stampMapResolution;
            this.bombStrengthA = null; // Explicitly null, calculated later

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

    // --- ADDED: Helper for distance --- 
    _distance(x1, y1, x2, y2) {
        const dx = x2 - x1;
        const dy = y2 - y1;
        return Math.sqrt(dx * dx + dy * dy);
    }
    // --- END ADDED ---

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
                const dist = this._distance(originWorldPos.x, originWorldPos.y, currentWorldPos.x, currentWorldPos.y);
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
            if (hp <= 0 || defenderGridCol === null /*|| !defender.wearEnabled*/) {
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
        if (!this.game || !this.game.defenceManager || !this.configLoaded) {
            console.error("StrikeManager.startWave: Cannot start wave, dependencies missing or not ready.");
            return;
        }

        //console.log(`StrikeManager: Received start signal for Wave ${waveNumber} at ${timestamp.toFixed(0)}ms`);

        this.currentWaveNumber = waveNumber;
        this.currentWaveStartTime = timestamp;

        // Fetch and store R_n(0) for the new wave
        if (typeof this.game.defenceManager.getCurrentTotalEarningRate === 'function') {
            this.currentWaveStartTotalR = this.game.defenceManager.getCurrentTotalEarningRate();
            if (typeof this.currentWaveStartTotalR !== 'number' || !isFinite(this.currentWaveStartTotalR)) {
                console.warn(`StrikeManager.startWave: Invalid R_n(0) received (${this.currentWaveStartTotalR}). Setting to 0.`);
                this.currentWaveStartTotalR = 0;
            }
        } else {
             console.error("StrikeManager.startWave: DefenceManager.getCurrentTotalEarningRate method missing. Cannot get R_n(0). Setting to 0.");
             this.currentWaveStartTotalR = 0;
        }

        // Calculate and store dn for the new wave
        this.currentDn = this._calculateDn(this.currentWaveNumber);

        //console.log(`  -> Stored R_n(0)=${this.currentWaveStartTotalR.toFixed(4)}, dn=${this.currentDn.toFixed(4)}`);
    }
    // --- END ADDED ---

    // --- ADDED: Getter for the calculated target damage ---
    /**
     * Returns the total cumulative target damage (Delta R) up to the given timestamp.
     * It internally calls updateTargetDamageCalculation to ensure the value is current.
     * @param {number} timestamp - The current high-resolution timestamp (performance.now()).
     * @returns {number} The total target damage Delta R.
     */
    getCumulativeTargetDamageR(timestamp) {
        // REMOVED: Call to updateTargetDamageCalculation - state is now managed by startWave/finalizeWaveDamage

        // Initialize with damage accumulated from previous waves
        let currentTargetValue = this.totalAccumulatedTargetDamageR;

        // Check if enemies are present to calculate intra-wave delta
        const enemiesArePresent = this.game.enemyManager?.getActiveEnemies().length > 0;

        if (enemiesArePresent && 
            this.currentWaveNumber > 0 && 
            this.currentDn !== null && this.currentDn >= 0 && 
            this.currentWaveStartTotalR > 0)
        {
            const t_seconds = Math.max(0, (timestamp - this.currentWaveStartTime) / 1000.0);
            const deltaR_thisWave = this.currentWaveStartTotalR * (1 - Math.exp(-this.currentDn * t_seconds));
            
            if (isFinite(deltaR_thisWave) && deltaR_thisWave > 0) {
                currentTargetValue += deltaR_thisWave; // Add the intra-wave component
            }
        }
        // Else: No enemies present or calculation invalid, return only accumulated value

        return Math.max(0, currentTargetValue); // Ensure non-negative
    }
    // --- END ADDED ---

    // --- ADDED: Method to finalize damage accumulation for a completed wave ---
    /**
     * Calculates the final Delta R for a completed wave and adds it to the accumulator.
     * Called by WaveManager when a wave is cleared.
     * @param {number} waveNumber - The wave number that just finished.
     * @param {number} startTime - The timestamp (ms) when this wave started.
     * @param {number} clearTime - The timestamp (ms) when the last enemy of this wave was cleared.
     */
    finalizeWaveDamage(waveNumber, startTime, clearTime) {
        //console.log(`StrikeManager: Received finalize signal for Wave ${waveNumber}. Start: ${startTime.toFixed(0)}, Clear: ${clearTime.toFixed(0)}`);

        // Ensure the data we are finalizing *matches* the wave StrikeManager *thought* was running.
        // This is a safety check, though normally they should align perfectly.
        if (waveNumber !== this.currentWaveNumber) {
            console.error(`StrikeManager.finalizeWaveDamage: Mismatch! WaveManager cleared wave ${waveNumber}, but StrikeManager is on wave ${this.currentWaveNumber}. Accumulation might be incorrect.`);
            // Decide how to handle: skip accumulation? Use stored values anyway? For now, proceed but log error.
        }

        // Retrieve the R_n(0) and dn that were stored when this waveNumber started.
        const Rn0_forCompletedWave = this.currentWaveStartTotalR;
        const dn_forCompletedWave = this.currentDn;

        if (Rn0_forCompletedWave === null || dn_forCompletedWave === null) {
             console.error(`StrikeManager.finalizeWaveDamage: Missing R_n(0) or dn for completed wave ${waveNumber}. Cannot calculate final Delta R.`);
             return;
        }

        if (clearTime < startTime) {
             console.error(`StrikeManager.finalizeWaveDamage: Clear time (${clearTime}) is before start time (${startTime}) for wave ${waveNumber}. Cannot calculate duration.`);
             return;
        }

        // Calculate actual duration and final Delta R
        const effectiveDurationMs = clearTime - startTime;
        const effectiveDurationSec = effectiveDurationMs / 1000.0;
        let finalDeltaR = 0;

        // Only calculate if dn > 0 and R > 0, otherwise Delta R is 0
        if (dn_forCompletedWave > 0 && Rn0_forCompletedWave > 0 && effectiveDurationSec >= 0) {
            finalDeltaR = Rn0_forCompletedWave * (1 - Math.exp(-dn_forCompletedWave * effectiveDurationSec));
        }

        if (isFinite(finalDeltaR) && finalDeltaR > 0) {
            this.totalAccumulatedTargetDamageR += finalDeltaR;
            //console.log(`  -> Wave ${waveNumber} Final DeltaR: ${finalDeltaR.toFixed(4)} (Duration: ${effectiveDurationSec.toFixed(2)}s). New Accumulated Total: ${this.totalAccumulatedTargetDamageR.toFixed(4)}`);
        } else {
            //console.log(`  -> Wave ${waveNumber} Final DeltaR calculation resulted in zero or invalid value (${finalDeltaR.toFixed(4)}). Accumulator unchanged.`);
            // No change needed to totalAccumulatedTargetDamageR
        }
    }
    // --- END ADDED ---
} 