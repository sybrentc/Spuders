// --- Consolidated Calculate Theoretical Wave Duration Function ---
function calculateTheoreticalWaveDuration(n, W1, f, enemyStats, L, dt_seconds, waveGenConfig) {
    const Wn = W1 * Math.pow(f, n - 1);
    const N = enemyStats.length;
    const K_max = waveGenConfig.maxPrepopulationPerType ?? Infinity;
    let min_strongest_types = waveGenConfig.minEnemyTypes ?? 1;
    min_strongest_types = Math.max(1, Math.min(min_strongest_types, N));

    if (N === 0) return 0;

    const enemiesWithInitialK = enemyStats.map((stats) => ({
        ...stats,
        K_initial: stats.w > 0 ? (Wn / N) / stats.w : Infinity
    })).sort((a, b) => a.w - b.w);

    const typesToExclude = new Set();
    const totalTypes = enemiesWithInitialK.length;
    const maxIndexToConsiderExclusion = totalTypes > min_strongest_types ? totalTypes - min_strongest_types : 0;

    for (let i = 0; i < maxIndexToConsiderExclusion; i++) {
        const enemyType = enemiesWithInitialK[i];
        const potentialCount = enemyType.K_initial || 0;
        if (isFinite(K_max) && potentialCount > K_max) {
            typesToExclude.add(enemyType.id);
        }
    }

    let enemyWhitelist = enemiesWithInitialK.filter(enemyType => !typesToExclude.has(enemyType.id));

    if (enemyWhitelist.length < min_strongest_types && totalTypes >= min_strongest_types) {
        // console.warn(`Wave ${n}, f=${f.toFixed(1)}: Whitelist too small (${enemyWhitelist.length}), falling back to ${min_strongest_types} strongest types.`);
        enemyWhitelist = enemiesWithInitialK.slice(-min_strongest_types);
    }

    const N_wl = enemyWhitelist.length;
    if (N_wl === 0) {
        // console.warn(`Wave ${n}, f=${f.toFixed(1)}: Whitelist is empty even after fallback.`);
        return 0;
    }

    const finalEnemyCalcs = enemyWhitelist.map(stats => {
        const K_final = stats.w > 0 ? Math.ceil((Wn / N_wl) / stats.w) : 0;
        const Ki_eff = Math.max(0, K_final);
        const travel_time_d = (L / 2) / stats.speed;
        const travel_time_L = L / stats.speed;
        const t_offset = Ki_eff > 1 ? (Ki_eff - 1) * dt_seconds / 2 : 0;
        const t_com = travel_time_d + t_offset;
        return { Ki_eff, speed: stats.speed, t_com, travel_time_L };
    });

    let t_com_max = 0;
    finalEnemyCalcs.forEach(calc => { t_com_max = Math.max(t_com_max, calc.t_com); });

    let Tn = 0;
    for (const calc of finalEnemyCalcs) {
        const t_start = t_com_max - calc.t_com;
        const spawn_duration = calc.Ki_eff > 1 ? (calc.Ki_eff - 1) * dt_seconds : 0;
        const t_finish_last = t_start + spawn_duration + calc.travel_time_L;
        Tn = Math.max(Tn, t_finish_last);
    }
    return Tn;
}
// --- End Consolidated Function ---

