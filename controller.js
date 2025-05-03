import Game from './models/game.js';

// State variables for defence placement
let selectedDefenceType = null;
let isPlacingDefence = false;
let placementPreviewPos = null; // {x, y} in canvas coordinates

// --- Difficulty Configuration ---
const DIFFICULTY_SCALARS = {
    easy: 0.6,
    normal: 0.8,
    hard: 1.0 // Break-even
};

// Create and start game
window.addEventListener('DOMContentLoaded', async () => {
    // --- State Variable ---
    let isGameActive = false;

    // --- DOM Element References ---
    const overlay = document.getElementById('gameOverlay');
    const popupTitle = document.getElementById('popupTitle');
    const difficultyButtons = document.querySelectorAll('.difficulty-button');

    // --- Initialize Game and Defence Menu --- 
    const gameInstance = new Game();
    // Expose game instance for debugging/testing scalar changes
    window.myGame = gameInstance; 

    try {
        // Wait for the game to fully initialize (loads assets, calculates alpha_0, etc.)
        await gameInstance.ready(); 
        //console.log("Controller: Game initialization complete.");
        
        // Wait for DefenceMenu to load data (fetch definitions, price etc.)
        // await defenceMenu.initialize(); // Ensure menu initializes and fetches data
        //console.log("Controller: Defence Menu initialization complete.");

    } catch (error) {
        console.error("Controller: Error during initialization:", error);
        // Handle initialization error (e.g., display message to user)
        if (overlay) {
            popupTitle.textContent = "Initialization Failed!";
            overlay.classList.remove('hidden'); // Show overlay with error
        } else {
            alert("Critical error during game initialization. Please check the console.");
        }
        return; // Stop further execution
    }

    // --- Add Event Listeners to Difficulty Buttons ---
    difficultyButtons.forEach(button => {
        button.addEventListener('click', (event) => {
            // Check if the overlay is currently visible (meaning game is paused or over)
            const isOverlayVisible = !overlay.classList.contains('hidden');
            
            if (isOverlayVisible && !isGameActive) {
                 // --- Game Over / Restart Logic --- 
                 //console.log("Restart requested after game over...");
                 // 1. Reset the game state
                 gameInstance.reset();
                 // 2. Reset overlay visuals (remove red tint)
                 overlay.classList.remove('game-over');
                 // 3. Update title back to default (optional, or set by listener)
                 // popupTitle.textContent = 'Choose your destiny'; 
                 // 4. Fall through to set difficulty and start new game
            } else if (isGameActive) {
                // If game is active, button click shouldn't do anything (or maybe pause?)
                console.log("Difficulty button clicked while game active. Ignoring.");
                return; 
            }
            // --- Initial Difficulty Selection Logic --- 
            const selectedDifficulty = event.target.dataset.difficulty;
            const scalar = DIFFICULTY_SCALARS[selectedDifficulty];

            if (scalar === undefined) {
                console.error(`Invalid difficulty selected: ${selectedDifficulty}`);
                return;
            }

            // Set the difficulty scalar in the game instance
            gameInstance.setDifficultyScalar(scalar);

            // Update game state and UI
            gameInstance.startGame(); // Tell the game instance to start updating
            overlay.classList.add('hidden'); // Use display: none for instant hide
            // Ensure fade-in class is removed if it was added during game over
            overlay.classList.remove('fade-in'); 
            overlay.classList.remove('game-over');
            overlay.style.opacity = ''; // Remove inline opacity style

            //console.log(`Difficulty set to: ${selectedDifficulty} (scalar: ${scalar}). Game active.`);
        });
    });

    // --- Game Over Listener --- 
    // Assuming gameInstance.base exists after initialization
    if (gameInstance.base) { 
        gameInstance.base.addEventListener('gameOver', () => {
            //console.log("Controller received game over event.");
            gameInstance.startGameOverSequence(); // Initiate slow-mo and pause logic
            popupTitle.textContent = 'Try again?'; // Change popup title
            
            // --- Game Over Fade-in Logic --- 
            overlay.classList.add('game-over'); // Add red tint class first
            overlay.style.opacity = '0'; // Start transparent
            overlay.classList.remove('hidden'); // Make it visible (display: flex)
            
            // Force browser reflow to apply opacity 0 before adding transition class
            void overlay.offsetWidth; 
            
            overlay.classList.add('fade-in'); // Add class to enable transition
            overlay.style.opacity = '1'; // Trigger fade to full opacity
            // --- End Game Over Fade-in Logic ---
            
            // TODO: Add logic for slow-motion if desired (e.g., set a flag game.update checks)
        });
    } else {
        console.error("Controller: Cannot add gameOver listener, gameInstance.base not available!");
    }

    // Get menu and canvas elements
    const gameCanvas = gameInstance.layers.foreground?.canvas; 
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
        if (!gameInstance.priceManager) {
            console.error("updateDefenceMenu: PriceManager not available!");
            // Get the actual menu element here
            const menuElement = document.getElementById('defenceMenu');
            if(menuElement) menuElement.innerHTML = '<p style="color:red;">Error: Prices unavailable.</p>';
            return;
        }

        // Get the actual menu element here too
        const menuElement = document.getElementById('defenceMenu');
        menuElement.innerHTML = ''; // Clear existing content
        // Use cached costs instead of recalculating
        const calculatedCosts = gameInstance.priceManager.getStoredCosts();

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
                
                // Append to the actual menu element
                menuElement.appendChild(button);
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
            // Get the actual menu element here
            document.querySelectorAll('#defenceMenu .defence-button.selected').forEach(btn => btn.classList.remove('selected'));
            clickedButton.classList.add('selected');
        }
        // Update game state for rendering preview
        gameInstance.setPlacementPreview(placementPreviewPos); // Pass null if deselected
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
        gameInstance.setPlacementPreview(placementPreviewPos);
    });

    // Canvas Click Listener
    gameCanvas.addEventListener('click', async (event) => {
        // Check placement state AND validity from the game model
        const currentPreview = gameInstance.getPlacementPreview(); 
        if (!isPlacingDefence || !selectedDefenceType || !currentPreview?.isValid) {
           // If not placing, no type selected, or preview doesn't exist or is invalid, do nothing
           // console.log("Placement attempt ignored: Invalid state or location."); // Optional debug log
           return;
        }

        // If we reach here, placement is attempted on a valid spot
        
        // Tell DefenceManager to place the defence (it now trusts the position is valid)
        if (gameInstance.defenceManager) {
            // Pass the known valid position from the preview object
            await gameInstance.defenceManager.placeDefence(selectedDefenceType, { x: currentPreview.x, y: currentPreview.y });
        }

        // Clear selection state (only if placement was attempted, successful or not)
        const selectedButton = document.querySelector(`.defence-button[data-defence-id="${selectedDefenceType}"]`);
        if (selectedButton) selectedButton.classList.remove('selected');
        
        selectedDefenceType = null;
        isPlacingDefence = false;
        placementPreviewPos = null; // Clear the controller's cached position
        // Update game state to remove preview
        gameInstance.setPlacementPreview(null);
    });

    // Initial population and setup listener for updates
    if (gameInstance.defenceManager && gameInstance.defenceManager.isLoaded && gameInstance.priceManager) { // Check priceManager here too
        updateDefenceMenu(gameInstance.defenceManager.getDefinitions()); // Update uses cached costs now
        // Listen for definition updates from DefenceManager (keeps current logic)
        gameInstance.defenceManager.addEventListener('definitionsUpdated', async () => {
            const currentSelectedId = selectedDefenceType;
            await updateDefenceMenu(gameInstance.defenceManager.getDefinitions());
            if (currentSelectedId) {
                const selectedButton = document.querySelector(`.defence-button[data-defence-id="${currentSelectedId}"]`);
                if (selectedButton) selectedButton.classList.add('selected');
            }
        });
        // ADD listener for cost updates from PriceManager
        gameInstance.priceManager.addEventListener('costsUpdated', () => {
            // console.log("Controller: Received costsUpdated event. Running updateUI."); // Optional debug
            updateUI(); // Trigger UI update when costs change
        });
        // ADD listener for funds updates from Base
        if (gameInstance.base) { // Ensure base exists before adding listener
            gameInstance.base.addEventListener('fundsUpdated', () => {
                // console.log("Controller: Received fundsUpdated event. Running updateUI."); // Optional debug
                updateUI(); // Trigger UI update when funds change
            });
        } else {
             console.error("Controller: Cannot add fundsUpdated listener, game.base is not available.");
        }
        // ADD listener for wave status updates
        if (gameInstance.waveManager) { // Ensure waveManager exists
            gameInstance.waveManager.addEventListener('statusUpdated', () => {
                // console.log("Controller: Received wave statusUpdated event. Running updateUI."); // Optional debug
                updateUI(); // Trigger UI update when wave status changes
            });
        } else {
            console.error("Controller: Cannot add statusUpdated listener, game.waveManager is not available.");
        }
    } else {
        console.error('Could not initially populate defence menu or set up listener (DefenceManager or PriceManager missing/not loaded).');
    }

    // --- UI Update Function (Handles Text and Button States) ---
    /*async*/ function updateUI() { // <-- REMOVE async
        // REMOVED: console.log('DEBUG: Entering updateUI function');
        
        // --- Detailed Guard Clause Check --- 
        if (!gameInstance.base) { return; } // REMOVED: /*console.log("DEBUG: updateUI exiting - game.base is missing");*/
        if (!gameInstance.waveManager) { return; } // REMOVED: /*console.log("DEBUG: updateUI exiting - game.waveManager is missing");*/
        if (!fundsDisplay) { return; } // REMOVED: /*console.log("DEBUG: updateUI exiting - fundsDisplay element is missing");*/
        if (!waveInfoDisplay) { return; } // REMOVED: /*console.log("DEBUG: updateUI exiting - waveInfoDisplay element is missing");*/
        if (!gameInstance.defenceManager) { return; } // REMOVED: /*console.log("DEBUG: updateUI exiting - game.defenceManager is missing");*/
        if (!defenceMenu) { return; } // REMOVED: /*console.log("DEBUG: updateUI exiting - defenceMenu element is missing");*/
        if (!gameInstance.priceManager) { return; } // REMOVED: /*console.log("DEBUG: updateUI exiting - game.priceManager is missing");*/
        // --- End Detailed Check --- 

        // Original Guard Clause (now redundant because of above checks)
        // if (!game.base || !game.waveManager || !fundsDisplay || !waveInfoDisplay || !defenceManager || !defenceMenu || !priceManager) return;

        // --- Update Text Displays ---
        fundsDisplay.textContent = `${gameInstance.base.currentFunds}G`; 

        let waveText = '';
        if (gameInstance.waveManager.isFinished) {
            waveText = "All Waves Complete!";
        } else if (gameInstance.waveManager.timeUntilNextWave > 0) {
            const seconds = Math.ceil(gameInstance.waveManager.timeUntilNextWave / 1000);
            waveText = `Next wave in ${seconds}s`;
        } else if (gameInstance.waveManager.currentWaveNumber > 0) {
            waveText = `Wave ${gameInstance.waveManager.currentWaveNumber}`;
        } else {
            waveText = "Get Ready!";
        }
        waveInfoDisplay.textContent = waveText;

        // --- Update Button Affordability AND Price Text ---
        const currentFunds = gameInstance.base.currentFunds;
        // Use cached costs instead of recalculating
        const calculatedCosts = gameInstance.priceManager.getStoredCosts();
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
