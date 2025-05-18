import Game from './models/game.js';

// State variables for defence placement (potentially move into Controller later)
let selectedDefenceType = null;
let isPlacingDefence = false;
let placementPreviewPos = null; // {x, y} in canvas coordinates

// Define the Controller class
class Controller {
    constructor() {
        // Initialize properties that will hold references
        this.gameInstance = null;
        this.overlay = null;
        this.popupTitle = null;
        this.difficultyButtons = null;
        this.fundsDisplay = null;
        this.waveInfoDisplay = null;
        this.defenceMenuElement = null;
        this.gameCanvas = null;
    }

    async initialize(gameInstance) {
        this.gameInstance = gameInstance;

        // --- Get DOM Element References ---
        this.overlay = document.getElementById('gameOverlay');
        this.popupTitle = document.getElementById('popupTitle');
        this.difficultyButtons = document.querySelectorAll('.difficulty-button');
        this.fundsDisplay = document.getElementById('fundsDisplay');
        this.waveInfoDisplay = document.getElementById('waveInfoDisplay');
        this.defenceMenuElement = document.getElementById('defenceMenu');
        this.gameCanvas = this.gameInstance.app?.canvas;

        // Debugging: Log the retrieved elements
        // console.log(`Retrieved elements: overlay=${!!this.overlay}, popupTitle=${!!this.popupTitle}, buttons=${this.difficultyButtons.length}, funds=${!!this.fundsDisplay}, waveInfo=${!!this.waveInfoDisplay}, targetDamage=${!!this.targetDamageDisplay}, defenceMenu=${!!this.defenceMenuElement}`);

        if (!this.overlay || !this.popupTitle || !this.difficultyButtons || !this.fundsDisplay || !this.waveInfoDisplay /* || !this.targetDamageDisplay */ || !this.defenceMenuElement /*|| !this.gameCanvas*/) {
            console.error("UI elements not found at initUI!", {
                overlay: !!this.overlay,
                popupTitle: !!this.popupTitle,
                buttons: this.difficultyButtons.length,
                fundsDisplay: !!this.fundsDisplay,
                waveInfoDisplay: !!this.waveInfoDisplay,
                defenceMenuElement: !!this.defenceMenuElement
                // gameCanvas: !!this.gameCanvas // Not yet assigned from gameInstance
            });
            return; // Abort if critical elements are missing
        }

        // --- Add Event Listeners ---
        this._setupDifficultyButtons();
        this._setupGameOverListener();
        // Conditionally setup canvas listeners if gameCanvas is available
        if (this.gameCanvas) {
            this._setupCanvasListeners();
        } else {
            console.warn("Controller Initialize: Skipping canvas listeners as gameCanvas is not available.");
        }
        this._setupDefenceMenu();
    }

    _setupDifficultyButtons() {
        this.difficultyButtons.forEach(button => {
        button.addEventListener('click', (event) => {
                const isOverlayVisible = !this.overlay.classList.contains('hidden');
                const isGameActive = this.gameInstance.isGameActive; // Use game state
            
            if (isOverlayVisible && !isGameActive) {
                    this.gameInstance.reset();
                    this.overlay.classList.remove('game-over', 'fade-in');
                    this.overlay.style.opacity = '';
            } else if (isGameActive) {
                console.log("Difficulty button clicked while game active. Ignoring.");
                return; 
            }

            const selectedDifficulty = event.target.dataset.difficulty;
            let scalar;
                if (this.gameInstance.gameConfig && this.gameInstance.gameConfig.difficultyScalars) {
                    scalar = this.gameInstance.gameConfig.difficultyScalars[selectedDifficulty];
            } else {
                 console.error("Game config or difficulty scalars not loaded! Cannot set difficulty.");
                 return;
            }
            if (scalar === undefined) {
                console.error(`Invalid difficulty selected: ${selectedDifficulty}`);
                return;
            }

                this.gameInstance.setDifficultyScalar(scalar);

                if (this.gameInstance.backgroundMusic) {
                    if (!this.gameInstance.isMusicPlaying) {
                        const playPromise = this.gameInstance.backgroundMusic.play();
                      if (playPromise !== undefined) {
                            playPromise.then(() => { this.gameInstance.isMusicPlaying = true; })
                                     .catch(error => { console.error("Background music play failed:", error); });
                        } else {
                            this.gameInstance.isMusicPlaying = true;
                        }
                    }
                    this.gameInstance.backgroundMusic.volume = 1.0;
                } else {
                    console.warn("Cannot control music: gameInstance.backgroundMusic is null.");
                }

                this.gameInstance.startGame();
                this.overlay.classList.add('hidden');
                this.overlay.classList.remove('game-over', 'fade-in');
                this.overlay.style.opacity = '';
            });
        });
    }

