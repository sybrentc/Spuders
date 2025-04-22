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
 * Calculates the minimum distance from a point to any segment of a path.
 * @param {{x: number, y: number}} point - The point to check.
 * @param {Array<{x: number, y: number}>} pathData - The waypoints of the path (use original path).
 * @returns {number} - The minimum distance from the point to the path.
 */
function minDistanceToPath(point, pathData) {
    if (!pathData || pathData.length < 2) {
        return Infinity;
    }
    let minDistanceSq = Infinity;

    for (let i = 0; i < pathData.length - 1; i++) {
        const p1 = pathData[i];
        const p2 = pathData[i + 1];

        const l2 = distanceBetween(p1, p2) ** 2;
        if (l2 === 0) {
            // Segment is a point, calculate distance to that point
            minDistanceSq = Math.min(minDistanceSq, distanceBetween(point, p1) ** 2);
            continue;
        }

        // Parameter t represents the projection of the point onto the infinite line
        // containing the segment p1-p2. t = dot(point - p1, p2 - p1) / |p2 - p1|^2
        const dotProduct = ((point.x - p1.x) * (p2.x - p1.x) + (point.y - p1.y) * (p2.y - p1.y));
        let t = Math.max(0, Math.min(1, dotProduct / l2)); // Clamp t to [0, 1]

        // Find the closest point on the line segment
        const closestPoint = {
            x: p1.x + t * (p2.x - p1.x),
            y: p1.y + t * (p2.y - p1.y)
        };

        // Calculate squared distance from the point to this closest point on the segment
        const distSq = distanceBetween(point, closestPoint) ** 2;
        minDistanceSq = Math.min(minDistanceSq, distSq);
    }

    return Math.sqrt(minDistanceSq);
}


// Export functions for use in Node (precompute.js) and browser (game)
// CommonJS export for Node
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        distanceBetween,
        minDistanceToPath
    };
}
// ES6 export for browser
// We include both export types for compatibility with Node.js and browser environments.
export { distanceBetween, minDistanceToPath }; 