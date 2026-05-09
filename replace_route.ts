import fs from "fs"

const app = fs.readFileSync("src/App.tsx", "utf-8");
const targetKey1 = `<Route\n            path="/studio"`;
const targetKey2 = `          <Route\n            path="/admin"`;

const split1 = app.split(targetKey1);
if (split1.length === 2) {
    const split2 = split1[1].split(targetKey2);
    if (split2.length === 2) {
        let newContent = split1[0] + targetKey1 + `\n            element={\n              <div className="h-[calc(100vh-4rem)] w-full relative">\n                <React.Suspense fallback={<div className="h-full w-full flex items-center justify-center">Loading Data...</div>}>\n                  <StudioNodeEditor\n                    onGenerateImage={handleGenerateImages}\n                    onGenerateVideo={handleGenerateVideos}\n                  />\n                </React.Suspense>\n              </div>\n            }\n          />\n` + targetKey2 + split2[1];
        
        // Add import
        if (!newContent.includes('import StudioNodeEditor')) {
            newContent = newContent.replace('import { ImageIcon,', 'import StudioNodeEditor from "./components/StudioNodeEditor";\nimport { ImageIcon,');
        }

        fs.writeFileSync("src/App.tsx", newContent);
        console.log("Success replacing /studio route.");
    } else {
        console.log("Failed split 2");
    }
} else {
    console.log("Failed split 1");
}
