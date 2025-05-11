const fs = require('fs').promises;
const path = require('path');
const { distanceBetween, minDistanceToPath } = require('../../utils/geometryUtils.js');

// --- Utility Functions (adapted from game code) ---

/**
 * Loads path data from a CSV file.
 * @param {string} filePath
 * @returns {Promise<Array<{x: number, y: number}>>}
 */
async function loadCsvPath(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        const lines = data.trim().split('\n');
        return lines.map(line => {
            const [x, y] = line.split(',').map(Number);
            if (isNaN(x) || isNaN(y)) {
                throw new Error(`Invalid data in CSV line: ${line}`);
            }
            return { x, y };
        });
    } catch (error) {
        console.error(`Error loading CSV path from ${filePath}:`, error);
        throw error;
    }
}

/**
 * Saves path data to a CSV file.
 * @param {string} filePath
 * @param {Array<{x: number, y: number}>} pathData
 */
async function savePathToCsv(filePath, pathData) {
    try {
        const csvContent = pathData.map(p => `${p.x},${p.y}`).join('\n');
        await fs.writeFile(filePath, csvContent, 'utf8');
        console.log(`Successfully saved path to ${filePath}`);
    } catch (error) {
        console.error(`Error saving path CSV to ${filePath}:`, error);
        throw error;
    }
}

/**
 * Saves the coverage lookup table to a CSV file.
 * @param {string} filePath
 * @param {Array<[number, number]>} coverageData - Array of [range, coverageFraction] pairs.
 */
async function saveCoverageToCsv(filePath, coverageData) {
    try {
        const header = 'range,coverage_fraction';
        const csvContent = [header, ...coverageData.map(([range, fraction]) => `${range},${fraction.toFixed(8)}`)].join('\n');
        await fs.writeFile(filePath, csvContent, 'utf8');
        console.log(`Successfully saved coverage lookup table to ${filePath}`);
    } catch (error) {
        console.error(`Error saving coverage CSV to ${filePath}:`, error);
        throw error;
    }
}

/**
 * Saves the optimal defender positions to a CSV file.
 * @param {string} filePath
 * @param {Array<{range: number, x: number, y: number}>} positionData - Array of objects containing range, optimal x, and optimal y.
 */
async function saveOptimumPositionsToCsv(filePath, positionData) {
    try {
        const header = 'range,optimal_x,optimal_y';
        // Ensure data is in the expected format {range, x, y}
        const csvContent = [header, ...positionData.map(d => `${d.range},${d.x.toFixed(4)},${d.y.toFixed(4)}`)].join('\n');
        await fs.writeFile(filePath, csvContent, 'utf8');
        console.log(`Successfully saved optimal positions to ${filePath}`);
    } catch (error) {
        console.error(`Error saving optimum positions CSV to ${filePath}:`, error);
        throw error;
    }
}

/**
 * Loads JSON data from a file.
 * @param {string} filePath
 * @returns {Promise<any>}
 */
async function loadJson(filePath) {
    try {
        const data = await fs.readFile(filePath, 'utf8');
        return JSON.parse(data);
    } catch (error) {
        console.error(`Error loading JSON from ${filePath}:`, error);
        throw error;
    }
}

/**
 * Calculates the maximum diagonal of scaled enemy sprites.
 * @param {Array<object>} enemyTypes - Array of enemy definitions.
 * @returns {number} - The maximum diagonal length.
 */
function calculateMaxSpriteDiagonal(enemyTypes) {
    let maxDiagonalSq = 0;
    if (!Array.isArray(enemyTypes)) {
        console.error("calculateMaxSpriteDiagonal: enemyTypes is not an array.");
        return 0;
    }
    for (const def of enemyTypes) {
        if (def && def.sprite && def.display) {
            const w = def.sprite.frameWidth || 0;
            const h = def.sprite.frameHeight || 0;
            const s = def.display.scale || 1;
            const diagonalSq = (w * w + h * h) * s * s; // Compare squared distances
            if (diagonalSq > maxDiagonalSq) {
                maxDiagonalSq = diagonalSq;
            }
        }
    }
    const maxDiagonal = Math.sqrt(maxDiagonalSq);
    console.log(`Calculated max sprite diagonal for path extension: ${maxDiagonal.toFixed(1)}px`);
    return maxDiagonal; // Return the actual diagonal, not squared
}