    _setupGameOverListener() {
        if (this.gameInstance.base) {
            this.gameInstance.base.addEventListener('gameOver', () => {
                this.gameInstance.startGameOverSequence();
                this.popupTitle.textContent = 'Try again?';
                this.overlay.classList.add('game-over');
                this.overlay.style.opacity = '0';
                this.overlay.classList.remove('hidden');
                void this.overlay.offsetWidth;
                this.overlay.classList.add('fade-in');
                this.overlay.style.opacity = '1';
                           });
                      } else {
            console.error("Controller: Cannot add gameOver listener, gameInstance.base not available!");
        }
    }

    _setupCanvasListeners() {
        this.gameCanvas.addEventListener('mousemove', (event) => {
            if (!isPlacingDefence) return;
            const rect = this.gameCanvas.getBoundingClientRect();
            const scaleX = this.gameCanvas.width / rect.width;
            const scaleY = this.gameCanvas.height / rect.height;
            placementPreviewPos = { x: (event.clientX - rect.left) * scaleX, y: (event.clientY - rect.top) * scaleY };
            let definition = null;
            if (selectedDefenceType && this.gameInstance.defenceManager) {
                definition = this.gameInstance.defenceManager.getDefinition(selectedDefenceType);
            }
            if (placementPreviewPos && definition) {
                this.gameInstance.setPlacementPreview(placementPreviewPos, definition);
            } else {
                this.gameInstance.setPlacementPreview(null, null);
                placementPreviewPos = null;
            }
        });

        this.gameCanvas.addEventListener('click', async (event) => {
            // const currentPreview = this.gameInstance.getPlacementPreview(); // Old way, no longer reliable for validity
            // if (!isPlacingDefence || !selectedDefenceType || !currentPreview?.isValid) return;

            if (!isPlacingDefence || !selectedDefenceType || !placementPreviewPos) {
                return; // Not placing, no type selected, or no position known
            }

            // Check validity directly using the game instance and current mouse position
            const isValidClick = this.gameInstance.isPositionValidForPlacement(placementPreviewPos);

            if (!isValidClick) {
                return; // Click was not in a valid placement location
            }

            // If all checks pass (placing, type selected, position known, and position is valid):
            if (this.gameInstance.defenceManager) {
                // Use placementPreviewPos for the coordinates, as it's the most up-to-date mouse position
                await this.gameInstance.defenceManager.placeDefence(selectedDefenceType, { x: placementPreviewPos.x, y: placementPreviewPos.y });
            }
            const selectedButton = document.querySelector(`.defence-button[data-defence-id="${selectedDefenceType}"]`);
            if (selectedButton) selectedButton.classList.remove('selected');
            selectedDefenceType = null;
            isPlacingDefence = false;
            placementPreviewPos = null;
            this.gameInstance.setPlacementPreview(null, null);
        });
    }

