/**
 * Draws a standard health bar above a game object.
 * 
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
 * @param {number} currentHp - The current health of the object.
 * @param {number} maxHp - The maximum health of the object.
 * @param {number} drawX - The calculated X coordinate where the object is drawn.
 * @param {number} drawY - The calculated Y coordinate where the object is drawn.
 * @param {number} drawWidth - The calculated width of the object.
 * @param {number} drawHeight - The calculated height of the object (used for positioning).
 */
export function drawHealthBar(ctx, currentHp, maxHp, drawX, drawY, drawWidth, drawHeight) {
    // Only draw if health is not full and maxHp is greater than 0
    if (currentHp >= maxHp || maxHp <= 0) {
        return; 
    }

    // Ensure currentHp doesn't go below 0 for ratio calculation
    const saneCurrentHp = Math.max(0, currentHp); 

    const barHeight = 8; // Height of the health bar
    const barWidth = 40; // Use a fixed width (e.g., 40px) instead of relative width
    const barX = drawX + (drawWidth - barWidth) / 2; // Center the fixed-width bar horizontally
    const barY = drawY - barHeight - 5; // Position above the object, with 5px padding

    const hpRatio = saneCurrentHp / maxHp;

    // Save context state before changing styles
    ctx.save();

    // Draw background (red)
    ctx.fillStyle = '#550000'; // Dark red background
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // Draw foreground (green)
    ctx.fillStyle = '#00CC00'; // Bright green foreground
    ctx.fillRect(barX, barY, barWidth * hpRatio, barHeight);

    // Optional: Add a thin border
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);

    // Restore context state
    ctx.restore();
}

// Add other rendering utility functions here in the future... 