const fs = require('fs').promises;
const path = require('path');

// --- Configuration ---
const ENEMY_DATA_PATH = path.join(__dirname, '../enemies.json');
const WAVE_CONFIG_PATH = path.join(__dirname, 'waves.json');
const BASE_DATA_PATH = path.join(__dirname, '../base.json');
const LEVEL1_DATA_PATH = path.join(__dirname, '../level1.json'); // Contains pathStatsPath and difficulty (alpha)
const OUTPUT_PATH = path.join(__dirname, 'analysis-results.json');
const PARAMS_OUTPUT_PATH = path.join(__dirname, 'analysis-params.json'); // New path for saved params
const MAX_WAVE = 30; // How many waves to simulate

// Global storage for loaded data
let enemyDefinitions = {};
let waveConfig = {};
let baseStats = {};
let pathStats = {};
let levelConfig = {}; // Stores content of level1.json

/**
 * Loads all necessary JSON data files.
 */
async function loadData() {
    try {
        console.log("Loading data...");
        const [enemyData, waveData, baseData, levelData] = await Promise.all([
            fs.readFile(ENEMY_DATA_PATH, 'utf8').then(JSON.parse),
            fs.readFile(WAVE_CONFIG_PATH, 'utf8').then(JSON.parse),
            fs.readFile(BASE_DATA_PATH, 'utf8').then(JSON.parse),
            fs.readFile(LEVEL1_DATA_PATH, 'utf8').then(JSON.parse)
        ]);

        levelConfig = levelData; // Store level config globally

        // Load path stats using the path specified in level1.json
        const pathStatsPath = path.join(__dirname, '..', '..', levelConfig.pathStatsPath); // Go up two levels from assets/waves
        pathStats = await fs.readFile(pathStatsPath, 'utf8').then(JSON.parse);

        // Store enemy definitions in a more accessible map format
        if (Array.isArray(enemyData)) {
            enemyDefinitions = enemyData.reduce((acc, enemy) => {
                if (enemy.id) {
                    acc[enemy.id] = enemy;
                }
                return acc;
            }, {});
        } else {
            throw new Error("Enemy data is not an array.");
        }

        waveConfig = waveData;
        baseStats = baseData.stats || {}; // Safely access stats

        console.log("Data loaded successfully.");

        // Basic validation
        if (!pathStats.totalPathLength) throw new Error("Missing totalPathLength in path stats.");
        if (levelConfig.difficulty === undefined) throw new Error("Missing difficulty (alpha) in level config.");
        if (!waveConfig.delayBetweenEnemiesMs) throw new Error("Missing delayBetweenEnemiesMs in wave config.");
        if (baseStats.money === undefined && levelConfig.overrideStartingMoney === undefined) throw new Error("Missing money in base stats and no override provided.");
        if (Object.keys(enemyDefinitions).length === 0) throw new Error("No enemy definitions loaded.");

        // --- Save parameters after successful load ---
        await saveAnalysisParameters();
        // ------------------------------------------

        return true;
    } catch (error) {
        console.error("Error loading data:", error);
        return false;
    }
}

/**
 * Saves the parameters used for the analysis to a JSON file.
 */
async function saveAnalysisParameters() {
    console.log(`Saving analysis parameters to ${PARAMS_OUTPUT_PATH}...`);
    try {
        const enemies = Object.values(enemyDefinitions);
        if (!Array.isArray(enemies) || enemies.length === 0) throw new Error('No enemy definitions available for saving.');

        const enemyStats = enemies.map(e => ({
            id: e.id,
            speed: e.stats.speed,
            hp: e.stats.hp,
            w: (e.stats.speed || 0) * (e.stats.hp || 0)
        })).filter(e => e.speed > 0 && e.hp > 0);

        if (enemyStats.length === 0) throw new Error('No enemies with valid speed and hp found for saving parameters.');

        const L = pathStats.totalPathLength;
        const s_min = Math.min(...enemyStats.map(e => e.speed));
        if (s_min <= 0) throw new Error('Minimum enemy speed must be positive for saving parameters.');
        const T0 = L / s_min;

        const parameters = {
            B0: baseStats.money || 0, // Use the base starting money
            betaFactor: levelConfig.currencyScale,
            W1: waveConfig.startingDifficulty,
            f: waveConfig.difficultyIncreaseFactor,
            alpha: levelConfig.difficulty,
            L: L,
            dt_seconds: (waveConfig.delayBetweenEnemiesMs || 500) / 1000.0,
            waveGenConfig: waveConfig.waveGeneration || {},
            enemyStats: enemyStats,
            T0: T0
        };

        await fs.writeFile(PARAMS_OUTPUT_PATH, JSON.stringify(parameters, null, 2));
        console.log("Analysis parameters saved successfully.");
    } catch (error) {
        console.error("Error saving analysis parameters:", error);
        // Decide if this should halt execution or just warn
        // throw error; // Optional: re-throw to stop analysis if params can't be saved
    }
}

