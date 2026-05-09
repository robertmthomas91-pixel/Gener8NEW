import { GoogleGenAI } from "@google/genai";

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("No API key");
    return;
  }
  const ai = new GoogleGenAI({ apiKey });
  try {
    const contents = {
        parts: [
          {
            text: `GENERATE 16:9 CINEMATIC ASSET: A robot holding a cup of coffee`
          }
        ]
      };
      
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: contents,
      config: {
        imageConfig: {
          aspectRatio: "16:9",
          imageSize: "1K" // <---
        }
      }
    });
    
    console.log("Success with image size!");
  } catch(e) {
    console.error("Error:", e);
  }
}
test();
