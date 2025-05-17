# Plan for Bounty-Driven Target Destruction in strikeManager.js

This plan outlines the changes to `strikeManager.js` to implement a running total of target destruction based on bounty earned, as per the theory in `index.html` (Equations 41-42 and surrounding text).

**I. New Properties in `StrikeManager` Class:**

1.  **`totalTargetDestructionR`**:
    *   **Purpose**: Stores the global running total of target destruction (\(\Delta R_{\text{total}}\)) accumulated across all waves. This is the primary value for airstrike decisions.
    *   **Current `strikeManager.js`**: Replaces the role of `totalAccumulatedTargetDamageR`.
    *   **Initialization**: `0` in the `constructor`.

2.  **`K_current_wave`**:
    *   **Purpose**: Stores the wave-specific constant \(K_n = d_n T_n / B_{n\_total}\) for the currently active wave.
    *   **Current `strikeManager.js`**: New.
    *   **Initialization**: `0` or `null` in `constructor`; updated in `startWave`.

3.  **`Rn_at_wave_start`**:
    *   **Purpose**: Stores \(R_n(0)\), the player's total defender earning rate at the *start* of the currently active wave.
    *   **Current `strikeManager.js`**: Similar to `currentWaveStartTotalR` but will be used as the base for Eq. 42.
    *   **Initialization**: `0` in `constructor`; updated in `startWave`.

4.  **`Rn_at_last_bounty_checkpoint`**:
    *   **Purpose**: Stores the value of \(R_n(B_{\text{checkpoint}})\) - the remaining earning power after the last processed bounty batch. This is \(R_n(0)\) at wave start, then \(R_n(B^*)\), then \(R_n(2B^*)\), etc., for the current wave.
    *   **Current `strikeManager.js`**: New.
    *   **Initialization**: `0` in `constructor`; updated in `startWave` and `_updateTargetDestructionForBatch`.

5.  **`bountyCollectedSinceLastCheckpoint`**:
    *   **Purpose**: Tracks bounty collected (\(\delta B\)) since the last \(B^*\) checkpoint (which may be the start of the wave), within the current wave.
    *   **Current `strikeManager.js`**: New.
    *   **Initialization**: `0` in `constructor`; updated in `recordBountyEarned` and reset in `_updateTargetDestructionForBatch` / `startWave`.

6.  **`bountyUpdateThreshold_B_star`**:
    *   **Purpose**: Stores the bounty threshold \(B^*\) (a direct bounty amount) for triggering an update to `totalTargetDestructionR`.
    *   **Current `strikeManager.js`**: New.
    *   **Initialization**: `null`; loaded from `strike.json` (it is calculated as the `bombCost` divided by the `targetDamageUpdatePoints`).

7.  **`totalBountyForCurrentWave_Bn`**:
    *   **Purpose**: Stores \(B_{n\_total}\), the total bounty available in the current wave.
    *   **Current `strikeManager.js`**: New.
    *   **Initialization**: `0`; updated in `startWave`.

8.  **`projectedDurationCurrentWave_Tn`**:
    *   **Purpose**: Stores \(T_n\), the projected duration of the current wave.
    *   **Current `strikeManager.js`**: New. `_calculateDn` already fetches this; we'll store it for direct use in `K_n`.
    *   **Initialization**: `0`; updated in `startWave`.

**II. Modifications to Existing Methods & New Methods:**

1.  **`constructor()`**:
    *   Initialize all new properties listed above.
    *   `totalTargetDestructionR` replaces the old `totalAccumulatedTargetDamageR` initialization.

2.  **`loadConfig(path = 'assets/strike.json')`**:
    *   Modify to load `targetDamageUpdatePoints` and `bombCost` from the config.