/**
 * Generates an extended path by adding points before the start and after the end.
 * @param {Array<{x: number, y: number}>} originalPath - The original waypoints.
 * @param {number} extensionDistance - The distance to extend outwards.
 * @returns {Array<{x: number, y: number}>} - The extended path data.
 */
function generateExtendedPath(originalPath, extensionDistance) {
    if (!originalPath || originalPath.length < 2) {
       console.warn(`generateExtendedPath: Cannot extend path with less than 2 waypoints.`);
       return originalPath || [];
   }
   if (extensionDistance <= 0) {
        console.warn(`generateExtendedPath: Extension distance (${extensionDistance}) is zero or negative. Returning original path.`);
        return [...originalPath]; // Return a copy
   }

   // Calculate Spawn Point
   const p0 = originalPath[0];
   const p1 = originalPath[1];
   let normStartX = 0, normStartY = 0;
   const dxStart = p1.x - p0.x, dyStart = p1.y - p0.y;
   const distStart = Math.sqrt(dxStart * dxStart + dyStart * dyStart);
   if (distStart > 0.001) { normStartX = dxStart / distStart; normStartY = dyStart / distStart; }
   const spawnPoint = { x: p0.x - normStartX * extensionDistance, y: p0.y - normStartY * extensionDistance };

   // Calculate Despawn Point
   const pn = originalPath[originalPath.length - 1];
   const pn_1 = originalPath[originalPath.length - 2];
   let normEndX = 0, normEndY = 0;
   const dxEnd = pn.x - pn_1.x, dyEnd = pn.y - pn_1.y;
   const distEnd = Math.sqrt(dxEnd * dxEnd + dyEnd * dyEnd);
   if (distEnd > 0.001) { normEndX = dxEnd / distEnd; normEndY = dyEnd / distEnd; }
   const despawnPoint = { x: pn.x + normEndX * extensionDistance, y: pn.y + normEndY * extensionDistance };

   return [spawnPoint, ...originalPath, despawnPoint];
}

/**
 * Calculates the total length of a path defined by waypoints.
 * @param {Array<{x: number, y: number}>} pathData
 * @returns {number}
 */
function calculateTotalLength(pathData) {
    let totalLength = 0;
    if (!pathData || pathData.length < 2) return 0;
    for (let i = 0; i < pathData.length - 1; i++) {
        totalLength += distanceBetween(pathData[i], pathData[i + 1]);
    }
    return totalLength;
}

/**
 * Finds the cumulative distances along a path.
 * @param {Array<{x: number, y: number}>} pathData
 * @returns {{segmentLengths: number[], cumulativeDistances: number[]}}
 */
function calculatePathMetrics(pathData) {
    const segmentLengths = [];
    const cumulativeDistances = [];
    let currentCumulativeDistance = 0;
    if (!pathData || pathData.length < 2) {
        return { segmentLengths, cumulativeDistances };
    }
    for (let i = 0; i < pathData.length - 1; i++) {
        const p1 = pathData[i];
        const p2 = pathData[i + 1];
        const length = distanceBetween(p1, p2);
        segmentLengths.push(length);
        currentCumulativeDistance += length;
        cumulativeDistances.push(currentCumulativeDistance);
    }
    return { segmentLengths, cumulativeDistances };
}

/**
 * Calculates the (x, y) coordinates at a specific distance along the path.
 * @param {Array<{x: number, y: number}>} pathData
 * @param {number[]} cumulativeDistances
 * @param {number[]} segmentLengths
 * @param {number} targetDistance
 * @returns {{x: number, y: number} | null}
 */