    _setupDefenceMenu() {
        if (this.gameInstance.defenceManager && this.gameInstance.defenceManager.isLoaded && this.gameInstance.priceManager) {
            this._updateDefenceMenuDOM(this.gameInstance.defenceManager.getDefinitions());

            this.gameInstance.defenceManager.addEventListener('definitionsUpdated', () => {
                const currentSelectedId = selectedDefenceType;
                this._updateDefenceMenuDOM(this.gameInstance.defenceManager.getDefinitions());
                if (currentSelectedId) {
                    const selectedButton = document.querySelector(`.defence-button[data-defence-id="${currentSelectedId}"]`);
                    if (selectedButton) selectedButton.classList.add('selected');
                }
                // No need to call updateUI, game loop does it
            });

            this.gameInstance.priceManager.addEventListener('costsUpdated', () => {
                // No need to call updateUI, game loop does it. Price update happens within updateUI.
            });

            if (this.gameInstance.base) {
                this.gameInstance.base.addEventListener('fundsUpdated', () => {
                    // No need to call updateUI, game loop does it
        });
    } else {
                console.error("Controller: Cannot add fundsUpdated listener, game.base is not available.");
    }

            if (this.gameInstance.waveManager) {
                this.gameInstance.waveManager.addEventListener('statusUpdated', () => {
                    // No need to call updateUI, game loop does it
                });
            } else {
                console.error("Controller: Cannot add statusUpdated listener, game.waveManager is not available.");
            }
        } else {
            console.error('Could not initially populate defence menu or set up listener (DefenceManager or PriceManager missing/not loaded).');
        }
    }

    // Helper to update the DOM for the defence menu
    _updateDefenceMenuDOM(definitions) {
        if (!this.defenceMenuElement || !this.gameInstance?.priceManager) return;

        this.defenceMenuElement.innerHTML = '';
        const calculatedCosts = this.gameInstance.priceManager.getStoredCosts();
        const sortedDefences = Object.entries(definitions)
            .filter(([id, def]) => calculatedCosts[id] !== undefined && calculatedCosts[id] !== Infinity)
            .sort(([idA], [idB]) => calculatedCosts[idA] - calculatedCosts[idB]);

        for (const [id, def] of sortedDefences) {
            const cost = calculatedCosts[id]; 
            if (def && def.name) { 
                const button = document.createElement('button');
                button.classList.add('defence-button');
                button.dataset.defenceId = id;
                button.addEventListener('click', () => {
                    this._handleDefenceSelection(id, button);
                });
                const nameSpan = document.createElement('span');
                nameSpan.classList.add('name');
                nameSpan.textContent = def.name;
                const priceSpan = document.createElement('span');
                priceSpan.classList.add('price');
                priceSpan.textContent = `${cost}G`;
                button.appendChild(nameSpan);
                button.appendChild(priceSpan);
                this.defenceMenuElement.appendChild(button);
            } 
        }
    }

    // Helper to handle defence selection logic
    _handleDefenceSelection(defenceId, clickedButton) {
        let definition = null;
        if (selectedDefenceType === defenceId) {
            selectedDefenceType = null;
            isPlacingDefence = false;
            placementPreviewPos = null;
            clickedButton.classList.remove('selected');
            this.gameInstance.setPlacementPreview(null, null);
        } else {
            selectedDefenceType = defenceId;
            isPlacingDefence = true;
            if (this.gameInstance.defenceManager) {
                definition = this.gameInstance.defenceManager.getDefinition(defenceId);
                 if (!definition) {
                     console.error(`Controller: Could not find definition for selected defence ID: ${defenceId}`);
                     selectedDefenceType = null;
                     isPlacingDefence = false;
                     return;
                 }
            } else {
                 console.error("Controller: DefenceManager not available to get definition.");
                return;
            }
            document.querySelectorAll('#defenceMenu .defence-button.selected').forEach(btn => btn.classList.remove('selected'));
            clickedButton.classList.add('selected');
        }
        this.gameInstance.setPlacementPreview(placementPreviewPos, definition);
    }