/**
 * Helper for wave simulation: Calculates initial counts based on difficulty share.
 * @param {number} targetDifficulty
 * @param {Array<{id: string, cost: number}>} enemyTypeList
 * @returns {Map<string, number>}
 */
function calculatePotentialCounts(targetDifficulty, enemyTypeList) {
    const potentialCounts = new Map();
    const numTypes = enemyTypeList.length;
    if (numTypes === 0) return potentialCounts;
    const difficultyPerType = (targetDifficulty > 0 && numTypes > 0) ? targetDifficulty / numTypes : 0;

    enemyTypeList.forEach(enemyType => {
        if (enemyType.cost > 0) {
            const numToAdd = Math.floor(difficultyPerType / enemyType.cost);
            potentialCounts.set(enemyType.id, numToAdd);
        } else {
            potentialCounts.set(enemyType.id, (difficultyPerType > 0) ? Infinity : 0);
        }
    });
    return potentialCounts;
}

/**
 * Helper for wave simulation: Performs pre-population and refinement.
 * @param {number} targetDifficulty
 * @param {Array<{id: string, cost: number, bounty: number, speed: number}>} enemyWhitelist
 * @param {object} waveConfigRef
 * @param {number} waveNumber
 * @returns {{ selectedEnemies: Array<{id: string, cost: number, bounty: number, speed: number}>, totalBounty: number }}
 */
function simulatePrepopulationAndRefinement(targetDifficulty, enemyWhitelist, waveConfigRef, waveNumber) {
    const finalRequiredCounts = calculatePotentialCounts(targetDifficulty, enemyWhitelist);
    let selectedEnemies = [];
    let currentDifficulty = 0;
    let totalBounty = 0;

    enemyWhitelist.forEach(enemyType => {
        const numToAdd = finalRequiredCounts.get(enemyType.id) || 0;
        if (numToAdd > 0 && isFinite(numToAdd)) {
            for (let i = 0; i < numToAdd; i++) {
                selectedEnemies.push({...enemyType});
                currentDifficulty += enemyType.cost;
                totalBounty += enemyType.bounty;
            }
        }
    });

    const waveGenConfig = waveConfigRef.waveGeneration || {};
    const maxAttempts = waveGenConfig.maxSelectionAttempts || 200;
    const tolerance = waveGenConfig.difficultyTolerance || 0.10;
    let attempts = 0;

    while (attempts < maxAttempts && enemyWhitelist.length > 0) {
        attempts++;
        const diff = targetDifficulty - currentDifficulty;
        const relativeDiff = targetDifficulty > 0 ? Math.abs(diff) / targetDifficulty : 0;
        if (relativeDiff <= tolerance && (currentDifficulty > 0 || targetDifficulty <= 0)) break;

        if (diff > 0 || selectedEnemies.length === 0) {
            const randomIndex = Math.floor(Math.random() * enemyWhitelist.length);
            const enemyToAdd = enemyWhitelist[randomIndex];
            selectedEnemies.push({...enemyToAdd});
            currentDifficulty += enemyToAdd.cost;
            totalBounty += enemyToAdd.bounty;
        } else {
            if (selectedEnemies.length === 0) break;
            const randomIndex = Math.floor(Math.random() * selectedEnemies.length);
            const removedEnemy = selectedEnemies.splice(randomIndex, 1)[0];
            if (removedEnemy) {
                currentDifficulty -= removedEnemy.cost;
                totalBounty -= removedEnemy.bounty;
            }
        }
    }
    if (attempts >= maxAttempts) console.warn(`Wave ${waveNumber}: Reached max refinement attempts (${maxAttempts}).`);

    return { selectedEnemies, totalBounty };
}

/**
 * Simulates wave generation for a given wave number.
 * @param {number} waveNumber
 * @returns {{ selectedEnemies: Array<{id: string, cost: number, bounty: number, speed: number}>, totalBounty: number }}
 */