function getPointAtDistance(pathData, cumulativeDistances, segmentLengths, targetDistance) {
    if (!pathData || pathData.length === 0 || targetDistance < 0) return null;
    if (targetDistance === 0) return { ...pathData[0] }; // Return copy of start point

    let targetSegmentIndex = -1;
    for (let i = 0; i < cumulativeDistances.length; i++) {
        if (targetDistance <= cumulativeDistances[i]) {
            targetSegmentIndex = i;
            break;
        }
    }

    if (targetSegmentIndex === -1) {
        // Target distance is beyond the last cumulative distance, return end point
        return { ...pathData[pathData.length - 1] };
    }

    const p1 = pathData[targetSegmentIndex];
    const p2 = pathData[targetSegmentIndex + 1];
    const distanceToStartOfSegment = (targetSegmentIndex === 0) ? 0 : cumulativeDistances[targetSegmentIndex - 1];
    const distanceIntoSegment = targetDistance - distanceToStartOfSegment;
    const segmentLength = segmentLengths[targetSegmentIndex];

    // Avoid division by zero for zero-length segments
    const factor = (segmentLength > 1e-6) ? (distanceIntoSegment / segmentLength) : 0;

    const x = p1.x + (p2.x - p1.x) * factor;
    const y = p1.y + (p2.y - p1.y) * factor;
    return { x, y };
}

/**
 * Calculates the length of the intersection between a line segment and a circle.
 * @param {{x: number, y: number}} p1 Segment start point
 * @param {{x: number, y: number}} p2 Segment end point
 * @param {{x: number, y: number}} circleCenter Circle center
 * @param {number} radius Circle radius
 * @returns {number} Length of the segment part inside the circle.
 */
function calculateSegmentIntersectionLength(p1, p2, circleCenter, radius) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const segLenSq = dx * dx + dy * dy;
    const segLen = Math.sqrt(segLenSq);

    // Handle zero-length segment
    if (segLen < 1e-6) {
        const distSqP1 = distanceBetween(p1, circleCenter) ** 2;
        return (distSqP1 < radius * radius + 1e-6) ? 0 : 0; // Technically 0 length
    }

    const A = segLenSq;
    const ox = p1.x - circleCenter.x;
    const oy = p1.y - circleCenter.y;
    const B = 2 * (ox * dx + oy * dy);
    const C = ox * ox + oy * oy - radius * radius;

    const Delta = B * B - 4 * A * C;

    if (Delta < 0) {
        // Line does not intersect circle. Check if segment is fully inside.
        // C < 0 means p1 is inside. A segment fully inside requires both points inside
        // but since the line doesn't intersect, if p1 is inside, p2 must also be.
        return (C < -1e-6) ? segLen : 0;
    } else {
        const sqrtDelta = Math.sqrt(Delta);
        // t values where the *infinite line* intersects the circle
        const t1 = (-B - sqrtDelta) / (2 * A);
        const t2 = (-B + sqrtDelta) / (2 * A);

        // Find the intersection interval of [t1, t2] and [0, 1]
        // Clip t values to the range [0, 1]
        const clipped_t1 = Math.max(0, Math.min(1, t1));
        const clipped_t2 = Math.max(0, Math.min(1, t2));

        // Determine the effective intersection interval on the segment [0, 1]
        const start_clip = Math.max(0, t1);
        const end_clip = Math.min(1, t2);

        if (start_clip < end_clip) {
            return (end_clip - start_clip) * segLen;
        } else {
            return 0;
        }
    }
}

/**
 * Saves statistics data to a JSON file.
 * @param {string} filePath
 * @param {object} statsData
 */
async function saveStatsToJson(filePath, statsData) {
    try {
        const jsonContent = JSON.stringify(statsData, null, 2); // Pretty print JSON
        await fs.writeFile(filePath, jsonContent, 'utf8');
        console.log(`Successfully saved path statistics to ${filePath}`);
    } catch (error) {
        console.error(`Error saving path stats JSON to ${filePath}:`, error);
        throw error;
    }
}