    // UI Update Method (called by Game loop)
    updateUI() {
        // Guard clauses for necessary components
        if (!this.gameInstance || !this.gameInstance.base || !this.gameInstance.waveManager || !this.fundsDisplay || !this.waveInfoDisplay || !this.gameInstance.priceManager || !this.defenceMenuElement) {
            // Optional: Log warning if called too early
            // console.warn("updateUI called before controller/game fully initialized.");
           return;
        }

        // Update Funds Display
        const currencySuffix = this.gameInstance.gameConfig?.ui?.currencySuffix || 'G';
        this.fundsDisplay.textContent = `${this.gameInstance.base.currentFunds}${currencySuffix}`;

        // Update Wave Info Display
        let waveText = '';
        if (this.gameInstance.waveManager.isFinished) {
            waveText = "All Waves Complete!";
        } else if (this.gameInstance.waveManager.timeUntilNextWave > 0) {
            const seconds = Math.ceil(this.gameInstance.waveManager.timeUntilNextWave / 1000);
            waveText = `Next wave in ${seconds}s`;
        } else if (this.gameInstance.waveManager.currentWaveNumber > 0) {
            waveText = `Wave ${this.gameInstance.waveManager.currentWaveNumber}`;
        } else {
            waveText = "Get Ready!";
        }
        this.waveInfoDisplay.textContent = waveText;

        // Update Button Affordability AND Price Text
        const currentFunds = this.gameInstance.base.currentFunds;
        const calculatedCosts = this.gameInstance.priceManager.getStoredCosts();
        const buttons = this.defenceMenuElement.querySelectorAll('.defence-button');

        buttons.forEach(button => {
            const defenceId = button.dataset.defenceId;
            const cost = calculatedCosts[defenceId]; // UNROUNDED cost
            const priceSpan = button.querySelector('.price');

            if (priceSpan && cost !== undefined && cost !== Infinity) {
                let displayCost;
                const roundingDecimals = this.gameInstance.gameConfig?.ui?.priceRoundingDecimals ?? 0;
                if (roundingDecimals >= 0) {
                    const factor = Math.pow(10, roundingDecimals);
                    displayCost = Math.round(cost * factor) / factor;
                } else {
                    displayCost = Math.round(cost);
                }
                priceSpan.textContent = `${displayCost}${currencySuffix}`;
            } else if (priceSpan) {
                priceSpan.textContent = `---${currencySuffix}`;
            }

            if (cost === undefined || cost === Infinity) { 
                button.classList.add('disabled'); 
                return;
            }

            if (currentFunds >= cost) {
                button.classList.remove('disabled');
            } else {
                button.classList.add('disabled');
                if (selectedDefenceType === defenceId) {
                    // Auto-deselect if player becomes unable to afford the selected defence
                    this._handleDefenceSelection(defenceId, button);
                }
            }
        });
    }
}


// Create and start game
window.addEventListener('DOMContentLoaded', async () => {

    // Create Game instance first (no controller needed in constructor anymore if we adjust Game)
    const gameInstance = new Game(); // Assumes Game constructor doesn't strictly NEED controller
    window.game = gameInstance; // Expose for debugging

    // Create Controller instance
    const controllerInstance = new Controller();

    try {
        // Wait for the game to fully initialize (loads assets, etc.)
        await gameInstance.ready();

        // Initialize Controller AFTER game is ready, passing gameInstance
        await controllerInstance.initialize(gameInstance);

        // --- Assign controller to game instance AFTER both are initialized (Alternative approach) ---
        // Requires Game class to allow setting controller after construction
        if (typeof gameInstance.setController === 'function') { 
            gameInstance.setController(controllerInstance); 
        } else {
             console.warn("Game class does not have setController method. UI updates might rely on direct call from game loop.")
             // If Game loop calls controllerInstance.updateUI() directly, this is okay.
        }
        // -------------------------------------------------------------------------------------

    } catch (error) {
        console.error("Controller: Error during initialization:", error);
        const overlay = document.getElementById('gameOverlay'); // Get overlay directly for error
        const popupTitle = document.getElementById('popupTitle'); // Get title directly for error
        if (overlay && popupTitle) {
            popupTitle.textContent = "Initialization Failed!";
            overlay.classList.remove('hidden');
        } else {
            alert("Critical error during game initialization. Check console or element IDs.");
        }
        return;
    }

    // REMOVED: All the setup logic is now inside Controller.initialize

});
