import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY || "YOUR_KEY"});
async function main() {
  try {
    const rawArgs: any = {
      model: "veo-3.1-lite-generate-preview",
      prompt: "A red ball rolling on the floor",
      image: {
        imageBytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64").toString("base64"),
        mimeType: "image/png"
      },
      config: { numberOfVideos: 1, aspectRatio: "16:9" }
    };
    const op = await ai.models.generateVideos(rawArgs);
    console.log("SUCCESS:", op);
  } catch (e: any) {
    console.error("API ERROR:", e.message);
  }
}
main();
