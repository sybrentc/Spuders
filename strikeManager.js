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

        // Clear the Z-buffer (fill with zeros)
        for (let r = 0; r < this.gridHeight; r++) {
            this.zBuffer[r].fill(0);
        }

        // Iterate through each active defender
        for (const defender of defenders) {
            const hp = defender.hp; // This is the scaled health
            const defenderGridCol = defender.gridCol;
            const defenderGridRow = defender.gridRow;

            // Skip if defender has no health, no grid position yet, OR if wear is not enabled
            if (hp <= 0 || defenderGridCol === null || !defender.wearEnabled) {
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
                        this.zBuffer[targetRow][targetCol]++;
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
} 