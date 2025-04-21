const fs = require('fs').promises;
const path = require('path');

// --- Utility Functions (adapted from game code) ---

/**
 * Calculates the Euclidean distance between two points.
 * @param {{x: number, y: number}} point1
 * @param {{x: number, y: number}} point2
 * @returns {number}
 */
function distanceBetween(point1, point2) {
    if (!point1 || !point2) return 0;
    const dx = point2.x - point1.x;
    const dy = point2.y - point1.y;
    return Math.sqrt(dx * dx + dy * dy);
}

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

// --- Main Execution ---

async function main() {
    const NUM_PATH_SAMPLES = 500;
    const RANGES_TO_TEST = Array.from({ length: 1500 }, (_, i) => i + 1); // 1, 2, ..., 1500

    // Define relative paths
    const basePath = path.resolve(__dirname);
    const originalPathFile = path.join(basePath, 'path.csv');
    const extendedPathFile = path.join(basePath, 'path-extended.csv');
    const enemiesFile = path.join(basePath, '..', 'enemies.json'); // Go up one level for enemies.json
    const coverageOutputFile = path.join(basePath, 'path-coverage.csv');
    const statsOutputFile = path.join(basePath, 'path-stats.json'); // New output file

    console.log(`Running precomputation script...`);
    console.log(`Outputting coverage data to: ${coverageOutputFile}`);
    console.log(`Outputting path stats to: ${statsOutputFile}`); // Log new output
    console.log(`Using ${NUM_PATH_SAMPLES} samples along the path.`);
    console.log(`Testing ${RANGES_TO_TEST.length} ranges from ${RANGES_TO_TEST[0]} to ${RANGES_TO_TEST[RANGES_TO_TEST.length - 1]}.`);

    try {
        // --- Part 1: Ensure Extended Path Exists --- 
        let extendedPathData;
        try {
            extendedPathData = await loadCsvPath(extendedPathFile);
            console.log(`Loaded existing extended path with ${extendedPathData.length} points.`);
        } catch (e) {
            console.log("Extended path file not found or invalid, generating...");
            const originalPathData = await loadCsvPath(originalPathFile);
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
        const coverageResults = [];
        console.log("Starting coverage calculation (finding OPTIMUM fraction)..."); // Log updated
        for (const testRange of RANGES_TO_TEST) {
            // let totalCoveredLengthSum = 0; // REMOVED average calculation variable
            let maxCoveredLengthForRange = 0; // ADDED variable to track maximum
            for (let i = 0; i < NUM_PATH_SAMPLES; i++) {
                const sampleDistance = (i / (NUM_PATH_SAMPLES - 1)) * totalPathLength;
                const defenderPos = getPointAtDistance(extendedPathData, cumulativeDistances, segmentLengths, sampleDistance);
                if (!defenderPos) {
                    console.warn(`Could not get point at distance ${sampleDistance} for sample ${i}. Skipping sample.`);
                    continue;
                }
                let coveredLengthForThisDefender = 0;
                for (let j = 0; j < extendedPathData.length - 1; j++) {
                    const p1 = extendedPathData[j];
                    const p2 = extendedPathData[j + 1];
                    coveredLengthForThisDefender += calculateSegmentIntersectionLength(p1, p2, defenderPos, testRange);
                }
                // totalCoveredLengthSum += coveredLengthForThisDefender; // REMOVED sum accumulation
                maxCoveredLengthForRange = Math.max(maxCoveredLengthForRange, coveredLengthForThisDefender); // UPDATE: track maximum
            }
            // const averageCoveredLength = totalCoveredLengthSum / NUM_PATH_SAMPLES; // REMOVED average calculation
            // const averageCoverageFraction = averageCoveredLength / totalPathLength; // REMOVED average calculation
            const optimumCoverageFraction = maxCoveredLengthForRange / totalPathLength; // CALCULATE optimum fraction
            coverageResults.push([testRange, optimumCoverageFraction]); // STORE optimum fraction
            if (testRange % 100 === 0) {
                 console.log(`  ... completed calculation for range ${testRange}`);
            }
        }
        console.log("Coverage calculation finished.");

        // --- Part 4: Save Coverage Results --- 
        await saveCoverageToCsv(coverageOutputFile, coverageResults);

        console.log(`Precomputation finished successfully.`);

    } catch (error) {
        console.error("Precomputation failed:", error);
        process.exit(1); // Indicate failure
    }
}

main();