/**
 * Calculates the total path length covered by a circle at a given position.
 * @param {number} defenderX - X coordinate of the defender (circle center).
 * @param {number} defenderY - Y coordinate of the defender (circle center).
 * @param {number} range - Radius of the defender's coverage circle.
 * @param {Array<{x: number, y: number}>} pathData - The waypoints of the path.
 * @returns {number} - The total length of path segments covered by the circle.
 */
function calculateTotalCoverage(defenderX, defenderY, range, pathData) {
    if (!pathData || pathData.length < 2 || range <= 0) {
        return 0;
    }
    const defenderPos = { x: defenderX, y: defenderY };
    let totalCoveredLength = 0;
    for (let i = 0; i < pathData.length - 1; i++) {
        const p1 = pathData[i];
        const p2 = pathData[i + 1];
        totalCoveredLength += calculateSegmentIntersectionLength(p1, p2, defenderPos, range);
    }
    return totalCoveredLength;
}

/**
 * Attempts to find a locally optimal defender position using gradient ascent.
 * Starts from an initial position and iteratively moves in the direction of the estimated gradient
 * of the path coverage function.
 * @param {number} startX - Initial X coordinate.
 * @param {number} startY - Initial Y coordinate.
 * @param {number} range - The defender range (radius).
 * @param {Array<{x: number, y: number}>} pathData - Path waypoints.
 * @param {object} options - Optimization parameters.
 * @param {number} options.maxIterations - Maximum number of steps.
 * @param {number} options.initialStepSize - Starting step size.
 * @param {number} options.tolerance - Stop if coverage improvement is less than this value.
 * @param {number} options.epsilon - Small distance for finite difference gradient estimation.
 * @param {number} options.minStepSize - Stop if step size gets too small.
 * @param {number} options.exclusionRadius - Minimum distance the defender must be from the path.
 * @param {Array<{x: number, y: number}>} originalPathData - Waypoints of the original path for distance check.
 * @returns {{x: number, y: number, coverage: number}} - The optimized position and its coverage.
 */
