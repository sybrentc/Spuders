const fs = require('fs').promises;
const path = require('path');

// --- Configuration ---
// const WEAR_FRACTION_W = 5e-4; // REMOVED - Now read from level1.json
const ENEMY_DATA_PATH = path.join(__dirname, '../enemies.json');
const WAVE_CONFIG_PATH = path.join(__dirname, 'waves.json');
const BASE_DATA_PATH = path.join(__dirname, '../base.json');
const LEVEL1_DATA_PATH = path.join(__dirname, '../level1.json'); // Contains pathStatsPath and difficulty (alpha)
const OUTPUT_PATH = path.join(__dirname, 'analysis-depreciation-results.json'); // R(t) simulation results
const PARAMS_OUTPUT_PATH = path.join(__dirname, 'analysis-params.json'); // Input params remain the same
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
        if (levelConfig.wear === undefined || levelConfig.wear < 0) throw new Error("Missing or invalid 'wear' parameter in level1.json");
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
            B0: levelConfig.overrideStartingMoney ?? (baseStats.money || 0),
            beta: levelConfig.currencyScale,
            W1: waveConfig.startingDifficulty,
            f: waveConfig.difficultyIncreaseFactor,
            alpha: levelConfig.difficulty, // Save the original alpha from config
            wear: levelConfig.wear,
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
            // USE CEIL HERE based on Eq. 3
            const numToAdd = Math.ceil(difficultyPerType / enemyType.cost);
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
    // Calculate required counts based on redistributed difficulty among whitelist
    const N_wl = enemyWhitelist.length;
    if (N_wl === 0) return { selectedEnemies: [], totalBounty: 0 };
    const redistributedDifficulty = targetDifficulty / N_wl;

    let selectedEnemies = [];
    let currentDifficulty = 0;
    let totalBounty = 0;

    // Pre-populate based on Ceil( Difficulty / Cost )
    enemyWhitelist.forEach(enemyType => {
        const cost = enemyType.cost;
        if (cost > 0) {
            const numToAdd = Math.ceil(redistributedDifficulty / cost);
            for (let i = 0; i < numToAdd; i++) {
                selectedEnemies.push({...enemyType});
                currentDifficulty += cost;
                totalBounty += enemyType.bounty;
            }
        } else if (redistributedDifficulty > 0) {
             console.warn(`Wave ${waveNumber}: Enemy type ${enemyType.id} has zero cost but difficulty > 0. Skipping.`);
        }
    });

    // Refinement process (unchanged)
    const waveGenConfig = waveConfigRef.waveGeneration || {};
    const maxAttempts = waveGenConfig.maxSelectionAttempts || 200;
    const tolerance = waveGenConfig.difficultyTolerance || 0.10;
    let attempts = 0;

    while (attempts < maxAttempts && enemyWhitelist.length > 0) {
        attempts++;
        const diff = targetDifficulty - currentDifficulty;
        const relativeDiff = targetDifficulty > 0 ? Math.abs(diff) / targetDifficulty : 0;

        // Stop if within tolerance OR if difficulty is exactly zero
        if (relativeDiff <= tolerance || (targetDifficulty === 0 && currentDifficulty === 0)) break;

        // Add if below target or no enemies selected yet
        if (diff > 0 || selectedEnemies.length === 0) {
            const randomIndex = Math.floor(Math.random() * enemyWhitelist.length);
            const enemyToAdd = enemyWhitelist[randomIndex];
            selectedEnemies.push({...enemyToAdd});
            currentDifficulty += enemyToAdd.cost;
            totalBounty += enemyToAdd.bounty;
        } 
        // Remove if above target and enemies exist
        else if (selectedEnemies.length > 0) { 
            const randomIndex = Math.floor(Math.random() * selectedEnemies.length);
            const removedEnemy = selectedEnemies.splice(randomIndex, 1)[0];
            if (removedEnemy) { // Ensure splice actually removed something
                currentDifficulty -= removedEnemy.cost;
                totalBounty -= removedEnemy.bounty;
            }
        }
    }
    // if (attempts >= maxAttempts) console.warn(`Wave ${waveNumber}: Reached max refinement attempts (${maxAttempts}). Final diff: ${currentDifficulty - targetDifficulty}`);

    return { selectedEnemies, totalBounty };
}

