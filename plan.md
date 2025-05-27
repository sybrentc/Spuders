Some things I noticed during play testing:

Some ice puddles remain on the ground and do not disappear. Perhaps this is when a subzero is destroyed by airstrike and its puddles are now orphans?

The red tank spiders do not neatly y-sort behind my magic tower defender. Perhaps we need to check the anchor points of all enemies and defenders?

Airstrikes were set to an average damage per bomb of 18, derived from earlier test playing. However, today the first bomb did less damage than that so we had many airstrikes in short succession, while the game established a current average (which was initially below the seed value). This is fine, I am tracking the bomb stats using the console during gameplay. I seem to be surviving with just enough firepower to keep playing, so that's great. No changes needed here, I think. Although, we might introduce a delay so that not more than 3 strikes are carried out in rapid succession, with a cooldown after that. We could add the cool-down period to strike.json and set it at 30 seconds? This would ensure that in the scenario where the average bomb damage is temporarily below the seed value, we do not suddenly have one big reckoning where the entire bucket of accumulated damage is poured out onto the player in one go.

Something strange happened, where after a bit of playing it seemed that the subzero ice puddles were no longer effective at slowing enemies. Can you see anything in the code which might explain this. After I went game over and reloaded the game, the puddles remained, which also indicates something strange, since the effects layer should be cleaned up during reset, right?

Another strange thing happened where when I tabbed away to make some notes and then came back to the game I was now under attack by a blue tank spider which was being shot at by my defenders by its health did not seem to deplete. Was this perhaps a case of multiple tank spiders on top of each other? Or some glitch? This would need tracing in the code to see if anything comes up, I think.

I noticed that when firing on an enemy, they seem to stay in a single frame of their animation as they are cycling between their hit/non-hit spirtes. This is not correct, as the enemy animation frame should keep progressing while they cycle between hit/non-hit sprites. It currently looks as if the animation cycle is being frozen on each swap of hit/non-hit sprite.

The little fast spiders seem unaffected by the ice puddles. Perhaps since we are scaling the hidisk by the sprite size, their hitdisk is too small? But we want it to be scaled by sprite size so that the slow-down effect makes physical sense. But perhaps they are too fast, so that the slow down a little when on the puddle but move quickly off the puddle anyway, even at their reduced speed? Is the slow-down effect a percentage effect? Should we perhaps make it an absolute speed effect so that all enemies are slow equally when touching an ice puddle? I suppose that would make physical sense as well. Since, speed on dry land comes from pushing against the ground by friction, but if you come to a sheet of ice, you cannot keep running or you'll slip and fall, so you'd slow way down and move slow enough that you maintain your grip? Or would the enemies just see the puddle and do a little ice skate across? But then they would not be slowed down by the puddles, which is the whole point.

Another thing with the subzero is that it shoots the ice puddles at the exact location an enemy is at, rather than somewhat in front of the enemy, i.e., where the enemy is going. It would be cool if the subzero can somehow shoot not at the exact enemy location but a little ahead of it. The subzero can use the fact that enemies always follow the path, so the subzero can query the path length traversed by the enemy it is targeting (each enemy has its associated path distance travelled to track average death point, perhaps held by the enemymanager), and then use the path lookup table to get coords which are some distance ahead of that path length?

Regarding strikes coming thick and fast once the threshold is reached. Another idea, apart from the cool-down period, could be to use 'test bombings' where the strikemanager does a simulation run to test the impact of a strike before release. This is more advanced than a simple cool-down period. The strike manager could take a cloned version of the defenders right now, then carry out a virtual strike on them and get the damage dealt. It can repeat this experiement a few times to get an average bomb damage if a single real striker were to be dispatched right now. This is a way to get an accurate idea of the average bomb damage. This would in fact be the best way to do it, since with virtual strikes on cloned defenders, you can do multiple runs at set intervals during the game, which means you actually no longer need to seed the average bomb damage and you no longer need to have a rolling average that fluctuates due to impact coord uncertainty. It is then merely a matter of computational overhead. i.e., doing a simulation run does cost a few distance calculations etc. The average bomb calculation could be done in full at wave end, when the player would not notice any possible lag, or if there is lag, it would not be immediately game critical, since no active enemies are in play at such time.

The small fast spiders seem unaffected by the ice puddles, but the tank fast spiders also seem unaffected. Perhaps this is due to the subzero targeting the current coords of the enemy, such that fast enemies will be moving so fast that they would have travelled far enough in the next update cycle that the puddle has no effect on them anymore, as they are by then already out of its effective reach.

