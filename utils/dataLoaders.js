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

// Add other data loading utility functions here if needed 