/**
 * Simulates wave generation for a given wave number.
 * @param {number} waveNumber
 * @returns {{ selectedEnemies: Array<{id: string, cost: number, bounty: number, speed: number}>, totalBounty: number }}
 */
function simulateWaveGeneration(waveNumber) {
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

    availableEnemyCosts.sort((a, b) => a.cost - b.cost); // Sort ascending by cost (difficulty)

    const waveGenConfig = waveConfig.waveGeneration || {};
    const maxPrepopulationPerType = waveGenConfig.maxPrepopulationPerType ?? Infinity;
    let minEnemyTypes = waveGenConfig.minEnemyTypes ?? 1;
    minEnemyTypes = Math.max(1, Math.min(minEnemyTypes, availableEnemyCosts.length));

    // --- Whitelisting Logic --- 
    const initialPotentialCounts = calculatePotentialCounts(targetDifficulty, availableEnemyCosts);
    const enemyTypesToExclude = new Set();
    const totalTypes = availableEnemyCosts.length;
    // Only consider excluding the WEAKEST types, up to the point where minEnemyTypes remain
    const maxIndexToConsiderExclusion = totalTypes > minEnemyTypes ? totalTypes - minEnemyTypes : 0;

    for (let i = 0; i < maxIndexToConsiderExclusion; i++) {
        const enemyType = availableEnemyCosts[i]; // Checking weakest first
        const potentialCount = initialPotentialCounts.get(enemyType.id) || 0;
        if (isFinite(maxPrepopulationPerType) && potentialCount > maxPrepopulationPerType) {
            enemyTypesToExclude.add(enemyType.id);
            // console.log(`Wave ${waveNumber}: Excluding ${enemyType.id} (K_init=${potentialCount.toFixed(1)} > K_max=${maxPrepopulationPerType})`);
        }
    }

    let enemyWhitelist = availableEnemyCosts.filter(enemyType => !enemyTypesToExclude.has(enemyType.id));

    // Fallback if too many excluded
    if (enemyWhitelist.length < minEnemyTypes && totalTypes >= minEnemyTypes) {
        // console.warn(`Wave ${waveNumber}: Whitelist too small (${enemyWhitelist.length}), falling back to ${minEnemyTypes} strongest types.`);
        enemyWhitelist = availableEnemyCosts.slice(-minEnemyTypes); // Take the strongest types
    }

    if (enemyWhitelist.length === 0) {
         console.error(`Wave ${waveNumber}: Whitelist is empty even after fallback.`);
         return { selectedEnemies: [], totalBounty: 0 };
    }
    // --- End Whitelisting --- 

    // Pass only the whitelist to refinement
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
    const deltaT_ms = waveConfig.delayBetweenEnemiesMs || 500;

    const speedGroupsMap = new Map();
    selectedEnemies.forEach(enemy => {
        if (!speedGroupsMap.has(enemy.speed)) {
            speedGroupsMap.set(enemy.speed, []);
        }
        speedGroupsMap.get(enemy.speed).push(enemy.id);
    });

    const groups = Array.from(speedGroupsMap.entries()).map(([speed, enemyIds]) => ({ speed, count: enemyIds.length }));
    if (groups.length === 0) return 0;

    let max_t_COM_ms = 0;
    const groupMetrics = groups.map(group => {
        const travelTime_ms = (d / group.speed) * 1000; // time to reach midpoint d
        const offsetTime_ms = (group.count > 1) ? ((group.count - 1) * deltaT_ms / 2) : 0; // Eq 4
        const t_COM_i_ms = travelTime_ms + offsetTime_ms; // Eq 5 (adapted for d=L/2)
        max_t_COM_ms = Math.max(max_t_COM_ms, t_COM_i_ms);
        return { ...group, t_COM_i_ms };
    });

    let max_t_last_reach_ms = 0;
    groupMetrics.forEach(group => {
        const t_s_i_ms = max_t_COM_ms - group.t_COM_i_ms; // Eq 6 (start time for group i)
        const spawn_duration_ms = (group.count > 1 ? (group.count - 1) * deltaT_ms : 0);
        const travel_time_L_ms = (L / group.speed) * 1000; // time to travel full path L
        const t_last_reach_ms = t_s_i_ms + spawn_duration_ms + travel_time_L_ms; // Eq 22 logic
        max_t_last_reach_ms = Math.max(max_t_last_reach_ms, t_last_reach_ms);
    });

    const T_n_ms = max_t_last_reach_ms;
    return T_n_ms > 0 ? T_n_ms : 0;
}