function findOffPathOptimum(startX, startY, range, pathData, originalPathData, options) {
    let currentX = startX;
    let currentY = startY;
    let currentCoverage = calculateTotalCoverage(currentX, currentY, range, pathData);
    let stepSize = options.initialStepSize;

    const { maxIterations, tolerance, epsilon, minStepSize, exclusionRadius } = options;

    // Add logging only for specific ranges to avoid flooding the console
    const rangesToLog = new Set(Array.from({ length: 16 }, (_, i) => (i + 1) * 50)); // 50, 100, ..., 800
    const shouldLog = rangesToLog.has(range);

    for (let iter = 0; iter < maxIterations; iter++) {
        if (shouldLog && iter % 50 === 0) { // Log every 50 iterations for selected ranges
            console.log(`    [Range ${range} Iter ${iter}] Pos: (${currentX.toFixed(1)}, ${currentY.toFixed(1)}), Coverage: ${currentCoverage.toFixed(2)}, Step: ${stepSize.toFixed(3)}`);
        }

        // Estimate gradient using finite differences
        const coverageXplus = calculateTotalCoverage(currentX + epsilon, currentY, range, pathData);
        const coverageXminus = calculateTotalCoverage(currentX - epsilon, currentY, range, pathData);
        const coverageYplus = calculateTotalCoverage(currentX, currentY + epsilon, range, pathData);
        const coverageYminus = calculateTotalCoverage(currentX, currentY - epsilon, range, pathData);

        const gradX = (coverageXplus - coverageXminus) / (2 * epsilon);
        const gradY = (coverageYplus - coverageYminus) / (2 * epsilon);

        const gradMagnitude = Math.sqrt(gradX * gradX + gradY * gradY);

        let proposedX = currentX;
        let proposedY = currentY;

        // Check for zero gradient (already at peak or flat region)
        if (gradMagnitude < 1e-6) {
            // console.log(`  Gradient ascent terminated early at iter ${iter}: near zero gradient.`);
            break;
        }

        // Normalize gradient
        const normGradX = gradX / gradMagnitude;
        const normGradY = gradY / gradMagnitude;

        // Calculate potential new position
        const nextX = currentX + stepSize * normGradX;
        const nextY = currentY + stepSize * normGradY;

        // Clamp the new position to the map boundaries (0-1024, 0-1024)
        const clampedX = Math.max(0, Math.min(nextX, 1024));
        const clampedY = Math.max(0, Math.min(nextY, 1024));

        proposedX = clampedX;
        proposedY = clampedY;

        // --- Exclusion Zone Check ---
        let isStepValid = true;
        const distToPath = minDistanceToPath({ x: proposedX, y: proposedY }, originalPathData);

        if (distToPath < exclusionRadius) {
            // Proposed step is inside the exclusion zone
            isStepValid = false;
            if (shouldLog) {
                console.log(`    [Range ${range} Iter ${iter}] Step into exclusion zone rejected (Dist: ${distToPath.toFixed(1)} < ${exclusionRadius}). Reducing step size.`);
            }
        }
        // --- End Exclusion Zone Check ---

        // Calculate coverage at new position
        // Only calculate if step calculation didn't halt due to zero gradient
        const nextCoverage = (gradMagnitude >= 1e-6) ? calculateTotalCoverage(proposedX, proposedY, range, pathData) : currentCoverage;

        // Check for improvement and termination
        const improvement = nextCoverage - currentCoverage;

        // --- Adaptive Step Size Logic ---
        if (isStepValid && improvement > tolerance) {
            // Step was successful: Update position and coverage
            currentX = proposedX;
            currentY = proposedY;
            currentCoverage = nextCoverage;
            // Optional: Slightly increase step size? stepSize *= 1.05; (Let's keep it simple for now)
        } else {
            // Step failed (or stalled): Reduce step size significantly, don't move
            stepSize *= 0.5;
            if (shouldLog && isStepValid) { // Log only if not already logged by exclusion check
                 console.log(`    [Range ${range} Iter ${iter}] Step failed/stalled (Improvement: ${improvement.toFixed(4)}). Reducing step size to ${stepSize.toFixed(4)}.`);
            }
        }

        // Termination condition: Step size too small
        if (stepSize < minStepSize) {
            if (shouldLog) {
                console.log(`    [Range ${range} Iter ${iter}] Terminating: Step size (${stepSize.toExponential(2)}) < minStepSize (${minStepSize.toExponential(2)}). Final Coverage: ${currentCoverage.toFixed(2)}`);
            }
            break;
        }

        // Termination condition for last iteration
        if (iter === maxIterations - 1) {
            // console.log(`  Gradient ascent reached max iterations (${maxIterations}).`);
            if (shouldLog) {
                console.log(`    [Range ${range} Iter ${iter}] Terminating: Max iterations reached. Final Coverage: ${currentCoverage.toFixed(2)}`);
            }
        }
    }

    return { x: currentX, y: currentY, coverage: currentCoverage };
}

/**
 * Finds the index of the path segment containing a given distance along the path.
 * @param {number[]} cumulativeDistances - Array of cumulative distances for each segment end point.
 * @param {number} targetDistance - The distance along the path.
 * @returns {number} - The index of the segment, or -1 if not found.
 */
function getSegmentIndexAtDistance(cumulativeDistances, targetDistance) {
    if (targetDistance < 0) return -1;
    if (targetDistance === 0) return 0; // Belongs to the first segment

    for (let i = 0; i < cumulativeDistances.length; i++) {
        if (targetDistance <= cumulativeDistances[i]) {
            return i;
        }
    }
    // If targetDistance is exactly the total length, it belongs to the last segment
    if (cumulativeDistances.length > 0 && Math.abs(targetDistance - cumulativeDistances[cumulativeDistances.length - 1]) < 1e-6) {
        return cumulativeDistances.length - 1;
    }
    return -1; // Distance likely out of bounds
}

