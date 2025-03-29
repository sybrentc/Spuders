// Get the canvas element and its context
const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Create a new image object for the map
const mapImage = new Image();
mapImage.src = 'map.webp';

// Create sprite image
const spiderSprite = new Image();
spiderSprite.src = 'spider.png';

// Add image load handlers
spiderSprite.onload = () => {
    console.log('Spider sprite loaded successfully');
    console.log('Spider sprite dimensions:', spiderSprite.width, 'x', spiderSprite.height);
};

spiderSprite.onerror = (error) => {
    console.error('Error loading spider sprite:', error);
};

// Array to store waypoints
let waypoints = [];
let interpolatedWaypoints = [];

// Sprite properties (updated for actual sprite sheet)
const SPRITE_WIDTH = 192;  // 768/4
const SPRITE_HEIGHT = 192; // 768/4
const SPRITE_SCALE = 0.5;  // Scale down the sprite to make it more manageable
const FRAMES_PER_ROW = 4;
const TOTAL_FRAMES = 16;
let currentFrame = 0;
let lastFrameTime = 0;
const FRAME_DURATION = 400; // milliseconds per frame

// Enemy movement properties
let currentPathIndex = 0;
const MOVEMENT_SPEED = 0.02; // pixels per frame
let lastMoveTime = 0;
const MOVE_INTERVAL = 16; // approximately 60 FPS

// Function to calculate distance between two points
function distance(p1, p2) {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
}

// Function to interpolate between two points
function interpolate(p1, p2, t) {
    return {
        x: p1.x + (p2.x - p1.x) * t,
        y: p1.y + (p2.y - p1.y) * t
    };
}

// Function to get current position along the path
function getCurrentPosition() {
    const index = Math.floor(currentPathIndex);
    const nextIndex = Math.min(index + 1, interpolatedWaypoints.length - 1);
    const t = currentPathIndex - index;
    
    return interpolate(
        interpolatedWaypoints[index],
        interpolatedWaypoints[nextIndex],
        t
    );
}

// Function to generate interpolated waypoints
function generateInterpolatedWaypoints(spacing) {
    interpolatedWaypoints = [];
    
    for (let i = 0; i < waypoints.length - 1; i++) {
        const start = waypoints[i];
        const end = waypoints[i + 1];
        const dist = distance(start, end);
        const steps = Math.ceil(dist / spacing);
        
        for (let j = 0; j <= steps; j++) {
            const t = j / steps;
            interpolatedWaypoints.push(interpolate(start, end, t));
        }
    }
}

// Function to load waypoints from CSV
async function loadWaypoints() {
    try {
        const response = await fetch('path.csv');
        const text = await response.text();
        waypoints = text.split('\n')
            .filter(line => line.trim()) // Remove empty lines
            .map(line => {
                const [x, y] = line.split(',').map(coord => parseFloat(coord.trim()));
                return { x, y };
            });
    } catch (error) {
        console.error('Error loading waypoints:', error);
    }
}

// Function to draw waypoints
function drawWaypoints() {
    // Draw interpolated waypoints
    ctx.fillStyle = 'blue';
    interpolatedWaypoints.forEach(point => {
        ctx.beginPath();
        ctx.arc(point.x, point.y, 2, 0, Math.PI * 2);
        ctx.fill();
    });
}

// Function to update enemy position
function updateEnemyPosition(timestamp) {
    if (timestamp - lastMoveTime >= MOVE_INTERVAL) {
        if (currentPathIndex < interpolatedWaypoints.length - 1) {
            currentPathIndex += MOVEMENT_SPEED;
            if (currentPathIndex >= interpolatedWaypoints.length) {
                currentPathIndex = interpolatedWaypoints.length - 1;
            }
        }
        lastMoveTime = timestamp;
    }
}

// Function to update sprite animation
function updateSpriteAnimation(timestamp) {
    if (timestamp - lastFrameTime >= FRAME_DURATION) {
        currentFrame = (currentFrame + 1) % TOTAL_FRAMES;
        lastFrameTime = timestamp;
    }
}

// Function to draw the spider sprite
function drawSpider() {
    const currentPoint = getCurrentPosition();
    if (!currentPoint) {
        console.log('No current point available');
        return;
    }

    // Calculate the angle to the next point for rotation
    const nextIndex = Math.min(Math.floor(currentPathIndex) + 1, interpolatedWaypoints.length - 1);
    const nextPoint = interpolatedWaypoints[nextIndex];
    const angle = Math.atan2(nextPoint.y - currentPoint.y, nextPoint.x - currentPoint.x);

    // Calculate the current frame position in the sprite sheet
    const frameX = (currentFrame % FRAMES_PER_ROW) * SPRITE_WIDTH;
    const frameY = Math.floor(currentFrame / FRAMES_PER_ROW) * SPRITE_HEIGHT;

    // Save the current context state
    ctx.save();
    
    // Move to the spider's position
    ctx.translate(currentPoint.x, currentPoint.y);
    
    // Draw the current frame of the sprite, scaled down
    ctx.drawImage(
        spiderSprite,
        frameX, frameY, SPRITE_WIDTH, SPRITE_HEIGHT,
        -SPRITE_WIDTH*SPRITE_SCALE/2, -SPRITE_HEIGHT*SPRITE_SCALE/2, 
        SPRITE_WIDTH*SPRITE_SCALE, SPRITE_HEIGHT*SPRITE_SCALE
    );
    
    // Restore the context state
    ctx.restore();
}

// Game loop
function gameLoop(timestamp) {
    // Clear the canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    // Draw the map
    ctx.drawImage(mapImage, 0, 0);
    
    // Update and draw game elements
    updateSpriteAnimation(timestamp);
    updateEnemyPosition(timestamp);
    drawSpider();
    
    // Request the next frame
    requestAnimationFrame(gameLoop);
}

// Set up the canvas size to match the map image
mapImage.onload = async () => {
    canvas.width = mapImage.width;
    canvas.height = mapImage.height;
    
    // Load waypoints
    await loadWaypoints();
    
    // Generate interpolated waypoints
    generateInterpolatedWaypoints(20);
    
    // Start the game loop
    requestAnimationFrame(gameLoop);
};

// Function to draw sprites (to be used later)
function drawSprite(sprite, x, y) {
    ctx.drawImage(sprite, x, y);
}