function simulateWaveGeneration(waveNumber) {
    // Use the starting difficulty directly from the loaded waveConfig
    const targetDifficulty = (waveConfig.startingDifficulty || 0) * Math.pow(waveConfig.difficultyIncreaseFactor, waveNumber - 1);

    const availableEnemyCosts = [];
    Object.values(enemyDefinitions).forEach(def => {
        if (def && def.stats) {
            const cost = (def.stats.hp || 0) * (def.stats.speed || 0);
            const bounty = def.stats.bounty || 0;
            const speed = def.stats.speed || 0;
            if (cost > 0 && speed > 0 && def.stats.hp > 0) {
                availableEnemyCosts.push({ id: def.id, cost, bounty, speed });
            }
        }
    });

    if (availableEnemyCosts.length === 0) {
        console.warn(`Wave ${waveNumber}: No valid enemies available.`);
        return { selectedEnemies: [], totalBounty: 0 };
    }

    availableEnemyCosts.sort((a, b) => a.cost - b.cost);

    const waveGenConfig = waveConfig.waveGeneration || {};
    const maxPrepopulationPerType = waveGenConfig.maxPrepopulationPerType ?? Infinity;
    let minEnemyTypes = waveGenConfig.minEnemyTypes ?? 1;
    minEnemyTypes = Math.max(1, Math.min(minEnemyTypes, availableEnemyCosts.length));

    const initialPotentialCounts = calculatePotentialCounts(targetDifficulty, availableEnemyCosts);

    const enemyTypesToExclude = new Set();
    const totalTypes = availableEnemyCosts.length;
    const maxIndexToConsiderExclusion = totalTypes > minEnemyTypes ? totalTypes - minEnemyTypes : 0;

    for (let i = 0; i < maxIndexToConsiderExclusion; i++) {
        const enemyType = availableEnemyCosts[i];
        const potentialCount = initialPotentialCounts.get(enemyType.id) || 0;
        if (isFinite(maxPrepopulationPerType) && potentialCount > maxPrepopulationPerType) {
            enemyTypesToExclude.add(enemyType.id);
        }
    }

    let enemyWhitelist = availableEnemyCosts.filter(enemyType => !enemyTypesToExclude.has(enemyType.id));

    if (enemyWhitelist.length === 0) {
        console.warn(`Wave ${waveNumber}: Whitelist empty after exclusion. Falling back.`);
        enemyWhitelist = availableEnemyCosts.slice(-minEnemyTypes);
        if (enemyWhitelist.length === 0) {
            console.error(`Wave ${waveNumber}: Could not form fallback whitelist.`);
            return { selectedEnemies: [], totalBounty: 0 };
        }
    }

    return simulatePrepopulationAndRefinement(targetDifficulty, enemyWhitelist, waveConfig, waveNumber);
}

/**
 * Calculates the effective wave duration T_n using coordinated spawn logic.
 * @param {Array<{id: string, cost: number, bounty: number, speed: number}>} selectedEnemies
 * @returns {number} Duration T_n in milliseconds.
 */
function calculateWaveDurationT(selectedEnemies) {
    if (selectedEnemies.length === 0) return 0;

    const L = pathStats.totalPathLength;
    const d = L / 2;
    const deltaT = waveConfig.delayBetweenEnemiesMs || 500;

    const speedGroupsMap = new Map();
    selectedEnemies.forEach(enemy => {
        if (!speedGroupsMap.has(enemy.speed)) {
            speedGroupsMap.set(enemy.speed, []);
        }
        speedGroupsMap.get(enemy.speed).push(enemy.id);
    });

    const groups = Array.from(speedGroupsMap.entries()).map(([speed, enemyIds]) => ({ speed, count: enemyIds.length }));
    if (groups.length === 0) return 0;

    let max_t_COM = 0;
    const groupMetrics = groups.map(group => {
        const travelTime = (d / group.speed) * 1000;
        const offsetTime = (group.count > 1) ? ((group.count - 1) * deltaT / 2) : 0;
        const t_COM_i = travelTime + offsetTime;
        max_t_COM = Math.max(max_t_COM, t_COM_i);
        return { ...group, t_COM_i };
    });

    let max_t_last_reach = 0;
    groupMetrics.forEach(group => {
        const t_s_i = max_t_COM - group.t_COM_i;
        const t_last_spawn_i = t_s_i + (group.count > 1 ? (group.count - 1) * deltaT : 0);
        const t_last_reach_i = t_last_spawn_i + (L / group.speed) * 1000;
        max_t_last_reach = Math.max(max_t_last_reach, t_last_reach_i);
    });

    const T_n = max_t_last_reach;
    return T_n > 0 ? T_n : 0;
}

/**
 * Main analysis function.
 * @param {number | null} overrideStartingMoney - Specific starting money, or null to use baseStats.
 */