document.addEventListener("DOMContentLoaded", function() {
  const plotDiv = document.getElementById('pathCoveragePlot');

  // Function to fetch and parse path coverage CSV
  function fetchPathCoverageData() {
      return fetch('../assets/paths/path-coverage.csv')
          .then(response => {
              if (!response.ok) {
                  throw new Error(`HTTP error fetching coverage data! status: ${response.status}`);
              }
              return response.text();
          })
          .then(csvText => {
              const lines = csvText.trim().split('\n');
              const xData = [];
              const yData = [];
              for (let i = 1; i < lines.length; i++) { // Skip header
                  const columns = lines[i].split(',');
                  if (columns.length === 2) {
                      const range = parseInt(columns[0]);
                      const coverage = parseFloat(columns[1]);
                      if (!isNaN(range) && !isNaN(coverage)) {
                          xData.push(range);
                          yData.push(coverage);
                      }
                  }
              }
              return { xData, yData };
          });
  }

  // Function to fetch level data JSON
  function fetchLevelData() {
      return fetch('../assets/level1.json') // Fetch level1.json
          .then(response => {
              if (!response.ok) {
                  throw new Error(`HTTP error fetching level data! status: ${response.status}`);
              }
              return response.json();
          });
  }

  // Use Promise.all to wait for both fetches
  Promise.all([fetchPathCoverageData(), fetchLevelData()])
    .then(([coverageData, levelData]) => {
      // Both fetches succeeded, data is available here
      const { xData, yData } = coverageData;
      const exclusionRadius = levelData?.pathExclusionRadius;

      if (typeof exclusionRadius !== 'number') {
          throw new Error('pathExclusionRadius not found or not a number in level1.json');
      }

      // Define endpoints for the reference line directly
      const linearX = [exclusionRadius, mapRangeThreshold];
      const linearY = [0, 0.72];

      const trace1 = {
          x: xData,
          y: yData,
          mode: 'lines',
          type: 'scatter',
          name: 'Coverage Fraction',
          line: { color: 'rgb(75, 192, 192)' },
          cliponaxis: false
      };

      const trace2 = {
          x: linearX, // Use the 2-point array
          y: linearY, // Use the 2-point array
          mode: 'lines',
          type: 'scatter',
          name: 'Linear reference',
          line: { color: 'black', width: 1.5 },
          cliponaxis: false
      };

      const layout = {
          font: { family: "'Latin Modern Roman', serif", size: 14 },
          xaxis: {
              title: 'Defender range (pixels)',
              range: [0, 1000],
              dtick: 200,
              titlefont: { family: "'Latin Modern Roman', serif" },
              tickfont: { family: "'Latin Modern Roman', serif" },
              showline: true,
              linecolor: 'black',
              linewidth: 1,
              mirror: true
          },
          yaxis: {
              title: 'Fraction of path in range',
              range: [0, 1.05],
              dtick: 0.2,
              titlefont: { family: "'Latin Modern Roman', serif" },
              tickfont: { family: "'Latin Modern Roman', serif" },
              showline: true,
              linecolor: 'black',
              linewidth: 1,
              mirror: true
          },
          margin: { l: 50, r: 20, t: 30, b: 50, pad: 0 },
          showlegend: true,
          legend: {
              font: { family: "'Latin Modern Roman', serif" },
              x: 0.05,
              y: 0.95,
              xanchor: 'left',
              yanchor: 'top'
          },
          layer: 'below traces',
          shapes: [
            {
              type: 'line',
              x0: 733,
              y0: 0,
              x1: 733,
              y1: 1.05,
              yref: 'y',
              line: {
                color: 'black', // Changed from grey to black
                width: 2,
                dash: 'dash'
              }
            },
            {
              type: 'line',
              x0: exclusionRadius, // Use fetched value
              y0: 0,
              x1: exclusionRadius, // Use fetched value
              y1: 1,
              yref: 'paper',
              line: {
                color: 'black', // Changed from red to black
                width: 2,
                dash: 'dash'
              }
            },
            {
              // New line for the specified range threshold
              type: 'line',
              x0: mapRangeThreshold, // Use variable
              y0: 0,
              x1: mapRangeThreshold, // Use variable
              y1: 1,
              yref: 'paper',
              line: {
                color: 'black',
                width: 2,
                dash: 'dash'
              }
            }
          ]
      };

      Plotly.newPlot(plotDiv, [trace1, trace2], layout);
    })
    .catch(error => {
      // Handle errors from either fetch or processing
      console.error('Error fetching data or rendering plot:', error);
      if (plotDiv) {
          let errorMsgElement = plotDiv.querySelector('.chart-error-msg');
          if (!errorMsgElement) {
              errorMsgElement = document.createElement('p');
              errorMsgElement.style.color = 'red';
              errorMsgElement.classList.add('chart-error-msg');
              plotDiv.appendChild(errorMsgElement);
          }
          errorMsgElement.textContent = 'Error loading chart: ' + error.message + '. Check console.';
      }
    });

  // --- Script for Map Visualization ---
  const mapImage = document.getElementById('mapImage');
  const mapCanvas = document.getElementById('optimumPositionsCanvas');
  const mapCtx = mapCanvas.getContext('2d');
  const optimalPosDataPath = '../assets/paths/path-optimums.csv';
  const mapRangeThreshold = 468; // Define threshold variable here

  // Ensure image is loaded before drawing (important for dimensions if not hardcoded)
  mapImage.onload = () => {
      console.log("Map image loaded. Fetching optimum positions...");
      fetchOptimalPositions(mapRangeThreshold); // Pass variable
  };
  // Handle cases where image might already be loaded (e.g., from cache)
  if (mapImage.complete && mapImage.naturalHeight !== 0) {
       console.log("Map image already complete. Fetching optimum positions...");
       fetchOptimalPositions(mapRangeThreshold); // Pass variable
  }
  mapImage.onerror = () => {
      console.error("Failed to load map image:", mapImage.src);
      const mapContainer = document.getElementById('mapContainer');
      if(mapContainer){
          mapContainer.innerHTML = '<p style="color:red;">Error loading map image. Check path and console.</p>';
      }
  }

  // Use async function to handle fetching dependencies sequentially
  // Accept threshold as an argument
  async function fetchOptimalPositions(threshold) { 
      try {
          // --- Fetch level data first ---
          const levelResponse = await fetch('../assets/level1.json');
          if (!levelResponse.ok) {
              throw new Error(`HTTP error fetching level data! status: ${levelResponse.status}`);
          }
          const levelData = await levelResponse.json();
          const exclusionRadius = levelData?.pathExclusionRadius;

          if (typeof exclusionRadius !== 'number') {
              throw new Error('pathExclusionRadius not found or not a number in level1.json');
          }
          // ---------------------------

          // --- Now fetch optimum positions ---
          const optimumsResponse = await fetch(optimalPosDataPath);
          if (!optimumsResponse.ok) {
              throw new Error(`HTTP error fetching optimum positions! status: ${optimumsResponse.status} - Check path: ${optimalPosDataPath}`);
          }
          const csvText = await optimumsResponse.text();
          // -----------------------------

          const positions = [];
          const lines = csvText.trim().split('\n');
          // Skip header
          for (let i = 1; i < lines.length; i++) {
              const columns = lines[i].split(',');
              if (columns.length === 3) {
                  const range = parseInt(columns[0]); // Parse range
                  const x = parseFloat(columns[1]);
                  const y = parseFloat(columns[2]);
                  if (!isNaN(range) && !isNaN(x) && !isNaN(y)) {
                      positions.push({ range, x, y }); // Store range, x, y
                  }
              }
          }
          // Filter using only the lower bound (exclusionRadius)
          const filteredPositions = positions.filter(pos => pos.range > exclusionRadius);

          // Sort by range to find the first one >= threshold
          filteredPositions.sort((a, b) => a.range - b.range);
          const targetPosition = filteredPositions.find(pos => pos.range >= threshold);

          // Pass the target position (or undefined if not found) to the drawing function
          drawOptimalPositions(filteredPositions, threshold, targetPosition); 

      } catch (error) {
          // --- Unified error handling ---
          console.error('Error fetching data or processing positions:', error);
          mapCtx.fillStyle = 'red';
          mapCtx.font = '12px sans-serif';
          mapCtx.fillText('Error loading optimal positions. See console.', 10, 20);
          // --------------------------
      }
  }

  function drawOptimalPositions(positions, rangeThreshold, targetPosition) {
      // Define original (data) and display dimensions
      const originalWidth = 1024;
      const originalHeight = 1024;
      const displayWidth = 600;
      const displayHeight = 600;

      // Set canvas size explicitly
      mapCanvas.width = displayWidth;
      mapCanvas.height = displayHeight;
      
      mapCtx.clearRect(0, 0, mapCanvas.width, mapCanvas.height); // Clear previous drawings
      const dotRadius = 2; // Size of the position dots

      // Calculate scaling factors
      const scaleX = displayWidth / originalWidth;
      const scaleY = displayHeight / originalHeight;

      // --- Draw all the position dots first ---
      positions.forEach(pos => {
          if (pos.range < rangeThreshold) {
              mapCtx.fillStyle = 'red';
          } else {
              mapCtx.fillStyle = 'blue';
          }
          const scaledX = pos.x * scaleX;
          const scaledY = pos.y * scaleY;
          mapCtx.beginPath();
          mapCtx.arc(scaledX, scaledY, dotRadius, 0, 2 * Math.PI);
          mapCtx.fill(); 
      });
      // --- End drawing dots ---
       
      // --- Draw the target circle outline --- 
      if (targetPosition) {
          console.log("Drawing target circle for range:", targetPosition.range);
          const scaledCenterX = targetPosition.x * scaleX;
          const scaledCenterY = targetPosition.y * scaleY;
          // Scale the radius using the same factor as x-coordinates (assuming uniform scaling)
          const scaledRadius = targetPosition.range * scaleX; 

          mapCtx.beginPath();
          mapCtx.arc(scaledCenterX, scaledCenterY, scaledRadius, 0, 2 * Math.PI);
          mapCtx.strokeStyle = 'blue'; // Blue outline
          mapCtx.lineWidth = 1; // Thin outline
          mapCtx.stroke(); // Draw the outline, don't fill
      }
      // --- End drawing circle --- 
      
      console.log(`Finished drawing optimal positions. Threshold: ${rangeThreshold}px`);
  }
  // --------------------------------
}); // Closing DOMContentLoaded for pathCoveragePlot and map visualization