3.  **`startWave(waveNumber, timestamp)`**:
    *   Existing properties `currentWaveNumber`, `currentWaveStartTime` are set.
    *   `currentDn` is calculated (existing).
    *   **New Logic**:
        *   `this.totalBountyForCurrentWave_Bn = this.game.waveManager.getWaveTotalBounty(waveNumber);`
        *   `this.projectedDurationCurrentWave_Tn = this.game.waveManager.getWaveDurationSeconds(waveNumber);`
        *   `this.Rn_at_wave_start = this.game.defenceManager.getCurrentTotalEarningRate();` (Replaces `this.currentWaveStartTotalR`'s direct usage for time-based calc).
        *   Calculate `this.K_current_wave`:
            *   `this.K_current_wave = this.currentDn * this.projectedDurationCurrentWave_Tn / this.totalBountyForCurrentWave_Bn;`
            *   (`this.totalBountyForCurrentWave_Bn > 0` is always true)
        *   `this.Rn_at_last_bounty_checkpoint = this.Rn_at_wave_start;`
        *   `this.bountyCollectedSinceLastCheckpoint = 0;`

4.  **New Method: `recordBountyEarned(bountyIncrement)`**:
    *   **Purpose**: Called by game logic whenever bounty is awarded.
    *   **Parameters**: `bountyIncrement` (\(\delta B\)).
    *   **Logic**:
        1.  If `!this.configLoaded || this.K_current_wave === null || this.Rn_at_wave_start <= 0`, return (cannot process).
        2.  `this.bountyCollectedSinceLastCheckpoint += bountyIncrement;`
        3.  If `this.bountyCollectedSinceLastCheckpoint >= this.bountyUpdateThreshold_B_star`:
            *   `this._updateTargetDestructionForBatch(this.bountyUpdateThreshold_B_star);`
            *   `this.bountyCollectedSinceLastCheckpoint -= this.bountyUpdateThreshold_B_star;`

5.  **New Private Method: `_updateTargetDestructionForBatch(bountyProcessedThisBatch)`**:
    *   **Purpose**: Calculates \(\delta R\) for a completed bounty batch (\(B^*\)) and updates `totalTargetDestructionR`.
    *   **Parameters**: `bountyProcessedThisBatch` (typically \(B^*\)).
    *   **Logic**:
        1.  If `this.K_current_wave <= 0` or `this.Rn_at_last_bounty_checkpoint <= 0`, return (no destruction to apply).
        2.  `Rn_before_segment = this.Rn_at_last_bounty_checkpoint;`
        3.  `exp_decay_factor = Math.exp(-this.K_current_wave * bountyProcessedThisBatch);` (Efficient 1-exp calculation)
        4.  `Rn_after_segment = Rn_before_segment * exp_decay_factor;`
        5.  `deltaR_increment = Rn_before_segment - Rn_after_segment;`
        6.  `this.totalTargetDestructionR += deltaR_increment;`
        7.  `this.Rn_at_last_bounty_checkpoint = Rn_after_segment;`

6.  **`finalizeWaveDamage(waveNumber, startTime, clearTime)`**:
    *   **Purpose**: Process any remaining bounty at the end of the wave.
    *   **Logic**:
        1.  If `this.bountyCollectedSinceLastCheckpoint > 0`:
            *   `this._updateTargetDestructionForBatch(this.bountyCollectedSinceLastCheckpoint);`
        2.  `this.bountyCollectedSinceLastCheckpoint = 0;` (Ensure it's reset for safety, though loop in `recordBountyEarned` and this call should manage it).
        3.  The old logic of calculating \(\Delta R\) based on *wave duration* is **removed**.

7.  **`getCumulativeTargetDamageR(timestamp)`**:
    *   The `timestamp` parameter is no longer used.
    *   **Logic**: Return `Math.max(0, this.totalTargetDestructionR);`.

**III. External Dependencies / Assumptions:**

*   **`WaveManager`**:
    *   Must provide `getWaveTotalBounty(waveNumber)` -> \(B_{n\_total}\).
    *   Must provide `getWaveDurationSeconds(waveNumber)` -> \(T_n\) (exact value, since waves are pre-planned by waveManager.js before their release).
*   **`DefenceManager`**:
    *   Must provide `getCurrentTotalEarningRate()` -> \(R_n(0)\).
*   **Bounty Awarding Code (e.g., in `Enemy.js` I think)**:
    *   Must call `this.game.strikeManager.recordBountyEarned(bountyValue)` upon enemy kill.

This plan focuses on the core bounty-to-\(\Delta R\) conversion. Airstrike triggering logic based on `totalTargetDestructionR` compared to actual damage dealt will be a separate layer.