/**
 * Calculates a normalized normal vector for a line segment.
 * Returns one of the two possible normals (e.g., rotated -90 degrees).
 * @param {{x: number, y: number}} p1 - Start point of the segment.
 * @param {{x: number, y: number}} p2 - End point of the segment.
 * @returns {{nx: number, ny: number}} - The normalized normal vector, or {0, 0} for zero-length segments.
 */
function getNormalVector(p1, p2) {
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);

    if (len < 1e-6) {
        return { nx: 0, ny: 0 }; // Cannot determine normal for zero-length segment
    }

    // Calculate one normal (e.g., by rotating dx, dy by -90 degrees)
    const nx = dy / len;
    const ny = -dx / len;

    return { nx, ny };
}

// --- Main Execution ---

async function main() {
    const NUM_PATH_SAMPLES = 500;
    const RANGES_TO_TEST = Array.from({ length: 1500 }, (_, i) => i + 1); // 1, 2, ..., 1500

    // Gradient Ascent Parameters
    const GRADIENT_ASCENT_OPTIONS = {
        maxIterations: 500,      // Increased iterations
        initialStepSize: 1.0,      // Reduced step size
        tolerance: 0.001, // Stricter tolerance
        epsilon: 0.5, // Small distance for finite difference
        minStepSize: 1e-4, // Stop if step size gets too small
    };

    // Define relative paths
    const basePath = path.resolve(__dirname);
    const originalPathFile = path.join(basePath, 'path.csv');
    const extendedPathFile = path.join(basePath, 'path-extended.csv');
    const enemiesFile = path.join(basePath, '..', 'enemies.json'); // Go up one level for enemies.json
    const coverageOutputFile = path.join(basePath, 'path-coverage.csv');
    const optimumPosOutputFile = path.join(basePath, 'path-optimums.csv'); // New output file for positions
    const statsOutputFile = path.join(basePath, 'path-stats.json'); 
    const levelConfigFile = path.join(basePath, '..', 'level1.json'); // Path to level config

    console.log(`Running precomputation script...`);
    console.log(`Outputting coverage data to: ${coverageOutputFile}`);
    console.log(`Outputting optimal positions to: ${optimumPosOutputFile}`); // Log new output
    console.log(`Outputting path stats to: ${statsOutputFile}`);
    console.log(`Using ${NUM_PATH_SAMPLES} samples along the path.`);
    console.log(`Testing ${RANGES_TO_TEST.length} ranges from ${RANGES_TO_TEST[0]} to ${RANGES_TO_TEST[RANGES_TO_TEST.length - 1]}.`);

    try {
        // Load level config to get exclusion radius
        console.log(`Loading level config from ${levelConfigFile}...`);
        const levelConfig = await loadJson(levelConfigFile);
        const pathExclusionRadius = levelConfig.pathExclusionRadius;
        if (typeof pathExclusionRadius !== 'number' || pathExclusionRadius < 0) {
            console.warn(`Invalid or missing pathExclusionRadius in ${levelConfigFile}. Defaulting to 0.`);
            pathExclusionRadius = 0;
        }
        console.log(`Using path exclusion radius: ${pathExclusionRadius}`);

        // --- Part 1: Ensure Extended Path Exists --- 
        let extendedPathData;
        let originalPathData; // Declare here to make accessible later
        try {
            extendedPathData = await loadCsvPath(extendedPathFile);
            console.log(`Loaded existing extended path with ${extendedPathData.length} points.`);
            originalPathData = await loadCsvPath(originalPathFile);
        } catch (e) {
            console.log("Extended path file not found or invalid, generating...");
            if (originalPathData.length < 2) throw new Error("Original path requires at least two points.");
            const enemyDefinitions = await loadJson(enemiesFile);
            const maxDiagonal = calculateMaxSpriteDiagonal(enemyDefinitions);
            extendedPathData = generateExtendedPath(originalPathData, maxDiagonal);
            await savePathToCsv(extendedPathFile, extendedPathData);
            console.log(`Generated and saved extended path with ${extendedPathData.length} points.`);
        }
        if (!extendedPathData || extendedPathData.length < 2) {
            throw new Error("Failed to load or generate a valid extended path.");
        }

        // --- Part 2: Calculate Path Metrics and Save Stats --- 
        console.log("Calculating path metrics...");
        const totalPathLength = calculateTotalLength(extendedPathData);
        if (totalPathLength <= 0) {
            throw new Error("Total path length is zero or negative. Cannot calculate coverage.");
        }
        const { segmentLengths, cumulativeDistances } = calculatePathMetrics(extendedPathData);
        console.log(`Total extended path length: ${totalPathLength.toFixed(2)}`);
        console.log(`Calculated ${segmentLengths.length} segment lengths and cumulative distances.`);

        // Save the calculated stats
        const pathStats = {
            totalPathLength: totalPathLength,
            segmentLengths: segmentLengths,
            cumulativeDistances: cumulativeDistances
        };
        await saveStatsToJson(statsOutputFile, pathStats);

        // --- Part 3: Calculate Average Path Coverage --- 
        const coverageResults = []; // Will now store {range, x, y, fraction}
        console.log("Starting coverage calculation (On-path sampling + Off-path gradient ascent)..."); 
        for (const testRange of RANGES_TO_TEST) {
            // --- On-Path Sampling --- 
            let maxCoveredLengthForRange = 0; 
            let bestDefenderPosX = extendedPathData[0].x; // Default to start
            let bestDefenderPosY = extendedPathData[0].y;
            let bestSegmentIndex = 0; // Index of segment containing the best on-path point
            let bestSampleDistance = 0;

            for (let i = 0; i < NUM_PATH_SAMPLES; i++) {
                const sampleDistance = (i / (NUM_PATH_SAMPLES - 1)) * totalPathLength;
                const defenderPos = getPointAtDistance(extendedPathData, cumulativeDistances, segmentLengths, sampleDistance);
                if (!defenderPos) {
                    console.warn(`Could not get point at distance ${sampleDistance} for sample ${i}. Skipping sample.`);
                    continue;
                }
                // Use the new helper function here too for consistency
                const coveredLengthForThisDefender = calculateTotalCoverage(defenderPos.x, defenderPos.y, testRange, extendedPathData);
                
                if (coveredLengthForThisDefender > maxCoveredLengthForRange) {
                    maxCoveredLengthForRange = coveredLengthForThisDefender;
                    bestDefenderPosX = defenderPos.x;
                    bestDefenderPosY = defenderPos.y;
                    bestSampleDistance = sampleDistance; // Store the distance for segment lookup
                }
            }
            // --- End On-Path Sampling ---

            // Find the segment index for the best on-path point
            bestSegmentIndex = getSegmentIndexAtDistance(cumulativeDistances, bestSampleDistance);
            if (bestSegmentIndex === -1) {
                console.warn(`  [Range ${testRange}] Could not determine segment index for best on-path point (Distance: ${bestSampleDistance}). Using segment 0.`);
                bestSegmentIndex = 0;
            }

            // --- Off-Path Gradient Ascent Refinement ---
            // Get the segment points for normal calculation (using extended path data)
            const segmentP1 = extendedPathData[bestSegmentIndex];
            const segmentP2 = extendedPathData[bestSegmentIndex + 1]; // Assumes bestSegmentIndex is not the last index
            
            // Calculate normal vector
            const normal = getNormalVector(segmentP1, segmentP2);

            // Define offset distance (must be > exclusionRadius)
            const startOffset = pathExclusionRadius + 0.1; 

            // Calculate two potential starting points offset along the normal
            let start1X = bestDefenderPosX + normal.nx * startOffset;
            let start1Y = bestDefenderPosY + normal.ny * startOffset;
            let start2X = bestDefenderPosX - normal.nx * startOffset;
            let start2Y = bestDefenderPosY - normal.ny * startOffset;

            // Clamp starting points to map boundaries
            start1X = Math.max(0, Math.min(start1X, 1024));
            start1Y = Math.max(0, Math.min(start1Y, 1024));
            start2X = Math.max(0, Math.min(start2X, 1024));
            start2Y = Math.max(0, Math.min(start2Y, 1024));

            // Log starting point for context if needed later
            // console.log(`  [Range ${testRange}] Starting GA from (${bestDefenderPosX.toFixed(1)}, ${bestDefenderPosY.toFixed(1)}) with coverage ${maxCoveredLengthForRange.toFixed(2)}`);
            
            // Run gradient ascent from both starting points
            // console.log(`  [Range ${testRange}] Running GA from Start 1: (${start1X.toFixed(1)}, ${start1Y.toFixed(1)})`); // Removed shouldLog dependency
            const optimizationResult1 = findOffPathOptimum(
                start1X,               // startX (Offset 1)
                start1Y,              // startY (Offset 1)
                testRange,            // range
                extendedPathData,     // pathData (for coverage calc)
                originalPathData,     // originalPathData (for distance check)
                {...GRADIENT_ASCENT_OPTIONS, exclusionRadius: pathExclusionRadius } // Pass dynamic radius
            );

            // console.log(`  [Range ${testRange}] Running GA from Start 2: (${start2X.toFixed(1)}, ${start2Y.toFixed(1)})`); // Removed shouldLog dependency
            const optimizationResult2 = findOffPathOptimum(
                start2X,               // startX (Offset 2)
                start2Y,              // startY (Offset 2)
                testRange,            // range
                extendedPathData,     // pathData (for coverage calc)
                originalPathData,     // originalPathData (for distance check)
                {...GRADIENT_ASCENT_OPTIONS, exclusionRadius: pathExclusionRadius } // Pass dynamic radius
            );

            // Select the better result
            let finalOptimizationResult;
            if (optimizationResult1.coverage >= optimizationResult2.coverage) {
                finalOptimizationResult = optimizationResult1;
                // if (shouldLog) console.log(`  [Range ${testRange}] Selected Result 1 (Coverage: ${optimizationResult1.coverage.toFixed(2)})`);
            } else {
                finalOptimizationResult = optimizationResult2;
                // if (shouldLog) console.log(`  [Range ${testRange}] Selected Result 2 (Coverage: ${optimizationResult2.coverage.toFixed(2)})`);
            }

            const finalOptimumCoverage = finalOptimizationResult.coverage;
            
            // Calculate fraction based on the refined optimum coverage
            const optimumCoverageFraction = finalOptimumCoverage / totalPathLength; 
            
            // Store range, optimal position (x, y), and fraction
            coverageResults.push({
                range: testRange,
                x: finalOptimizationResult.x,
                y: finalOptimizationResult.y,
                fraction: optimumCoverageFraction
            }); 
            
            if (testRange % 100 === 0) {
                 console.log(`  ... completed calculation for range ${testRange} (Coverage: ${(optimumCoverageFraction * 100).toFixed(1)}%)`);
            }
        }
        console.log("Coverage calculation finished.");

        // --- Part 4: Save Coverage Results --- 
        // Prepare data for original coverage file (range, fraction)
        const coverageFractionData = coverageResults.map(d => [d.range, d.fraction]);
        await saveCoverageToCsv(coverageOutputFile, coverageFractionData); 

        // Prepare data for new positions file (range, x, y)
        const optimumPositionData = coverageResults.map(d => ({ range: d.range, x: d.x, y: d.y })); // Data already has x, y
        await saveOptimumPositionsToCsv(optimumPosOutputFile, optimumPositionData);

        console.log(`Precomputation finished successfully.`);

    } catch (error) {
        console.error("Precomputation failed:", error);
        process.exit(1); // Indicate failure
    }
}

main();