// --- Script for Endgame Ratio Plot --- (Wrapped in its own DOMContentLoaded)
document.addEventListener("DOMContentLoaded", function() {
  const endgamePlotDiv = document.getElementById('endgameRatioPlot');
  const analysisDataPath = '../assets/waves/analysis-results.json';
  const analysisParamsPath = '../assets/waves/analysis-params.json'; // Path to the saved parameters

  // Function to fetch a JSON file
  function fetchJson(path) {
    return fetch(path).then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error fetching ${path}! status: ${response.status}`);
      }
      return response.json();
    });
  }

  // Fetch analysis results and the saved parameters
  Promise.all([
     fetchJson(analysisDataPath), // Existing analysis results
     fetchJson(analysisParamsPath)  // Saved parameters from analysis.js
  ])
  .then(([analysisResults, analysisParams]) => {
    // Use parameters directly from the saved file
    const { B0, beta, W1, f, L, dt_seconds, waveGenConfig, enemyStats, T0 } = analysisParams;

    // Validate loaded parameters
    if (B0 === undefined || beta === undefined || W1 === undefined || f === undefined || L === undefined || dt_seconds === undefined || !waveGenConfig || !Array.isArray(enemyStats) || enemyStats.length === 0 || T0 === undefined) {
        throw new Error('Missing required parameters in analysis-params.json');
    }
    const N = enemyStats.length; // Get N from the loaded enemyStats
    console.log("Using parameters from analysis-params.json:", analysisParams);

    // --- Calculate T1 and Theoretical B0 for g1=1 ---
    const T1 = calculateTheoreticalWaveDuration(1, W1, f, enemyStats, L, dt_seconds, waveGenConfig);
    let B0_theoretical;
    if (T1 > 0 && f > 1 && beta > 0 && W1 > 0) { 
        B0_theoretical = (T0 * beta * W1) / (T1 * (f - 1));
        console.log(`Calculated theoretical B0 for g1=1: ${B0_theoretical.toFixed(2)}`);
    } else {
        console.warn(`Cannot calculate theoretical B0: T0=${T0}, T1=${T1}, f=${f}, beta=${beta}, W1=${W1}. Using original B0.`);
        B0_theoretical = B0; // Fallback if calculation failed
    }
    // ------------------------------------

    // --- Use B0 from the file for the main theoretical line ---
    const B0_to_use_main = B0;
    console.log("Using B0 from file for solid line:", B0_to_use_main);
    // ------------------------------------

    // Calculate theoretical g_n values for BOTH B0 scenarios
    const waves = analysisResults.map(d => d.wave);
    const ratios_simulated = analysisResults.map(d => d.ratio);
    const gn_theoretical_main = []; // For solid line (B0 from file)
    const gn_theoretical_g1_equals_1 = []; // For dashed line (calculated B0)

    for (const n of waves) {
        const Tn = calculateTheoreticalWaveDuration(n, W1, f, enemyStats, L, dt_seconds, waveGenConfig);
        if (T0 <= 0 || Tn <= 0 || beta <= 0 || W1 <= 0) {
             console.warn(`Skipping g_n calculation for wave ${n} due to non-positive T0=${T0}, Tn=${Tn}, beta=${beta}, or W1=${W1}`);
             gn_theoretical_main.push(NaN);
             gn_theoretical_g1_equals_1.push(NaN);
             continue;
        }
        const denominator = Math.pow(f, n - 1);
        if (denominator === 0) {
             console.warn(`Skipping g_n calculation for wave ${n} due to zero denominator`);
             gn_theoretical_main.push(NaN);
             gn_theoretical_g1_equals_1.push(NaN);
             continue;
        }

        // Calculate g_n using B0 from file (for solid line)
        const term1_main = (f - 1) * (B0_to_use_main / (beta * W1));
        const numerator_main = term1_main - 1;
        const gn_main = (Tn / T0) * (1 + numerator_main / denominator);
        gn_theoretical_main.push(gn_main);

        // Calculate g_n using theoretical B0 (for dashed line)
        const term1_g1_equals_1 = (f - 1) * (B0_theoretical / (beta * W1));
        const numerator_g1_equals_1 = term1_g1_equals_1 - 1;
        const gn_g1_equals_1 = (Tn / T0) * (1 + numerator_g1_equals_1 / denominator);
        gn_theoretical_g1_equals_1.push(gn_g1_equals_1);
    }

    // Calculate Asymptotic g_n = A * f^(n-1) with A adjusted
    const A_asymptotic = 0.002 * (288.68 / 255.67);
    const gn_asymptotic = waves.map(n => A_asymptotic * Math.pow(f, n - 1));

    // Create Plotly traces
    const trace_simulated = {
      x: waves,
      y: ratios_simulated,
      mode: 'markers',
      type: 'scatter',
      name: 'Simulated g<sub>n</sub>',
      line: { color: 'rgb(219, 64, 82)' },
      marker: { size: 8 },
      cliponaxis: false
    };

    const trace_theoretical = {
      x: waves,
      y: gn_theoretical_main, // Use B0 from file
      mode: 'lines',
      type: 'scatter',
      name: 'Theoretical g<sub>n</sub> (Actual B<sub>0</sub>)', // Adjusted name slightly
      line: { color: 'black', width: 2, dash: 'solid' },
      cliponaxis: false
    };

    const trace_theoretical_g1_equals_1 = {
      x: waves,
      y: gn_theoretical_g1_equals_1, // Use calculated B0
      mode: 'lines',
      type: 'scatter',
      name: 'Theoretical g<sub>n</sub> (g<sub>1</sub>=1 B<sub>0</sub>)', // Adjusted name slightly
      line: { color: 'black', width: 2, dash: 'dash' },
      cliponaxis: false
    };

    const trace_asymptotic = {
        x: waves,
        y: gn_asymptotic,
        mode: 'lines',
        type: 'scatter',
        name: `Asymptotic g<sub>n</sub>`,
        line: { color: 'black', width: 1.5, dash: 'dot' }, // Dotted line
        cliponaxis: false
    };

    // Find overall max y-value for setting range (excluding NaN/Infinity)
    const allYValues = [
        ...ratios_simulated,
        ...gn_theoretical_main,
        ...gn_theoretical_g1_equals_1,
        ...gn_asymptotic
    ].filter(y => y !== null && Number.isFinite(y) && y > 0);
    const maxYValue = allYValues.length > 0 ? Math.max(...allYValues) : 1000; // Fallback max

    // Define Plotly layout
    const layout = {
      height: 500, // Explicitly set height
      font: { family: "'Latin Modern Roman', serif", size: 14 },
      xaxis: {
        title: 'Wave number (n)',
        range: [0, Math.max(...waves) + 1],
        dtick: 5,
        titlefont: { family: "'Latin Modern Roman', serif" },
        tickfont: { family: "'Latin Modern Roman', serif" },
        showline: true,
        linecolor: 'black',
        linewidth: 1,
        mirror: true
      },
      yaxis: {
        title: 'Balance Ratio (g<sub>n</sub>)',
        type: 'log',
        range: [Math.log10(0.5), Math.log10(maxYValue * 1.1)], // Set range [log10(min), log10(max)]
        titlefont: { family: "'Latin Modern Roman', serif" },
        tickfont: { family: "'Latin Modern Roman', serif" },
        showline: true,
        linecolor: 'black',
        linewidth: 1,
        mirror: true
      },
      margin: { l: 70, r: 20, t: 30, b: 50, pad: 0 },
      showlegend: true, // Show legend
      legend: { 
          font: { family: "'Latin Modern Roman', serif" }, 
          x: 0.05, 
          y: 0.95, 
          xanchor: 'left', 
          yanchor: 'top' 
      },
      layer: 'below traces'
    };

    // Render the plot with all four traces
    Plotly.newPlot(endgamePlotDiv, [trace_simulated, trace_theoretical, trace_theoretical_g1_equals_1, trace_asymptotic], layout);
  })
  .catch(error => {
    console.error('Error fetching data or rendering endgame plot:', error);
    if (endgamePlotDiv) {
      let errorMsgElement = endgamePlotDiv.querySelector('.chart-error-msg');
      if (!errorMsgElement) {
        errorMsgElement = document.createElement('p');
        errorMsgElement.style.color = 'red';
        errorMsgElement.classList.add('chart-error-msg');
        endgamePlotDiv.appendChild(errorMsgElement);
      }
      errorMsgElement.textContent = 'Error loading chart: ' + error.message + '. Check console.';
    }
  });
}); // Closing DOMContentLoaded for Endgame Ratio Plot


// Script to trigger KaTeX rendering (Wrapped in its own DOMContentLoaded)
document.addEventListener("DOMContentLoaded", function() {
  renderMathInElement(document.body, {
    delimiters: [
        {left: '$$', right: '$$', display: true},
        {left: '\\[', right: '\\]', display: true},
        {left: '$', right: '$', display: false},
        {left: '\\(', right: '\\)', display: false}
    ],
    throwOnError : false
  });
}); // Closing DOMContentLoaded for KaTeX rendering


// Script for fComparisonPlot (Wrapped in its own DOMContentLoaded)
document.addEventListener("DOMContentLoaded", function() {
  const fPlotDiv = document.getElementById('fComparisonPlot');
  const fValuesToAdd = [1.05, 1.1, 1.2]; // f values to compare against original, removed 1.4 and 1.3
  const maxWaveN_f = 75; // Max wave number to plot

  // Path to the frozen parameters file
  const analysisParamsPath_f = '../assets/waves/analysis-params.json';

  // Function to fetch JSON
  function fetchJson_f(path) {
    return fetch(path).then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error fetching ${path}! status: ${response.status}`);
      }
      return response.json();
    });
  }

  // Fetch only the saved parameters file
  fetchJson_f(analysisParamsPath_f)
  .then(analysisParams => {
      // --- Extract parameters directly from the loaded file ---
      const { B0, beta, W1, f: original_f, L, dt_seconds, waveGenConfig, enemyStats, T0 } = analysisParams;
      console.log("Using parameters from analysis-params.json for Fig 4:", analysisParams);

      // Validate loaded parameters
      if (B0 === undefined || beta === undefined || W1 === undefined || original_f === undefined || L === undefined || dt_seconds === undefined || !waveGenConfig || !Array.isArray(enemyStats) || enemyStats.length === 0 || T0 === undefined) {
          throw new Error('Missing required parameters in analysis-params.json for Figure 4');
      }

      // Combine original f with the test values, sort and remove duplicates
      const fValues = [...new Set([original_f, ...fValuesToAdd])].sort((a, b) => b - a); // Sort DESCENDING

      const plotData = [];
      // const waveNumbers = Array.from({length: maxWaveN_f}, (_, i) => i + 1); // Defined inside loop now

      // --- Loop through f values and calculate g_n --- 
      console.log("Calculating theoretical g_n for f values:", fValues);
      for (const f of fValues) {
          console.log(`Calculating for f = ${f.toFixed(1)}...`);

          // --- Determine max wave number for this f value ---
          let currentMaxN = maxWaveN_f; // Default max wave (75)
          if (f === 1.1) {
              currentMaxN = 150;
          } else if (f === 1.05) {
              currentMaxN = 500;
          }
          const waveNumbers = Array.from({length: currentMaxN}, (_, i) => i + 1);
          // ----------------------------------------------------

          // --- Calculate theoretical B0 for this specific f such that g1=1 ---
          const T1_f = calculateTheoreticalWaveDuration(1, W1, f, enemyStats, L, dt_seconds, waveGenConfig);
          let B0_theoretical_f = NaN; // Default to NaN
          if (T0 > 0 && T1_f > 0 && beta > 0 && W1 > 0 && f > 1) {
              B0_theoretical_f = (T0 * beta * W1) / (T1_f * (f - 1));
              console.log(` -> Theoretical B0 for f=${f.toFixed(1)} (g1=1): ${B0_theoretical_f.toFixed(2)} (using T1=${T1_f.toFixed(2)}s)`);
          } else {
              console.warn(` -> Cannot calculate theoretical B0 for f=${f.toFixed(1)}: T0=${T0.toFixed(2)}, T1=${T1_f.toFixed(2)}, beta=${beta}, W1=${W1}, f=${f}`);
          }
          // ------------------------------------------------------------------

          const gn_values = [];
          for (const n of waveNumbers) {
              const Tn = calculateTheoreticalWaveDuration(n, W1, f, enemyStats, L, dt_seconds, waveGenConfig);

              let gn = NaN;
              if (T0 > 0 && Tn > 0 && beta > 0 && W1 > 0 && f > 1 && !isNaN(B0_theoretical_f)) {
                  const denominator_term = Math.pow(f, n - 1);
                  if (denominator_term > 0) {
                      const term1 = (f - 1) * (B0_theoretical_f / (beta * W1));
                      const numerator = term1 - 1;
                      gn = (Tn / T0) * (1 + numerator / denominator_term);
                  }
              }
              gn_values.push(gn);
          }

          plotData.push({
              x: waveNumbers,
              y: gn_values,
              mode: 'lines',
              type: 'scatter',
              name: `f = ${f.toFixed(2)}`, // Format legend entry
              line: { width: 2 } // Removed specific color assignment
          });
          console.log(` -> First few g_n for f=${f.toFixed(1)}:`, gn_values.slice(0, 5).map(v => v.toFixed(2)));
      }

      // --- Create Plotly layout --- 
      const allYValues_f = plotData.flatMap(trace => trace.y).filter(y => y !== null && Number.isFinite(y) && y > 0);
      const maxYValue_f = allYValues_f.length > 0 ? Math.max(...allYValues_f) : 1000;
      // const minYValue_f = allYValues_f.length > 0 ? Math.min(...allYValues_f) : 0.1; // Not used in this layout

      const layout_f = {
          height: 500,
          font: { family: "'Latin Modern Roman', serif", size: 14 },
          xaxis: {
            title: 'Wave Number (n)',
            type: 'log',
            range: [Math.log10(1), Math.log10(500)],
            titlefont: { family: "'Latin Modern Roman', serif" },
            tickfont: { family: "'Latin Modern Roman', serif" },
            showline: true, linecolor: 'black', linewidth: 1, mirror: true
          },
          yaxis: {
            title: 'Balance Ratio (g<sub>n</sub>)',
            type: 'log',
            range: [Math.log10(0.5), Math.log10(300)],
            titlefont: { family: "'Latin Modern Roman', serif" },
            tickfont: { family: "'Latin Modern Roman', serif" },
            showline: true, linecolor: 'black', linewidth: 1, mirror: true
          },
          margin: { l: 80, r: 30, t: 30, b: 50, pad: 0 },
          showlegend: true,
          legend: { font: { family: "'Latin Modern Roman', serif" }, x: 0.05, y: 0.95, xanchor: 'left', yanchor: 'top' },
          layer: 'below traces'
      };

      Plotly.newPlot(fPlotDiv, plotData, layout_f);
      console.log("Figure 4 plotted.");

  }).catch(error => {
      console.error('Error generating Figure 4 comparison plot:', error);
      if (fPlotDiv) {
        let errorMsgElement = fPlotDiv.querySelector('.chart-error-msg');
        if (!errorMsgElement) {
            errorMsgElement = document.createElement('p');
            errorMsgElement.style.color = 'red';
            errorMsgElement.classList.add('chart-error-msg');
            fPlotDiv.appendChild(errorMsgElement);
        }
        errorMsgElement.textContent = 'Error loading chart: ' + error.message + '. Check console.';
      }
  });
}); // Closing DOMContentLoaded for fComparisonPlot


