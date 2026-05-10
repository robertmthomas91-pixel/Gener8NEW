import fs from "fs";

let str = fs.readFileSync("src/App.tsx", "utf-8");

// Revert 1. Text headers

str = str.replace(/text-5xl md:text-6xl font-serif text-white rgb-split mb-2 tracking-tight/g, "text-4xl font-bold tracking-tighter text-white italic");
str = str.replace(/text-3xl font-serif text-white tracking-tight/g, "text-2xl font-bold text-white tracking-tight"); // Can't distinguish between the two overlapping replacements, fallback to generic
str = str.replace(/text-3xl font-serif font-bold text-white mb-6 tracking-tight rgb-split/g, "text-2xl font-bold text-white mb-6 tracking-tight");
str = str.replace(/text-5xl md:text-6xl font-serif text-white tracking-tight mb-4 rgb-split/g, "text-4xl font-bold text-white tracking-tighter uppercase mb-4");
str = str.replace(/text-4xl md:text-5xl font-serif text-white tracking-tight rgb-split/g, "text-3xl font-bold text-white tracking-tighter uppercase");

// Revert 2. Add some "prism-beam" lines to the top of headers or important sections
str = str.replace(/prism-bg text-slate-200/g, "bg-[#050505] text-slate-200");
str = str.replace(/bg-\[#0A0A0B\]\/80 backdrop-blur-3xl/g, "bg-black/30");
// bg-white/[0.02] -> bg-white/5
str = str.replace(/bg-white\/\[0\.02\]/g, "bg-white/5");
// border-white/5 -> border-white/10
str = str.replace(/border-white\/5/g, "border-white/10");
// rounded-none border-t border-white/10 -> rounded-3xl
str = str.replace(/rounded-none border-t border-white\/10/g, "rounded-3xl");
// text-[10px] uppercase font-mono tracking-widest text-slate-400 -> text-[10px] uppercase tracking-widest
str = str.replace(/text-\[10px\] uppercase font-mono tracking-widest text-slate-400/g, "text-[10px] uppercase tracking-widest");
// text-xs font-mono uppercase tracking-[0.2em] text-slate-400 -> text-xs font-bold uppercase tracking-[0.2em]
str = str.replace(/text-xs font-mono uppercase tracking-\[0\.2em\] text-slate-400/g, "text-xs font-bold uppercase tracking-[0.2em]");

// Revert Gener8 branding
str = str.replace(/<span className="font-serif italic rgb-split">Gener8<\/span> Studio/g, "Gener8 Studio");

fs.writeFileSync("src/App.tsx", str);
console.log("Reverted stuff.");
