import * as PIXI from 'pixi.js';
import { Texture, Rectangle } from 'pixi.js';

/**
 * Loads a CSV file where the first column is an integer range/index
 * and the second column is a numerical value, creating a lookup array.
 * @param {string} filePath - Path to the CSV file.
 * @returns {Promise<number[]>} A promise that resolves with the lookup array (index 0 unused).
 */
export async function loadCsvLookup(filePath) {
    try {
        const response = await fetch(filePath);
        if (!response.ok) {
             throw new Error(`HTTP error! status: ${response.status} loading ${filePath}`);
        }
        const data = await response.text();
        const lines = data.trim().split('\n');
        const header = lines.shift(); // Remove header row
        
        const lookup = [0]; // Index 0 unused
        let maxRange = 0;
        lines.forEach(line => {
            const [rangeStr, valueStr] = line.split(','); // Generic name for value
            const range = parseInt(rangeStr, 10);
            const value = parseFloat(valueStr);
            if (!isNaN(range) && !isNaN(value) && range > 0) {
                // Fill gaps if CSV is sparse 
                while (lookup.length <= range) {
                    lookup.push(lookup[lookup.length - 1] || 0); // Pad with previous value
                }
                lookup[range] = value;
                maxRange = Math.max(maxRange, range);
            } else {
                 console.warn(`loadCsvLookup: Skipping invalid line in ${filePath}: "${line}"`);
            }
        });
        //console.log(`loadCsvLookup: Loaded lookup table from ${filePath} up to range ${maxRange}`);
        return lookup;
    } catch (error) {
        console.error(`loadCsvLookup: Error loading lookup table from ${filePath}:`, error);
        throw error; // Re-throw after logging
    }
}

/**
 * Processes a spritesheet asset into an array of PIXI.Texture objects.
 * @param {string} assetPath - Path to the image asset.
 * @param {object} frameConfig - Configuration for sprite frames.
 * @param {number} frameConfig.frameWidth - Width of a single frame.
 * @param {number} frameConfig.frameHeight - Height of a single frame.
 * @param {number} frameConfig.totalFrames - Total number of frames in the spritesheet.
 * @param {number} frameConfig.framesPerRow - Number of frames per row.
 * @returns {Promise<PIXI.Texture[]>} A promise that resolves with an array of textures.
 */
export async function processSpritesheet(assetPath, frameConfig) {
    if (!assetPath || !frameConfig) {
        console.error("processSpritesheet (util): Missing assetPath or frameConfig.", { assetPath, frameConfig });
        return [];
    }
    try {
        const loadedAsset = await PIXI.Assets.load(assetPath);

        if (!loadedAsset || !loadedAsset.source) {
            console.error(`processSpritesheet (util): Failed to load asset or asset source is invalid for ${assetPath}.`, loadedAsset);
            return [];
        }

        const textures = [];
        const { frameWidth, frameHeight, totalFrames, framesPerRow } = frameConfig;

        for (let i = 0; i < totalFrames; i++) {
            const col = i % framesPerRow;
            const row = Math.floor(i / framesPerRow);
            const x = col * frameWidth;
            const y = row * frameHeight;
            const frameRectangle = new PIXI.Rectangle(x, y, frameWidth, frameHeight);
            
            // Ensure the texture uses the correct base texture source from the loaded asset
            const newTexture = new PIXI.Texture({ source: loadedAsset, frame: frameRectangle.clone() });

            textures.push(newTexture);
        }
        return textures;
    } catch (error) {
        console.error(`processSpritesheet (util): Error processing spritesheet ${assetPath}:`, error);
        return [];
    }
}

// Add other data loading utility functions here if needed 