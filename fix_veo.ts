import * as fs from 'fs';

let content = fs.readFileSync('src/App.tsx', 'utf-8');

// Inside callGemini, if model.includes('veo') and type is undefined, set type effectively.
content = content.replace(
  /if \(type === "video"\) {/g,
  `if (type === "video" || model.includes("veo")) {`
);

fs.writeFileSync('src/App.tsx', content);
console.log('Fixed veo type mapping.');
