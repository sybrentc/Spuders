/**
 * Draws a health bar above an entity.
 * @param {CanvasRenderingContext2D} ctx - The canvas rendering context.
 * @param {number} hp - Current health points.
 * @param {number} maxHp - Maximum health points.
 * @param {number} x - The X coordinate of the entity (top-left for drawing).
 * @param {number} y - The Y coordinate of the entity (top-left for drawing).
 * @param {number} width - The width of the entity being drawn.
 * @param {number} height - The height of the entity being drawn.
 * @param {object} healthBarConfig - Configuration object { height, padding, healthyColor, damagedColor }.
 * @param {object} healthBarConfig - Configuration object { height, padding, healthyColor, damagedColor, width, borderColor }.
 */
export function drawHealthBar(ctx, hp, maxHp, x, y, width, height, healthBarConfig = {}) {
    // --- Visibility Check --- 
    if (hp >= maxHp || maxHp <= 0) {
        return; // Don't draw if full health or invalid maxHp
    }
    // Ensure HP is not negative for calculation
    const saneHp = Math.max(0, hp);
    // ----------------------

    // Use defaults if config is missing or incomplete
    const barHeight = healthBarConfig.height ?? 5;
    const padding = healthBarConfig.padding ?? 2;
    // const healthyColor = healthBarConfig.healthyColor || '#00FF00'; // OLD Bright Green
    // const damagedColor = healthBarConfig.damagedColor || '#FF0000'; // OLD Bright Red
    const healthyColor = healthBarConfig.healthyColor || '#00CC00'; // Original Green
    const damagedColor = healthBarConfig.damagedColor || '#550000'; // Original Dark Red
    const barWidth = healthBarConfig.width ?? 40; // Fixed width from config, default 40
    const borderColor = healthBarConfig.borderColor || '#000000'; // Border color from config, default black
    
    // const barWidth = width; // OLD - Scaled width
    // const barX = x; // OLD - Aligned left
    const barX = x + (width - barWidth) / 2; // Center the fixed-width bar
    // const barY = y - barHeight - 2; // Position above the entity sprite with padding - OLD
    const barY = y - barHeight - padding; // Use padding from config

    // const healthPercentage = hp / maxHp; // OLD - used potentially negative hp
    const healthPercentage = saneHp / maxHp;

    ctx.save();

    // Draw background (damaged part)
    // ctx.fillStyle = '#FF0000'; // OLD
    ctx.fillStyle = damagedColor;
    ctx.fillRect(barX, barY, barWidth, barHeight);

    // Draw foreground (healthy part)
    // ctx.fillStyle = '#00FF00'; // OLD
    ctx.fillStyle = healthyColor;
    ctx.fillRect(barX, barY, barWidth * healthPercentage, barHeight);

    // --- Draw Border --- 
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barWidth, barHeight);
    // -------------------

    ctx.restore();
}

// Add other rendering utility functions here in the future... 