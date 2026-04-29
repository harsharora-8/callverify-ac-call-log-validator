import { GoogleGenAI, Type } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface ExtractedCallData {
  phone: string;
  time: string;
  duration: string; // Total seconds as string
}

export async function extractCallDataFromImage(base64Image: string): Promise<ExtractedCallData | null> {
  try {
    const response = await ai.models.generateContent({
      model: "gemini-3-flash-preview",
      contents: {
        parts: [
          {
            inlineData: {
              mimeType: "image/png",
              data: base64Image.split(',')[1] || base64Image,
            },
          },
          {
            text: `Analyze this call log screenshot and extract:
            1. Phone Number: Convert to strict E.164 format (e.g., +919876543210).
            2. Call Time: The exact time shown (e.g., 10:30 AM).
            3. Duration: Convert the call duration to total seconds as a string (e.g., "320").

            If multiple logs exist, focus ONLY on the most recent or highlighted one.
            Ensure the response is valid JSON.`,
          },
        ],
      },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            phone: { 
              type: Type.STRING,
              description: "Phone number in E.164 format"
            },
            time: { 
              type: Type.STRING,
              description: "Time of call"
            },
            duration: { 
              type: Type.STRING,
              description: "Total duration in seconds"
            },
          },
          required: ["phone", "time", "duration"],
        },
      },
    });

    const text = response.text;
    if (!text) {
      console.error("Gemini returned empty response text");
      return null;
    }

    try {
      const parsed = JSON.parse(text);
      
      // Basic validation of the parsed object
      if (!parsed.phone || !parsed.time || !parsed.duration) {
        console.error("Gemini JSON missing required fields:", parsed);
        return null;
      }

      return parsed as ExtractedCallData;
    } catch (parseError) {
      console.error("Failed to parse Gemini JSON output:", text, parseError);
      return null;
    }
  } catch (error) {
    console.error("Gemini OCR Error:", error);
    return null;
  }
}
