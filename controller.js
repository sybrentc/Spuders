import Game from './models/game.js';

// State variables for defence placement
let selectedDefenceType = null;
let isPlacingDefence = false;
let placementPreviewPos = null; // {x, y} in canvas coordinates

// Create and start game
window.addEventListener('DOMContentLoaded', async () => {
    const game = new Game();
    
    // Wait for game to be fully initialized
    await game.ready();
    
    console.log('Game is ready, populating defence menu...');

    // Get menu and canvas elements
    const defenceMenu = document.getElementById('defenceMenu');
    // Assuming foreground layer canvas exists and is accessible
    const gameCanvas = game.layers.foreground?.canvas; 

    if (!gameCanvas) {
        console.error("Foreground canvas not found!");
        return; // Stop if canvas is missing
    }

    // Function to create/update menu buttons
    function updateDefenceMenu(definitions) {
        if (!defenceMenu) return;

        defenceMenu.innerHTML = ''; // Clear existing content

        for (const id in definitions) {
            const def = definitions[id];
            if (def && def.name && def.stats && def.stats.cost !== undefined) {
                const button = document.createElement('button');
                button.classList.add('defence-button');
                button.dataset.defenceId = id;

                // Add click listener to each button
                button.addEventListener('click', () => {
                    handleDefenceSelection(id, button);
                });

                // Create span for name
                const nameSpan = document.createElement('span');
                nameSpan.classList.add('name');
                nameSpan.textContent = def.name;

                // Create span for price
                const priceSpan = document.createElement('span');
                priceSpan.classList.add('price');
                priceSpan.textContent = `$${def.stats.cost}`;

                // Append spans to button
                button.appendChild(nameSpan);
                button.appendChild(priceSpan);
                
                defenceMenu.appendChild(button);
            } else {
                console.warn('Skipping invalid defence definition:', def);
            }
        }
        console.log('Defence menu updated/populated.');
    }

    // Function to handle defence selection
    function handleDefenceSelection(defenceId, clickedButton) {
        if (selectedDefenceType === defenceId) {
            // Deselect if clicking the same button again
            selectedDefenceType = null;
            isPlacingDefence = false;
            placementPreviewPos = null;
            clickedButton.classList.remove('selected');
            console.log('Defence selection cleared.');
        } else {
            // Select new defence type
            selectedDefenceType = defenceId;
            isPlacingDefence = true;
            console.log(`Selected defence: ${selectedDefenceType}`);
            
            // Update button styling
            document.querySelectorAll('.defence-button.selected').forEach(btn => btn.classList.remove('selected'));
            clickedButton.classList.add('selected');
        }
        // Update game state for rendering preview
        game.setPlacementPreview(placementPreviewPos); // Pass null if deselected
    }

    // Canvas Mouse Move Listener
    gameCanvas.addEventListener('mousemove', (event) => {
        if (!isPlacingDefence) return;

        const rect = gameCanvas.getBoundingClientRect();
        const scaleX = gameCanvas.width / rect.width;
        const scaleY = gameCanvas.height / rect.height;
        
        placementPreviewPos = {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY
        };
        // Update game state for rendering preview
        game.setPlacementPreview(placementPreviewPos);
    });

    // Canvas Click Listener
    gameCanvas.addEventListener('click', (event) => {
        if (!isPlacingDefence || !selectedDefenceType || !placementPreviewPos) return;

        console.log(`Placing ${selectedDefenceType} at`, placementPreviewPos);
        
        // Tell DefenceManager to place the defence
        if (game.defenceManager) {
            game.defenceManager.placeDefence(selectedDefenceType, placementPreviewPos);
            // TODO: Check return value for success (e.g., enough money)
        }

        // Clear selection state
        const selectedButton = document.querySelector(`.defence-button[data-defence-id="${selectedDefenceType}"]`);
        if (selectedButton) selectedButton.classList.remove('selected');
        
        selectedDefenceType = null;
        isPlacingDefence = false;
        placementPreviewPos = null;
        // Update game state to remove preview
        game.setPlacementPreview(null);
        console.log('Placement complete, selection cleared.');
    });

    // Initial population and setup listener for updates
    if (game.defenceManager && game.defenceManager.isLoaded) {
        updateDefenceMenu(game.defenceManager.getDefinitions());
        game.defenceManager.addEventListener('definitionsUpdated', () => {
            console.log('Controller: Detected definitionsUpdated event, updating menu.');
            // Preserve selection if possible when menu updates
            const currentSelectedId = selectedDefenceType;
            updateDefenceMenu(game.defenceManager.getDefinitions());
            if (currentSelectedId) {
                const selectedButton = document.querySelector(`.defence-button[data-defence-id="${currentSelectedId}"]`);
                if (selectedButton) selectedButton.classList.add('selected');
            }
        });
    } else {
        console.error('Could not initially populate defence menu or set up listener.');
    }

    // At this point, the game is already running itself
    // Controller will be used for future UI functionality
});