I've now played the game twice on hard mode with airstrikes. According to the theory, this should have kept the game at knife's edge in terms of my fire power being matched exactly against the enemies oncoming attack strength. However, I have in both cases not managed to get past wave 15, I believe. This used to be the point where we would enter runaway win conditions, i.e., around wave 15. I suppose the airstrikes may be doing too much damage. However, we are keeping track of damage dealt and target damage, and at the time of me being game over, the two are in balance. Potentially then, the problem is not the total damage dealt via airstrikes, but that it sometimes gets dealt in huge clumps at a time. You can imagine that if you are playing and no airstrikes happen, that you can be strategic about defender placement. If, however, there is a huge cluster of airstrikes for the game to catch up on its outstanding target damage, then it may wipe out much or all of your defensive capabilities mid-wave. This then forces you to build defenses under duress in sub-optimal locations and thereby you are not able to maximise the strategic placement of defenders. The latter aspect however is critical for being able to remain in play at the knife's edge difficulty level. This scenario is discussed in the theory document regarding wear:
"The addition of wear forces a player to keep investing both to grow their defenses but also to counteract the continuous defender turnover due to wear. If the player fails to keep up, then their defences weaken sufficiently for enemies to push through. This in turn forces a player into reactive play, where they are forced to act under duress, just to protect the base. The result is a sub-optimal investment in, and placement of, defenders. The break-even condition, however, means the player can only win with an optimally managed defense. Hence, a single slip can be fatal."
This scenario was addressed then by introducing difficulty levels to the game, where a player could choose to play at knife's edge (with no room for mistakes), or could choose to give themselves some leeway to be able to withstand the occasional slip up.
Now, airstrikes present the same scenario. Although this time the scenario is triggered not by a player taking their eyes off the ball for a moment, but by the strikemanager dealing damage in big lumps, rather than spread evenly over time.

The discretization of damage through airstrikes presents a fundamental challenge to our break-even game balance theory. While our differential equation approach gives us dn as an instantaneous rate limit for damage that maintains break-even conditions, the practical implementation of discrete damage events (big bombs) creates a "sawtooth" pattern in the player's earning rate. When a bomb hits, the instantaneous drop in earning rate exceeds the rate limit dn, pushing the player below break-even conditions until they can recover. This creates periods of vulnerability that force reactive, sub-optimal play - exactly the scenario we encountered with wear. To address this while maintaining engaging gameplay with big, infrequent bombs, we need to calculate the theoretical economic buffer required for a given degree of damage discretization. This buffer would ensure the player always remains on the right side of break-even, even during recovery from discrete damage events. We can tune this buffer using the difficulty scalar a in equation 39 (α = aα₀), where a ≤ 1. By calculating the maximum instantaneous drop in earning rate from a discrete damage event, the recovery time needed, and the extra earning power required to maintain break-even during recovery, we can determine an appropriate value for a that provides this buffer. This would give us a theoretical basis for setting difficulty levels that account for the discretization of damage while maintaining engaging gameplay with big, infrequent bombs.

A problem now that we're using the general eqt. 30 for dn calculation is that it depends explicitly on alpha, and we are now also using alpha=a*alpha0 with a the level difficulty scaling factor. So, how does that work on 'normal' and'easy' modes?

---
## Plan: Threat Heatmap Visualization for StrikeManager

**I. Rationale & Goal:**

*   **Problem:** The `StrikeManager` needs a nuanced understanding of current enemy threat distribution to make informed decisions (e.g., about airstrike timing, though airstrikes are currently aimed at player defenses by the enemy). A simple binary check (like enemies in a critical zone) may not capture the full picture.
*   **Goal:**
    1.  Develop a "Threat Heatmap" that visually represents the average bounty density along each segment of the enemy path.
    2.  Implement this as a debug overlay, similar to the existing z-buffer heatmap, to allow for observation and tuning.
    3.  This heatmap will provide a granular, dynamic view of threat concentration, which can later be used to inform strike logic or other game mechanics.
*   **Method:** Calculate a rolling average of total enemy bounty present on each path segment, normalized by the segment's length, over a configurable time window.

**II. Configuration & Control:**

1.  **New Flag in `Game.js`:**
    *   Add a new boolean property to `Game.js` to control the visibility of the threat heatmap.
    *   Property name: `showThreatHeatmap` (distinct from `showStrikeManagerHeatmap` which is for the z-buffer).
    *   Default value: `false`.
    *   This flag will be toggled by the player/developer via debug controls (e.g., a key press handled by `Controller.js` which then calls a method in `Game.js` or directly sets this flag if exposed).

**III. `StrikeManager.js` Modifications:**

1.  **State Initialization (`initStaticState` or constructor):**
    *   `this.threatHeatmapGraphics = null;` (will hold the `PIXI.Graphics` object for drawing).
    *   `this.pathSegmentsData = [];` (will store `{ segmentIndex, startWaypoint, endWaypoint, length, bountyHistory: [], currentAverageBountyDensity: 0 }` for each segment).
    *   `this.heatmapRollingWindowFrames = 120;` (e.g., for a 2-second average at 60 FPS, configurable).

