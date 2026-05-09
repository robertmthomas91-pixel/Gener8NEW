import * as fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Replace "gemini-2.5-flash-image" with "nano-banana"
content = content.replace(/"gemini-2.5-flash-image"/g, '"nano-banana"');

// Replace "veo-3.1-lite-generate-preview" with "veo-3.1-lite" 
content = content.replace(/"veo-3.1-lite-generate-preview"/g, '"veo-3.1-lite"');

// Update isPremiumModel to include "nano-banana"
content = content.replace(/model\.includes\("image"\)/g, 'model.includes("image") ||\n      model.includes("nano-banana")');

fs.writeFileSync('src/App.tsx', content);
console.log('Replacements completed successfully.');
