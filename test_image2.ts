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
          aspectRatio: "16:9"
        }
      }
    });
    
    console.log("Response text:", response.text);
    console.log("Parts:", response.candidates?.[0]?.content?.parts);
    console.log("Has inlineData:", !!response.candidates?.[0]?.content?.parts?.find(p => p.inlineData));
  } catch(e) {
    console.error("Error:", e);
  }
}
test();