2.  **Initialization/Setup (e.g., in `onGameInitialized` or a new setup method called after game components are ready):**
    *   Get path data from `this.game.getExtendedPathData()`.
    *   Get segment lengths from `this.game.getSegmentLengths()`.
    *   Populate `this.pathSegmentsData`:
        *   Iterate from `i = 0` to `pathData.length - 2`.
        *   Segment `i` connects `pathData[i]` and `pathData[i+1]`.
        *   Store `segmentIndex: i`, `startWaypoint: pathData[i]`, `endWaypoint: pathData[i+1]`, `length: segmentLengths[i]`.
        *   Initialize `bountyHistory` as an empty array for each segment.
    *   Create `this.threatHeatmapGraphics = new PIXI.Graphics();`
    *   Add it to the game stage: `this.game.app.stage.addChild(this.threatHeatmapGraphics);`
    *   Set initial visibility based on `this.game.showThreatHeatmap`.

3.  **Game Update Logic (`update` method):**
    *   **Toggle Visibility:**
        *   `this.threatHeatmapGraphics.visible = this.game.showThreatHeatmap;`
        *   If not visible, skip calculations and drawing for performance.

    *   **Calculate Current Bounty per Segment:**
        *   Create a temporary array `currentFrameBountyPerSegment` initialized to zeros, with size equal to the number of segments.
        *   Iterate through `activeEnemies = this.game.enemyManager.getActiveEnemies();`.
        *   For each `enemy`:
            *   Determine its current segment index: `segmentIndex = enemy.targetWaypointIndex - 1`.
            *   Validate `segmentIndex` (must be `>= 0` and `< numberOfSegments`).
            *   If valid, add `enemy.bounty` to `currentFrameBountyPerSegment[segmentIndex]`.

    *   **Update Rolling Average & Density for Each Segment:**
        *   Iterate through `this.pathSegmentsData`. For each `segmentEntry`:
            *   Access its `bountyHistory`.
            *   Add `currentFrameBountyPerSegment[segmentEntry.segmentIndex]` to the end of `bountyHistory`.
            *   If `bountyHistory.length > this.heatmapRollingWindowFrames`, remove the oldest element (from the start of the array).
            *   Calculate `sumOfBountyInWindow = bountyHistory.reduce((acc, val) => acc + val, 0);`.
            *   Calculate `averageBountyInWindow = sumOfBountyInWindow / bountyHistory.length;` (or 0 if length is 0).
            *   Normalize by segment length:
                *   `segmentEntry.currentAverageBountyDensity = (segmentEntry.length > 0) ? averageBountyInWindow / segmentEntry.length : 0;`

    *   **Visualize Heatmap (if `this.game.showThreatHeatmap` is true):**
        *   `this.threatHeatmapGraphics.clear();`
        *   Determine a maximum expected bounty density for color normalization (this might need tuning or dynamic calculation, e.g., `maxDensityObserved`). For now, use a placeholder `maxExpectedDensity = 5;` (bounty units per pixel).
        *   Iterate through `this.pathSegmentsData`. For each `segmentEntry`:
            *   Let `density = segmentEntry.currentAverageBountyDensity;`
            *   Normalize `densityRatio = Math.min(density / maxExpectedDensity, 1.0);`
            *   Determine color:
                *   If `densityRatio < 0.01`, skip drawing or use a very faint color.
                *   Interpolate color from green (low threat) to yellow (medium) to red (high) based on `densityRatio`.
                    *   E.g., `R = 255 * densityRatio; G = 255 * (1 - densityRatio); B = 0;` (simple example, can be refined).
                    *   Convert RGB to a hex color for Pixi.
            *   Set line style for `this.threatHeatmapGraphics`: `this.threatHeatmapGraphics.lineStyle(5, colorHex, 1);` (thickness 5, chosen color, alpha 1).
            *   Draw the segment:
                *   `this.threatHeatmapGraphics.moveTo(segmentEntry.startWaypoint.x, segmentEntry.startWaypoint.y);`
                *   `this.threatHeatmapGraphics.lineTo(segmentEntry.endWaypoint.x, segmentEntry.endWaypoint.y);`

**IV. `Game.js` Modifications:**

1.  Add the new flag: `this.showThreatHeatmap = false;` in the constructor.
2.  (Optional but recommended) Add a method like `toggleThreatHeatmap()` that the `Controller.js` can call to flip this flag.

**V. `Enemy.js` Data Access:**

*   Ensure `enemy.targetWaypointIndex` is reliable for determining the current segment.
*   Ensure `enemy.bounty` contains the correct, pre-calculated bounty value.

**VI. `EnemyManager.js` Data Access:**

*   `getActiveEnemies()` will provide the list of enemies to process.

**VII. Testing & Tuning:**

1.  Verify the `showThreatHeatmap` flag correctly toggles the heatmap's visibility.
2.  Observe the heatmap colors and responsiveness during gameplay with various enemy waves.
3.  Tune `heatmapRollingWindowFrames`:
    *   Too short: heatmap might be too jittery.
    *   Too long: heatmap might not be responsive enough to rapid changes.
4.  Tune `maxExpectedDensity` and the color interpolation logic to ensure the heatmap provides clear visual differentiation of threat levels.
5.  Confirm that normalization by segment length correctly reflects threat *density* (i.e., a short segment with many enemies should appear "hotter" than a long segment with the same number of enemies spread out).
6.  Check for performance impact, especially with many enemies and segments.