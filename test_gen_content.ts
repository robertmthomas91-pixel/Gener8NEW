import { GoogleGenAI } from "@google/genai";
async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const res = await ai.models.generateContent({
      model: 'gemini-2.5-flash-image',
      contents: "A robot holding a cup of coffee"
    });
    console.log(!!res.candidates?.[0]?.content?.parts?.find(p => p.inlineData) ? "Success with generateContent" : "No image returned");
  } catch(e) { console.error("generateContent failed:", e.message); }
}
test();
