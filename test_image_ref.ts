import { GoogleGenAI } from "@google/genai";

async function test() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("No API key");
    return;
  }
  const ai = new GoogleGenAI({ apiKey });
  
  // create a dummy 1x1 png base64
  const dummyBase64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAsTAAALEwEAmpwYAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

  try {
    const contents = {
        parts: [
          {
            text: `GENERATE 16:9 CINEMATIC ASSET: A robot holding a cup of coffee`
          },
          {
            inlineData: {
              mimeType: "image/png",
              data: dummyBase64
            }
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
    
    console.log("Success with image ref:", !!response.candidates?.[0]?.content?.parts?.find(p => p.inlineData));
  } catch(e) {
    console.error("Error:", e);
  }
}
test();
