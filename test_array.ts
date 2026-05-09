import { GoogleGenAI } from "@google/genai";

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("No API key");
    return;
  }
  const ai = new GoogleGenAI({ apiKey });
  try {
    const contents = [{ role: "user", parts: [{ text: "A robot holding a cup of coffee" }] }];
      
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash-image",
      contents: contents,
      config: {
        imageConfig: {
          aspectRatio: "16:9"
        }
      }
    });
    
    console.log("Success with array!");
  } catch(e) {
    console.error("Error:", e);
  }
}
test();
