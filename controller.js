import Game from './models/game.js';

// Create and start game
window.addEventListener('DOMContentLoaded', () => {
    const game = new Game();
    
    function gameLoop() {
        game.render();
        requestAnimationFrame(gameLoop);
    }
    
    requestAnimationFrame(gameLoop);
});
