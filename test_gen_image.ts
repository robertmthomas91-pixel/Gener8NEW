import { GoogleGenAI } from "@google/genai";
async function test() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  try {
    const res = await ai.models.generateImages({
      model: 'imagen-3.0-generate-002',
      prompt: 'A robot holding a cup of coffee',
      config: {
        numberOfImages: 1,
        aspectRatio: '16:9'
      }
    });
    console.log(res.generatedImages?.[0]?.image?.imageBytes ? "Success" : "No image returned");
  } catch(e) { console.error("generateImages failed:", e.message); }
}
test();