// Script to calculate and log theoretical alpha_0 and B_0 (Wrapped in its own DOMContentLoaded)
document.addEventListener("DOMContentLoaded", async () => {
  console.log("Calculating theoretical alpha_0 and B_0 using current game parameters...");

  const level1Path_calc = '../assets/level1.json';
  const wavesPath_calc = '../assets/waves/waves.json';

  function fetchJson_calc(path) {
    return fetch(path).then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error fetching ${path}! status: ${response.status}`);
      }
      return response.json();
    });
  }

  try {
      const levelData = await fetchJson_calc(level1Path_calc);
      const waveData = await fetchJson_calc(wavesPath_calc);

      const pathStatsPath_calc = `../${levelData.pathStatsPath}`;
      const pathStats = await fetchJson_calc(pathStatsPath_calc);

      const enemyDataPath_calc = `../${levelData.enemyData}`;
      const enemiesData = await fetchJson_calc(enemyDataPath_calc);

      const beta = levelData.betaFactor;
      const W1 = waveData.startingDifficulty;
      const f = waveData.difficultyIncreaseFactor;
      const L = pathStats.totalPathLength;
      const dt_seconds = (waveData.delayBetweenEnemiesMs || 500) / 1000.0;
      const waveGenConfig = waveData.waveGeneration || {};

      if (!Array.isArray(enemiesData) || enemiesData.length === 0) throw new Error('No enemy data found.');
      const currentEnemyStats = enemiesData.map(e => ({
          id: e.id,
          speed: e.stats.speed,
          hp: e.stats.hp,
          w: (e.stats.speed || 0) * (e.stats.hp || 0)
      })).filter(e => e.speed > 0 && e.hp > 0);

      if (currentEnemyStats.length === 0) throw new Error('No enemies with valid speed and hp found.');

      const s_min = Math.min(...currentEnemyStats.map(e => e.speed));
      if (s_min <= 0) throw new Error('Slowest enemy speed must be positive.');

      const T0 = L / s_min;
      const T1 = calculateTheoreticalWaveDuration(1, W1, f, currentEnemyStats, L, dt_seconds, waveGenConfig);

      let alpha_0 = NaN;
      if (f > 1) {
          alpha_0 = T0 / (f - 1);
      }

      let B0_calc = NaN;
      if (T1 > 0 && f > 1 && beta > 0 && W1 > 0) {
          B0_calc = (T0 * beta * W1) / (T1 * (f - 1));
      }

      console.log(`--- Theoretical Break-even Parameters (Current Game Files) ---`);
      console.log(`  Parameters Used: f=${f.toFixed(3)}, W1=${W1}, beta=${beta}`);
      console.log(`  Calculated T0 (L/s_min): ${T0.toFixed(2)} s`);
      console.log(`  Calculated T1: ${T1.toFixed(2)} s`);
      console.log(`  Theoretical alpha_0 (Eq. 19): ${alpha_0.toFixed(2)}`);
      console.log(`  Theoretical B0 for g1=1 (Eq. 23): ${B0_calc.toFixed(2)}`);
      console.log(`--- End Calculation ---`);

  } catch (error) {
    console.error("Error calculating theoretical parameters:", error);
  }
}); // Closing DOMContentLoaded for theoretical alpha_0 and B_0 calculation


// Script for dn vs n plot (Wrapped in its own DOMContentLoaded)
document.addEventListener("DOMContentLoaded", function() {
  const dnPlotDiv = document.getElementById('dnEvolutionPlot');
  const analysisParamsPath_dn = '../assets/waves/analysis-params.json';
  const maxWaveN_dn = 25; // Max wave number to plot

  function fetchJson_dn(path) {
    return fetch(path).then(response => {
      if (!response.ok) {
        throw new Error(`HTTP error fetching ${path}! status: ${response.status}`);
      }
      return response.json();
    });
  }

  fetchJson_dn(analysisParamsPath_dn)
  .then(analysisParams => {
      const { f, T0, W1, L, dt_seconds, enemyStats, waveGenConfig } = analysisParams;
      console.log("Using parameters from analysis-params.json for dn plot:", analysisParams);

      if (f === undefined || T0 === undefined || W1 === undefined || L === undefined || dt_seconds === undefined || !Array.isArray(enemyStats) || enemyStats.length === 0 || !waveGenConfig) {
          throw new Error('Missing required parameters in analysis-params.json for dn plot');
      }
      if (T0 <= 0) {
          throw new Error('T0 must be positive for dn calculation.');
      }

      const waveNumbers = Array.from({length: maxWaveN_dn}, (_, i) => i + 1);
      const T_values = {};
      const dn_values = [];

      console.log("Calculating Tn values...");
      for (let n = 1; n <= maxWaveN_dn + 1; n++) {
          T_values[n] = calculateTheoreticalWaveDuration(n, W1, f, enemyStats, L, dt_seconds, waveGenConfig);
      }
      console.log("Finished calculating Tn values.");

      console.log("Calculating dn values...");
      const logistic_values = [];
      const n0 = 13.5;
      const k = 0.55;
      const L_logistic = (f - 1) / T0;
      console.log(`Logistic params: L=${L_logistic}, n0=${n0}, k=${k}`);

      for (const n of waveNumbers) {
          const Tn = T_values[n];
          const Tn_plus_1 = T_values[n + 1];
          let dn = NaN;

          if (Tn > 0 && Tn_plus_1 !== undefined) {
              const gamma_n = Tn_plus_1 / Tn;
              if (gamma_n > 0) {
                  const term1 = L_logistic;
                  const term2_factor = 1 / Tn;
                  const term2_bracket = 1 - (f / gamma_n);
                  dn = term1 + term2_factor * term2_bracket;
              } else {
                   console.warn(`Cannot calculate dn for n=${n}: gamma_n (${gamma_n.toFixed(3)}) is not positive.`);
              }
          } else {
              console.warn(`Cannot calculate dn for n=${n}: Tn (${Tn?.toFixed(3)}) is not positive or Tn+1 is undefined.`);
          }
          dn_values.push(dn);

          const logistic_val = L_logistic / (1 + Math.exp(-k * (n - n0)));
          logistic_values.push(logistic_val);
      }
      console.log("Finished calculating dn and logistic values.");

      const trace_dn = {
          x: waveNumbers,
          y: dn_values,
          mode: 'markers',
          type: 'scatter',
          name: 'd<sub>n</sub>',
          marker: { size: 8, color: 'rgb(255, 127, 14)' },
          cliponaxis: false
      };

      const trace_logistic = {
          x: waveNumbers,
          y: logistic_values,
          mode: 'lines',
          type: 'scatter',
          name: `Logistic (n₀=${n0}, k=${k})`,
          line: { color: 'black', width: 1.5 }
      };

      const layout_dn = {
          height: 500,
          font: { family: "'Latin Modern Roman', serif", size: 14 },
          xaxis: {
              title: 'Wave number (n)',
              range: [0, maxWaveN_dn + 1],
              dtick: 5,
              titlefont: { family: "'Latin Modern Roman', serif" },
              tickfont: { family: "'Latin Modern Roman', serif" },
              showline: true, linecolor: 'black', linewidth: 1, mirror: true
          },
          yaxis: {
              title: 'Fractional damage rate (d<sub>n</sub>)',
              autorange: true,
              titlefont: { family: "'Latin Modern Roman', serif" },
              tickfont: { family: "'Latin Modern Roman', serif" },
              showline: true, linecolor: 'black', linewidth: 1, mirror: true,
              zeroline: true, zerolinecolor: 'grey', zerolinewidth: 1
          },
          margin: { l: 80, r: 20, t: 30, b: 50, pad: 0 },
          showlegend: true,
          legend: { 
              font: { family: "'Latin Modern Roman', serif" }, 
              x: 0.05, y: 0.95, 
              xanchor: 'left', yanchor: 'top' 
          },
          layer: 'below traces'
      };

      Plotly.newPlot(dnPlotDiv, [trace_dn, trace_logistic], layout_dn);
      console.log("dn vs n plot rendered with logistic overlay.");

  })
  .catch(error => {
      console.error('Error fetching data or rendering dn plot:', error);
      if (dnPlotDiv) {
        let errorMsgElement = dnPlotDiv.querySelector('.chart-error-msg');
        if (!errorMsgElement) {
            errorMsgElement = document.createElement('p');
            errorMsgElement.style.color = 'red';
            errorMsgElement.classList.add('chart-error-msg');
            dnPlotDiv.appendChild(errorMsgElement);
        }
        errorMsgElement.textContent = 'Error loading chart: ' + error.message + '. Check console.';
      }
  });
}); // Closing DOMContentLoaded for dn vs n plot


// Script for Depreciation Comparison Plot (Wrapped in its own DOMContentLoaded)
document.addEventListener("DOMContentLoaded", function() {
  const depreciationPlotDiv = document.getElementById('depreciationComparisonPlot');
  const originalResultsPath = '../assets/waves/analysis-results.json';
  const dtREndResultsPath = '../assets/waves/analysis-depreciation-results.json';
  const paramsPath = '../assets/waves/analysis-params.json';

  function fetchJson_depr(path) {
    return fetch(path).then(response => {
      if (!response.ok) {
        console.warn(`HTTP error fetching ${path}! status: ${response.status}`);
        return null;
      }
      return response.json();
    }).catch(error => {
        console.error(`Fetch error for ${path}:`, error);
        return null;
    });
  }

  Promise.all([
     fetchJson_depr(originalResultsPath),
     fetchJson_depr(dtREndResultsPath),
     fetchJson_depr(paramsPath)
  ])
  .then(([originalResults, dtREndResults, params]) => {
    if (!originalResults) {
      console.error("Depreciation Plot: originalResults is null or undefined. Check path for", originalResultsPath);
    }
    if (!dtREndResults) {
      console.error("Depreciation Plot: dtREndResults is null or undefined. Check path for", dtREndResultsPath);
    }
    if (!params) {
      console.error("Depreciation Plot: params is null or undefined. Check path for", paramsPath);
      throw new Error("Depreciation Plot: Missing analysis parameters. Cannot proceed.");
    }
    console.log("Depreciation Plot: Fetched originalResults:", originalResults ? originalResults.length : 'null');
    console.log("Depreciation Plot: Fetched dtREndResults:", dtREndResults ? dtREndResults.length : 'null');
    console.log("Depreciation Plot: Fetched params:", params ? Object.keys(params).length + ' keys' : 'null');

    const plotData = [];
    let maxWave = 0;
    let maxYValue = 0.1;
    let minYValue = 100; 
    let analyticalWavesX = [];
    let analyticalRatioSmooth = [];
    let originalTheoretical_gn = [];

    const { f, T0, B0, W1, beta, L, dt_seconds, enemyStats, waveGenConfig, wear: wear_from_params } = params;
    if (wear_from_params === undefined || wear_from_params < 0) {
        throw new Error("Missing or invalid 'wear' parameter in analysis-params.json");
    }

    function addTrace(x_data, y_data, name, color, mode = 'markers', lineStyle = {}) {
        if (!x_data || !y_data || x_data.length === 0 || y_data.length === 0 || x_data.length !== y_data.length) {
            console.warn(`Skipping trace ${name}: Invalid or mismatched data. X: ${x_data?.length}, Y: ${y_data?.length}`);
            return;
        }
        maxWave = Math.max(maxWave, ...x_data);
        
        const finiteRatios = y_data.filter(y => isFinite(y) && y !== null);
        if (finiteRatios.length > 0) {
            maxYValue = Math.max(maxYValue, ...finiteRatios);
            const positiveFiniteRatios = finiteRatios.filter(y => y > 1e-6); 
            if (positiveFiniteRatios.length > 0) {
                 minYValue = Math.min(minYValue, ...positiveFiniteRatios); 
            }
        }
        plotData.push({
            x: x_data,
            y: y_data,
            mode: mode,
            type: 'scatter',
            name: name,
            marker: { color: color, size: (mode.includes('markers') ? 8 : undefined) }, 
            line: (mode.includes('lines') ? { color: color, width: 1.5, ...lineStyle } : undefined),
            cliponaxis: false
        });
    }

    let simMaxWave = 0;
    if (originalResults) {
        simMaxWave = Math.max(simMaxWave, ...originalResults.map(d => d.wave));
        addTrace(originalResults.map(d => d.wave), originalResults.map(d => d.ratio), 'Simulation (no depreciation)', 'rgb(219, 64, 82)');
    }
    if (dtREndResults) {
        simMaxWave = Math.max(simMaxWave, ...dtREndResults.map(d => d.wave));
        addTrace(dtREndResults.map(d => d.wave), dtREndResults.map(d => d.ratio), 'Simulation (full depreciation)', 'rgb(0, 150, 150)', 'markers');
    }
    maxWave = simMaxWave;

    if (maxWave > 0 && typeof calculateTheoreticalWaveDuration === 'function') {
        const alpha_0_depr = 1 / (((f - 1) / T0) + wear_from_params);
        let R_start_analytical_solid = B0 / alpha_0_depr;
        analyticalRatioSmooth = [];
        originalTheoretical_gn = [];
        console.log(`Calculating SOLID line WITH DEPRECIATION (w=${wear_from_params}, alpha_0=${alpha_0_depr.toFixed(4)})`);
        console.log(`Calculating DASHED line with B0=${B0}`);

        let analytical_T_values = {};
        console.log("Calculating theoretical Tn and analytical lines...");

        for (let n = 1; n <= maxWave + 1; n++) {
            analytical_T_values[n] = calculateTheoreticalWaveDuration(n, W1, f, enemyStats, L, dt_seconds, waveGenConfig);
        }

        for (let n = 1; n <= maxWave; n++) {
            analyticalWavesX.push(n);

            const T_n = analytical_T_values[n];
            const T_n_plus_1 = analytical_T_values[n + 1];
            const W_n = W1 * Math.pow(f, n - 1);
            const B_n_theory = W_n * beta; 
            const b_n_theory = (T_n > 0) ? B_n_theory / T_n : 0; 

            let d_n = 0;
            const dn_term1 = (f - 1) / T0;
            if (T_n > 0 && T_n_plus_1 !== undefined) {
                const gamma_n = T_n_plus_1 / T_n;
                if (gamma_n > 0) { 
                    const dn_term2_bracket = 1 - (f / gamma_n);
                    d_n = dn_term1 + (1 / T_n) * dn_term2_bracket;
                } else {
                    console.warn(`Cannot calculate dn for n=${n}: gamma_n (${gamma_n.toFixed(3)}) is not positive.`);
                    d_n = dn_term1;
                }
            } else {
                 console.warn(`Cannot calculate dn for n=${n}: Tn (${T_n?.toFixed(3)}) is not positive or Tn+1 is undefined.`);
                 d_n = dn_term1;
            }

            let g_analytical_smooth = 0;
            if (b_n_theory > 0) { 
                g_analytical_smooth = R_start_analytical_solid / b_n_theory;
            } else if (R_start_analytical_solid === 0 && B_n_theory === 0) { 
                g_analytical_smooth = 1;
            } else if (b_n_theory <= 0 && R_start_analytical_solid > 0) { 
                g_analytical_smooth = Infinity;
            }
            analyticalRatioSmooth.push(isFinite(g_analytical_smooth) ? g_analytical_smooth : (g_analytical_smooth > 0 ? 1e9 : -1e9));

            let R_end_n_analytical_solid = R_start_analytical_solid; 
            const total_loss_rate = wear_from_params + d_n;
            if (b_n_theory > 0 && T_n > 0) { 
                if (Math.abs(total_loss_rate) < 1e-9) {
                    const A_gain = b_n_theory / alpha_0_depr; 
                    R_end_n_analytical_solid = R_start_analytical_solid + A_gain * T_n;
                } else {
                    const steady_state_R = b_n_theory / (alpha_0_depr * total_loss_rate);
                    R_end_n_analytical_solid = steady_state_R + (R_start_analytical_solid - steady_state_R) * Math.exp(-total_loss_rate * T_n);
                }
            }
            R_end_n_analytical_solid = Math.max(0, R_end_n_analytical_solid);
            R_start_analytical_solid = R_end_n_analytical_solid; 

            let gn_original_theory = NaN;
            if (T0 > 0 && T_n > 0 && beta > 0 && W1 > 0) {
                const denominator_term = Math.pow(f, n - 1);
                if (denominator_term > 0) {
                    const term1 = (f - 1) * (B0 / (beta * W1));
                    const numerator = term1 - 1;
                    gn_original_theory = (T_n / T0) * (1 + numerator / denominator_term);
                }
            }
            originalTheoretical_gn.push(isFinite(gn_original_theory) ? gn_original_theory : (gn_original_theory > 0 ? 1e9 : -1e9));
        }
        console.log("Finished calculating analytical lines.")
    } else {
        console.error("Could not calculate analytical lines - maxWave not determined or helper function missing.");
    }

    addTrace(analyticalWavesX, originalTheoretical_gn, 'Theory (no depreciation)', 'black', 'lines', { dash: 'dash' });
    addTrace(analyticalWavesX, analyticalRatioSmooth, 'Theory (full depreciation)', 'black', 'lines'); 

    if (plotData.length === 0) {
        throw new Error("Could not load any results data for Fig 6.");
    }
    minYValue = Math.max(0.05, minYValue); 

    const layout_depr = {
      height: 500,
      font: { family: "'Latin Modern Roman', serif", size: 14 },
      xaxis: {
        title: 'Wave number (n)',
        range: [0, maxWave + 1],
        dtick: 5,
        titlefont: { family: "'Latin Modern Roman', serif" },
        tickfont: { family: "'Latin Modern Roman', serif" },
        showline: true, linecolor: 'black', linewidth: 1, mirror: true
      },
      yaxis: {
        title: 'Balance Ratio',
        type: 'log',
        range: [Math.log10(minYValue * 0.8), Math.log10(maxYValue * 1.2)],
        titlefont: { family: "'Latin Modern Roman', serif" },
        tickfont: { family: "'Latin Modern Roman', serif" },
        showline: true, linecolor: 'black', linewidth: 1, mirror: true
      },
      margin: { l: 80, r: 20, t: 30, b: 50, pad: 0 }, 
      showlegend: true,
      legend: { 
          font: { family: "'Latin Modern Roman', serif", size: 12 },
          x: 0.05, y: 0.98, 
          xanchor: 'left', yanchor: 'top' 
      },
      layer: 'below traces'
    };

    Plotly.newPlot(depreciationPlotDiv, plotData, layout_depr);
    console.log("Added analytical comparison line to plot.");

  })
  .catch(error => {
      console.error("Error in Depreciation Comparison Plot setup:", error);
      if (depreciationPlotDiv) {
        let errorMsgElement = depreciationPlotDiv.querySelector('.chart-error-msg');
        if (!errorMsgElement) {
            errorMsgElement = document.createElement('p');
            errorMsgElement.style.color = 'red';
            errorMsgElement.classList.add('chart-error-msg');
            depreciationPlotDiv.appendChild(errorMsgElement);
        }
        errorMsgElement.textContent = 'Error loading chart: ' + error.message + '. Check console.';
      }
  });
}); // Closing DOMContentLoaded for Depreciation Comparison Plot