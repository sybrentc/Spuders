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
    async function updateDefenceMenu(definitions) {
        // console.log('DEBUG: Entering updateDefenceMenu'); // Optional log
        // --- Detailed Guard Clause Check ---
        if (!game.priceManager) {
            console.error("updateDefenceMenu: PriceManager not available!");
            defenceMenu.innerHTML = '<p style="color:red;">Error: Prices unavailable.</p>';
            return;
        }

        defenceMenu.innerHTML = ''; // Clear existing content
        // Use cached costs instead of recalculating
        const calculatedCosts = game.priceManager.getStoredCosts();

        // --- Sort defences by cached cost --- 
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
    gameCanvas.addEventListener('click', async (event) => {
        // Check placement state AND validity from the game model
        const currentPreview = game.getPlacementPreview(); 
        if (!isPlacingDefence || !selectedDefenceType || !currentPreview?.isValid) {
           // If not placing, no type selected, or preview doesn't exist or is invalid, do nothing
           // console.log("Placement attempt ignored: Invalid state or location."); // Optional debug log
           return;
        }

        // If we reach here, placement is attempted on a valid spot
        
        // Tell DefenceManager to place the defence (it now trusts the position is valid)
        if (game.defenceManager) {
            // Pass the known valid position from the preview object
            await game.defenceManager.placeDefence(selectedDefenceType, { x: currentPreview.x, y: currentPreview.y });
        }

        // Clear selection state (only if placement was attempted, successful or not)
        const selectedButton = document.querySelector(`.defence-button[data-defence-id="${selectedDefenceType}"]`);
        if (selectedButton) selectedButton.classList.remove('selected');
        
        selectedDefenceType = null;
        isPlacingDefence = false;
        placementPreviewPos = null; // Clear the controller's cached position
        // Update game state to remove preview
        game.setPlacementPreview(null);
    });

    // Initial population and setup listener for updates
    if (game.defenceManager && game.defenceManager.isLoaded && game.priceManager) { // Check priceManager here too
        updateDefenceMenu(game.defenceManager.getDefinitions()); // Update uses cached costs now
        // Listen for definition updates from DefenceManager (keeps current logic)
        game.defenceManager.addEventListener('definitionsUpdated', async () => {
            const currentSelectedId = selectedDefenceType;
            await updateDefenceMenu(game.defenceManager.getDefinitions());
            if (currentSelectedId) {
                const selectedButton = document.querySelector(`.defence-button[data-defence-id="${currentSelectedId}"]`);
                if (selectedButton) selectedButton.classList.add('selected');
            }
        });
        // ADD listener for cost updates from PriceManager
        game.priceManager.addEventListener('costsUpdated', () => {
            // console.log("Controller: Received costsUpdated event. Running updateUI."); // Optional debug
            updateUI(); // Trigger UI update when costs change
        });
        // ADD listener for funds updates from Base
        if (game.base) { // Ensure base exists before adding listener
            game.base.addEventListener('fundsUpdated', () => {
                // console.log("Controller: Received fundsUpdated event. Running updateUI."); // Optional debug
                updateUI(); // Trigger UI update when funds change
            });
        } else {
             console.error("Controller: Cannot add fundsUpdated listener, game.base is not available.");
        }
    } else {
        console.error('Could not initially populate defence menu or set up listener (DefenceManager or PriceManager missing/not loaded).');
    }

    // --- UI Update Function (Handles Text and Button States) ---
    /*async*/ function updateUI() { // <-- REMOVE async
        // REMOVED: console.log('DEBUG: Entering updateUI function');
        
        // --- Detailed Guard Clause Check --- 
        if (!game.base) { return; } // REMOVED: /*console.log("DEBUG: updateUI exiting - game.base is missing");*/
        if (!game.waveManager) { return; } // REMOVED: /*console.log("DEBUG: updateUI exiting - game.waveManager is missing");*/
        if (!fundsDisplay) { return; } // REMOVED: /*console.log("DEBUG: updateUI exiting - fundsDisplay element is missing");*/
        if (!waveInfoDisplay) { return; } // REMOVED: /*console.log("DEBUG: updateUI exiting - waveInfoDisplay element is missing");*/
        if (!game.defenceManager) { return; } // REMOVED: /*console.log("DEBUG: updateUI exiting - game.defenceManager is missing");*/
        if (!defenceMenu) { return; } // REMOVED: /*console.log("DEBUG: updateUI exiting - defenceMenu element is missing");*/
        if (!game.priceManager) { return; } // REMOVED: /*console.log("DEBUG: updateUI exiting - game.priceManager is missing");*/
        // --- End Detailed Check --- 

        // Original Guard Clause (now redundant because of above checks)
        // if (!game.base || !game.waveManager || !fundsDisplay || !waveInfoDisplay || !defenceManager || !defenceMenu || !priceManager) return;

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
        // Use cached costs instead of recalculating
        const calculatedCosts = game.priceManager.getStoredCosts();
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

    // Initial UI update after menu population
    updateUI(); 
});