/**
 * Main analysis function simulating R(t) evolution.
 */
async function runAnalysis() {
    if (!await loadData()) {
        console.error("Failed to load data. Aborting analysis.");
        return null;
    }

    const results = [];
    const startingMoney = levelConfig.overrideStartingMoney ?? (baseStats.money || 0);
    
    // --- Calculate T0 and alpha_0 --- 
    const validSpeeds = Object.values(enemyDefinitions).map(e => e.stats.speed).filter(s => s > 0);
    if (validSpeeds.length === 0) {
         console.error(`No valid enemy speeds found to calculate T0. Aborting.`);
         return null;
    }
    const T0 = pathStats.totalPathLength / Math.min(...validSpeeds);
    console.log(`Calculated T0 = ${T0.toFixed(4)}s`);

    const f = waveConfig.difficultyIncreaseFactor;
    if (!T0 || T0 <= 0 || !f || f <= 1) {
        console.error(`Invalid parameters for alpha_0 calculation: T0=${T0}, f=${f}. Aborting.`);
        return null;
    }
    const wear_from_config = levelConfig.wear;
    const calculated_alpha_0 = 1 / ( ((f - 1) / T0) + wear_from_config );
    console.log(`--- Using Calculated alpha_0 = ${calculated_alpha_0.toFixed(4)} (based on f=${f}, T0=${T0.toFixed(4)}, w=${wear_from_config}) ---`);
    const alpha_to_use = calculated_alpha_0;

    // Initial Earning Rate R(0) for wave 1
    let R_current_wave_start = alpha_to_use > 0 ? startingMoney / alpha_to_use : Infinity;

    // --- Simulation Time Step --- 
    const dt_sim_seconds = 0.005 * T0;
    console.log(`Simulation time step dt = ${dt_sim_seconds.toFixed(5)}s`); // dt is no longer used for simulation

    // --- Pre-calculate Tn values (in seconds) --- 
    const T_values_seconds = {};
    console.log("Pre-calculating Tn values...");
    for (let n = 1; n <= MAX_WAVE + 1; n++) {
        const { selectedEnemies } = simulateWaveGeneration(n);
        const T_n_ms = calculateWaveDurationT(selectedEnemies);
        T_values_seconds[n] = T_n_ms / 1000.0;
    }
    console.log("Finished calculating Tn values.");

    // --- Simulation Loop --- 
    let title = `Starting Analytical R(t) evolution analysis (Waves 1-${MAX_WAVE})`; // Updated title
    title += ` (Wear w=${wear_from_config}, Alpha=${alpha_to_use.toFixed(2)})`; // Use config value in title
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

        const T_n_seconds = T_values_seconds[n];
        const T_n_plus_1_seconds = T_values_seconds[n+1];
        const R_start_n = R_current_wave_start; // Earning rate at start of wave n
        const C_start_n = R_start_n * alpha_to_use; // Implied assets at start

        // --- Calculate d_n for this wave (Eq. 32) --- 
        let d_n = 0;
        if (T_n_seconds > 0 && T_n_plus_1_seconds !== undefined) {
            const gamma_n = T_n_plus_1_seconds / T_n_seconds;
            if (gamma_n > 0) {
                 d_n = ((f - 1) / T0) + (1 / T_n_seconds) * (1 - (f / gamma_n));
            } else {
                console.warn(`Wave ${n}: gamma_n (${gamma_n}) is not positive. Setting d_n=0.`);
            }
        } else {
             console.warn(`Wave ${n}: T_n (${T_n_seconds}) is not positive or T_{n+1} (${T_n_plus_1_seconds}) is undefined. Setting d_n=0.`);
        }
        d_n = Math.max(0, d_n); // Ensure non-negative

        // --- Calculate bounty rate bn --- 
        const bounty_rate_bn = (T_n_seconds > 0) ? B_n / T_n_seconds : 0;

        // --- Calculate START-OF-WAVE balance ratio g''_n = R_start_n / b_n --- 
        let ratio_start = 0;
        if (bounty_rate_bn > 0) {
            ratio_start = R_start_n / bounty_rate_bn;
        } else if (R_start_n === 0 && B_n === 0) {
             ratio_start = 1; // 0/0 case
        } else if (bounty_rate_bn <= 0 && R_start_n > 0) {
            ratio_start = Infinity; // Positive earning rate vs zero bounty rate
        } else {
            ratio_start = 0; // Default includes R_start_n=0, bn>0
        }
        let displayRatio_start = ratio_start;
        if (!isFinite(ratio_start)) {
            displayRatio_start = (ratio_start === Infinity) ? 1e9 : -1e9;
        }
        // --- End Ratio Calculation ---

        // --- Calculate R_end_n using Analytical Formula --- 
        const B_loss = wear_from_config + d_n; // Use config value for wear
        let R_end_n = R_start_n; // Initialize with start value

        if (T_n_seconds > 0) { // Only evolve if wave has duration
            if (Math.abs(B_loss) > 1e-9) { // Check if B is non-zero
                const A_gain = (alpha_to_use > 0) ? bounty_rate_bn / alpha_to_use : 0;
                const A_over_B = A_gain / B_loss;
                R_end_n = A_over_B + (R_start_n - A_over_B) * Math.exp(-B_loss * T_n_seconds);
            } else { // Case B_loss is zero or near-zero
                const A_gain = (alpha_to_use > 0) ? bounty_rate_bn / alpha_to_use : 0;
                // If B=0, ODE is R' = A, solution R(t) = R(0) + A*t
                R_end_n = R_start_n + A_gain * T_n_seconds;
            }
        }
        R_end_n = Math.max(0, R_end_n); // Ensure non-negative earning rate
        // --- End Analytical R_end_n Calculation --- 

        // Update starting R for the next wave
        R_current_wave_start = R_end_n;

        // Store results (using start-of-wave state but end-of-wave ratio)
        results.push({ 
            wave: n, 
            totalBounty: B_n, 
            durationMs: T_n_seconds * 1000, 
            cumulativeAssets: C_start_n, // Assets at START 
            earningRate: R_start_n, // Earning rate at START
            // earningRateEnd: R_end_n, // Not storing end rate explicitly
            calculated_dn: d_n, 
            bountyRate: bounty_rate_bn,
            ratio: displayRatio_start // STORE THE START-OF-WAVE RATIO
        });

        console.log(`Wave ${n}: B_n=${B_n.toFixed(0)}, T_n=${T_n_seconds.toFixed(2)}s, R_start=${R_start_n.toFixed(4)}, b_n=${bounty_rate_bn.toFixed(4)}, d_n=${d_n.toFixed(4)}, R_end=${R_end_n.toFixed(4)}, g''_n(start)=${displayRatio_start.toFixed(3)}`); // Updated log label

    }
    // --- End Outer Loop --- 

    console.log(`Analysis complete. Writing ${results.length} results to ${OUTPUT_PATH}...`);
    try {
        await fs.writeFile(OUTPUT_PATH, JSON.stringify(results, null, 2));
        console.log("Results successfully written to file.");
        return results;
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
    console.log(`--- Running R(t) evolution simulation ---`);
    await runAnalysis();
}

// Run the main logic
main();
