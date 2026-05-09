import { GoogleGenAI } from "@google/genai";

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return;
  const ai = new GoogleGenAI({ apiKey });
  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: "A robot holding a cup of coffee",
      config: {
        imageConfig: {
          aspectRatio: "16:9",
          imageSize: "4K"
        }
      }
    }); 
    console.log("Success with 4K param!");
  } catch(e) {
    console.error("Error:", e.message);
  }
}
test();
