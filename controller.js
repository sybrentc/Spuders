import Game from './models/game.js';

// State variables for defence placement
let selectedDefenceType = null;
let isPlacingDefence = false;
let placementPreviewPos = null; // {x, y} in canvas coordinates

// Create and start game
window.addEventListener('DOMContentLoaded', async () => {
    const game = new Game();
    
    // Wait for game to be fully initialized (including PriceManager)
    await game.ready();

    // Get menu and canvas elements
    const defenceMenu = document.getElementById('defenceMenu');
    // Assuming foreground layer canvas exists and is accessible
    const gameCanvas = game.layers.foreground?.canvas; 
    // Get UI display elements
    const fundsDisplay = document.getElementById('fundsDisplay');
    const waveInfoDisplay = document.getElementById('waveInfoDisplay');

    if (!gameCanvas) {
        console.error("Foreground canvas not found!");
        return; // Stop if canvas is missing
    }

    // Function to create/update menu buttons (NOW SORTS BY PRICE)
    function updateDefenceMenu(definitions) {
        if (!defenceMenu || !game.priceManager) return;

        defenceMenu.innerHTML = ''; // Clear existing content
        const calculatedCosts = game.priceManager.calculateAllCosts(); // Get costs once

        // --- Sort defences by calculated cost --- 
        const sortedDefences = Object.entries(definitions)
            .filter(([id, def]) => calculatedCosts[id] !== undefined && calculatedCosts[id] !== Infinity) // Filter out invalid costs before sorting
            .sort(([idA], [idB]) => calculatedCosts[idA] - calculatedCosts[idB]);
        // --------------------------------------

        // --- Create buttons from sorted list --- 
        for (const [id, def] of sortedDefences) {
            // Cost is already calculated and validated during sorting
            const cost = calculatedCosts[id]; 

            // Check only for name, as cost validity checked in filter
            if (def && def.name) { 
                const button = document.createElement('button');
                button.classList.add('defence-button');
                button.dataset.defenceId = id;

                button.addEventListener('click', () => {
                    handleDefenceSelection(id, button);
                });

                const nameSpan = document.createElement('span');
                nameSpan.classList.add('name');
                nameSpan.textContent = def.name;

                const priceSpan = document.createElement('span');
                priceSpan.classList.add('price');
                priceSpan.textContent = `${cost}G`; // Use calculated cost

                button.appendChild(nameSpan);
                button.appendChild(priceSpan);
                
                defenceMenu.appendChild(button);
            } 
            // Removed else block - warnings handled by filter implicitly
        }
        // --- End button creation ---
    }

    // Function to handle defence selection
    function handleDefenceSelection(defenceId, clickedButton) {
        if (selectedDefenceType === defenceId) {
            // Deselect if clicking the same button again
            selectedDefenceType = null;
            isPlacingDefence = false;
            placementPreviewPos = null;
            clickedButton.classList.remove('selected');
        } else {
            // Select new defence type
            selectedDefenceType = defenceId;
            isPlacingDefence = true;
            
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
    });

    // Initial population and setup listener for updates
    if (game.defenceManager && game.defenceManager.isLoaded) {
        updateDefenceMenu(game.defenceManager.getDefinitions());
        game.defenceManager.addEventListener('definitionsUpdated', () => {
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

    // --- UI Update Function (Handles Text and Button States) ---
    function updateUI() {
        if (!game.base || !game.waveManager || !fundsDisplay || !waveInfoDisplay || !game.defenceManager || !defenceMenu || !game.priceManager) return;

        // --- Update Text Displays ---
        fundsDisplay.textContent = `${game.base.currentFunds}G`; 

        let waveText = '';
        if (game.waveManager.isFinished) {
            waveText = "All Waves Complete!";
        } else if (game.waveManager.timeUntilNextWave > 0) {
            const seconds = Math.ceil(game.waveManager.timeUntilNextWave / 1000);
            waveText = `Next wave in ${seconds}s`;
        } else if (game.waveManager.currentWaveNumber > 0) {
            waveText = `Wave ${game.waveManager.currentWaveNumber}`;
        } else {
            waveText = "Get Ready!";
        }
        waveInfoDisplay.textContent = waveText;

        // --- Update Button Affordability AND Price Text ---
        const currentFunds = game.base.currentFunds;
        const calculatedCosts = game.priceManager.calculateAllCosts(); // Get current costs
        const buttons = defenceMenu.querySelectorAll('.defence-button');

        buttons.forEach(button => {
            const defenceId = button.dataset.defenceId;
            const cost = calculatedCosts[defenceId]; 

            // --- Update Price Text --- 
            const priceSpan = button.querySelector('.price'); // Find the price span inside the button
            if (priceSpan && cost !== undefined && cost !== Infinity) {
                priceSpan.textContent = `${cost}G`; // Update the displayed text
            } else if (priceSpan) {
                priceSpan.textContent = `---G`; // Indicate invalid/missing cost
            }
            // ------------------------

            if (cost === undefined || cost === Infinity) { 
                button.classList.add('disabled'); 
                return;
            }

            // --- Update Affordability --- 
            if (currentFunds >= cost) {
                button.classList.remove('disabled');
            } else {
                button.classList.add('disabled');
                if (selectedDefenceType === defenceId) {
                    handleDefenceSelection(defenceId, button); 
                }
            }
            // --------------------------
        });
    }

    // --- Register Main UI Update with Game Loop ---
    if (game.addUpdateListener) { 
        game.addUpdateListener(updateUI); // Register the combined function
    } else {
        console.error("Controller: Game object missing addUpdateListener method. UI will not update dynamically.");
    }

    // Initial UI update after menu population
    updateUI(); 
});
