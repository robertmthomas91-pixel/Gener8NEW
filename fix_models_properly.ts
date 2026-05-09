import * as fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Replace wrong image model -> correct image model
content = content.replace(/"nano-banana"/g, '"gemini-2.5-flash-image"');

// Replace wrong video model -> correct video model
content = content.replace(/"veo-3.1-lite"/g, '"veo-3.1-lite-generate-preview"');

// Fix isPremiumModel
content = content.replace(/model\.includes\("nano-banana"\)/g, 'model.includes("image")');

fs.writeFileSync('src/App.tsx', content);
console.log('Replacements completed successfully.');
