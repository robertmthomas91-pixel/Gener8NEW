import fs from "fs";

let str = fs.readFileSync("src/App.tsx", "utf-8");

// 1. Text headers
str = str.replace(/text-4xl font-bold tracking-tighter text-white italic/g, "text-5xl md:text-6xl font-serif text-white rgb-split mb-2 tracking-tight");
str = str.replace(/text-2xl font-bold tracking-tight text-white italic/g, "text-3xl font-serif text-white tracking-tight");
str = str.replace(/text-2xl font-bold text-white mb-6 tracking-tight/g, "text-3xl font-serif font-bold text-white mb-6 tracking-tight rgb-split");
str = str.replace(/text-2xl font-bold text-white tracking-tight/g, "text-3xl font-serif text-white tracking-tight");
str = str.replace(/text-4xl font-bold text-white tracking-tighter uppercase mb-4/g, "text-5xl md:text-6xl font-serif text-white tracking-tight mb-4 rgb-split");
str = str.replace(/text-3xl font-bold text-white tracking-tighter uppercase/g, "text-4xl md:text-5xl font-serif text-white tracking-tight rgb-split");

// 2. Add some "prism-beam" lines to the top of headers or important sections
// Wait, maybe we just add the prism-bg to the main app container.
str = str.replace(/bg-\[#050505\] text-slate-200/g, "prism-bg text-slate-200");
str = str.replace(/bg-black\/30/g, "bg-[#0A0A0B]/80 backdrop-blur-3xl");
str = str.replace(/bg-white\/5/g, "bg-white/[0.02]");
str = str.replace(/border-white\/10/g, "border-white/5");
str = str.replace(/rounded-3xl/g, "rounded-none border-t border-white/10"); // PDF is more angular in some places, though the images have rounded borders. But wait, "rounded-2xl" on images.
str = str.replace(/text-\[10px\] uppercase tracking-widest/g, "text-[10px] uppercase font-mono tracking-widest text-slate-400");
str = str.replace(/text-xs font-bold uppercase tracking-\[0.2em\]/g, "text-xs font-mono uppercase tracking-[0.2em] text-slate-400");

// Apply font-serif and rgb-split to specific Gener8 branding
str = str.replace(/Gener8 Studio/g, "<span className=\"font-serif italic rgb-split\">Gener8</span> Studio");

fs.writeFileSync("src/App.tsx", str);
console.log("Replaced stuff.");
