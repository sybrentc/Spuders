import Game from './models/game.js';

// Create and start game
window.addEventListener('DOMContentLoaded', async () => {
    const game = new Game();
    
    // Wait for game to be fully initialized
    await game.ready();
    
    // At this point, the game is already running itself
    // Controller will be used for future UI functionality
});