async function runAnalysis(overrideStartingMoney = null) {
    if (!await loadData()) {
        console.error("Failed to load data. Aborting analysis.");
        return null;
    }

    const results = [];
    let cumulativeBounty = 0;
    const startingMoney = overrideStartingMoney ?? (baseStats.money || 0);
    const alpha = levelConfig.difficulty;

    let title = `Starting analysis (Waves 1-${MAX_WAVE}) (Base Difficulty)`;
    if (overrideStartingMoney !== null) title += `, Start Money: ${overrideStartingMoney}`;
    title += `... (Alpha: ${alpha})`;
    console.log(title);

    for (let n = 1; n <= MAX_WAVE; n++) {
        const { selectedEnemies, totalBounty: B_n } = simulateWaveGeneration(n);

        if (selectedEnemies.length === 0 && n > 1) {
            const targetDifficultyCheck = (waveConfig.startingDifficulty || 0) * Math.pow(waveConfig.difficultyIncreaseFactor, n - 1);
            if (targetDifficultyCheck > 0) {
                console.warn(`Wave ${n}: Generated 0 enemies. Stopping analysis.`);
                break;
            }
        }

        const T_n = calculateWaveDurationT(selectedEnemies);
        const C_n = startingMoney + cumulativeBounty;
        const R_n = alpha > 0 ? C_n / alpha : Infinity;
        const bountyRate = (T_n > 0 && B_n > 0) ? (B_n / T_n) : 0;

        let ratio = 0;
        if (B_n > 0 && T_n > 0 && alpha > 0) {
            const T_n_seconds = T_n / 1000.0; 
            ratio = (R_n * T_n_seconds) / B_n;
        } else if (C_n === 0 && B_n === 0) {
            ratio = 1;
        } else if (B_n <= 0 && R_n > 0) {
            ratio = Infinity;
        } else if (T_n <= 0 && B_n > 0) {
            ratio = 0;
        } else if (alpha <= 0 && C_n > 0) {
            ratio = Infinity;
        } else {
            ratio = 0;
        }

        let displayRatio = ratio;
        if (!isFinite(ratio)) {
            displayRatio = (ratio === Infinity) ? 1e9 : -1e9;
        }

        console.log(`Wave ${n}: B_n=${B_n.toFixed(0)}, T_n=${(T_n/1000).toFixed(2)}s, C_n=${C_n.toFixed(0)}, R_n=${(R_n).toFixed(4)}, Ratio=${displayRatio.toFixed(3)}`);

        results.push({ wave: n, totalBounty: B_n, durationMs: T_n, cumulativeAssets: C_n, earningRate: R_n, bountyRate, ratio: displayRatio });
        cumulativeBounty += B_n;
    }

    console.log(`Analysis complete. Writing ${results.length} results to ${OUTPUT_PATH}...`);

    try {
        await fs.writeFile(OUTPUT_PATH, JSON.stringify(results, null, 2));
        console.log("Results successfully written to file.");
        return results; // Return results array
    } catch (error) {
        console.error("Error writing results to file:", error);
        return null;
    }
}

/**
 * Calculate theoretical starting money S for flat ratio between waves 1 and 2.
 * @param {Array} resultsData - Array containing results for at least wave 1 and 2.
 * @returns {number | null} Calculated S or null if data insufficient.
 */
function calculateOptimalS(resultsData) {
    if (!resultsData || resultsData.length < 2) {
        console.error("Insufficient data to calculate optimal S.");
        return null;
    }
    const wave1 = resultsData[0];
    const wave2 = resultsData[1];

    const B1 = wave1.totalBounty;
    const T1 = wave1.durationMs;
    const B2 = wave2.totalBounty;
    const T2 = wave2.durationMs;

    if (B1 === undefined || T1 === undefined || B2 === undefined || T2 === undefined) {
        console.error("Missing B or T values in results data.");
        return null;
    }

    const denominator = (T1 * B2 - T2 * B1);
    if (Math.abs(denominator) < 1e-9) { // Avoid division by zero or near-zero
        console.warn("Cannot calculate optimal S: Denominator (T1*B2 - T2*B1) is too close to zero.");
        return null;
    }

    const S = (B1 * B1 * T2) / denominator;
    console.log(`
Theoretical Optimal Starting Money Calculation:`);
    console.log(` B1 = ${B1.toFixed(0)}, T1 = ${T1.toFixed(0)}ms`);
    console.log(` B2 = ${B2.toFixed(0)}, T2 = ${T2.toFixed(0)}ms`);
    console.log(` S = (B1^2 * T2) / (T1 * B2 - T2 * B1) = ${S.toFixed(2)}`);

    return Math.round(S); // Return rounded integer value
}

// --- Main Execution Logic ---
async function main() {
    // const testStartingMoney = 500;
    
    // // Optional: Run S=0 analysis first for reference
    // console.log("--- Running analysis with S=0 for reference ---");
    // await runAnalysis(0); 

    // Run final analysis with the starting money from base.json and base difficulty
    console.log(`--- Running final analysis with S from file (Base Difficulty) ---`);
    await runAnalysis(null); // Pass null to use starting money from base.json
}

// Run the main logic
main();
