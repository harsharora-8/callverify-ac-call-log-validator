import express from "express";
import { createClient } from "@supabase/supabase-js";
import { GoogleGenAI, Type } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: '50mb' }));

// Supabase Init
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("CRITICAL: Supabase environment variables are missing!");
}

const supabase = createClient(supabaseUrl, supabaseKey);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

function calculateHammingDistance(h1: string, h2: string): number {
  if (h1.length !== h2.length) return 999;
  let distance = 0;
  for (let i = 0; i < h1.length; i++) {
    const v1 = parseInt(h1[i], 16);
    const v2 = parseInt(h2[i], 16);
    let xor = v1 ^ v2;
    while (xor > 0) {
      if (xor & 1) distance++;
      xor >>= 1;
    }
  }
  return distance;
}

function createExactKey(phone: string, time: string, duration: string): string {
  const p = phone.replace(/[^0-9]/g, '').slice(-10);
  const t = time.toLowerCase().trim();
  const d = duration.toLowerCase().trim().replace(/[^a-z0-9]/g, '');
  return `${p}_${t}_${d}`;
}

app.post("/api/verify-batch", async (req, res) => {
  try {
    const { acEmail, logs } = req.body;
    
    if (!acEmail || !logs || !Array.isArray(logs) || logs.length === 0) {
      return res.status(400).json({ error: "Missing email or logs array" });
    }

    // 1. Pack images into Gemini payload maintaining order
    const parts: any[] = [];
    for (const log of logs) {
      parts.push({
        inlineData: { 
          mimeType: "image/png", 
          data: log.base64Image.split(',')[1] || log.base64Image 
        }
      });
    }
    
    parts.push({
      text: `Analyze these ${logs.length} call log screenshots in the exact order they are provided.
      For each screenshot, extract:
      1. Phone Number: Strict E.164 format (e.g., +919876543210).
      2. Call Time: Exact time (e.g., 10:30 AM).
      3. Duration: Total duration in seconds as string (e.g., "320").
      Focus ONLY on the most recent or highlighted log in each image. 
      Return an array of ${logs.length} objects corresponding exactly to the provided images.`
    });

    const response = await ai.models.generateContent({
      model: "gemini-1.5-flash",
      contents: { parts },
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: { 
              phone: { type: Type.STRING }, 
              time: { type: Type.STRING }, 
              duration: { type: Type.STRING } 
            },
            required: ["phone", "time", "duration"]
          }
        }
      }
    });

    const text = response.text;
    if (!text) {
      throw new Error("Gemini returned empty response.");
    }
    
    const extractedArray = JSON.parse(text);
    if (!Array.isArray(extractedArray) || extractedArray.length !== logs.length) {
      throw new Error(`Gemini returned ${extractedArray?.length} results, expected ${logs.length}`);
    }

    // 2. Loop through and verify each against DB
    const results = [];

    const { data: allLogs, error: hashError } = await supabase
      .from("call_logs")
      .select("image_hash")
      .order('created_at', { ascending: false })
      .limit(500);

    for (let i = 0; i < logs.length; i++) {
      const log = logs[i];
      const extracted = extractedArray[i];
      const exactKey = createExactKey(extracted.phone, extracted.time, extracted.duration);
      
      let status = "ACCEPTED";
      let reason = null;
      let message = "Call log verified and stored successfully!";
      let logData = null;

      try {
        const { data: exactMatch } = await supabase
          .from("call_logs")
          .select("*")
          .eq("exact_key", exactKey)
          .maybeSingle();

        if (exactMatch) {
          status = "REJECTED";
          reason = "DUPLICATE_ENTRY";
          message = "This exact call (Phone + Time + Duration) has already been logged.";
        } else {
          const { data: fuzzyMatch } = await supabase
            .from("call_logs")
            .select("*")
            .eq("phone", extracted.phone)
            .eq("duration", extracted.duration)
            .limit(5);

          if (fuzzyMatch && fuzzyMatch.length > 0) {
            status = "REJECTED";
            reason = "LIKELY_DUPLICATE";
            message = "A very similar call with this phone number already exists in our records.";
          } else {
            const SIMILARITY_THRESHOLD = 10; 
            const similarLog = allLogs?.find(l => {
              if (!l.image_hash) return false;
              return calculateHammingDistance(log.imageHash, l.image_hash) <= SIMILARITY_THRESHOLD;
            });
            
            if (similarLog) {
              status = "REJECTED";
              reason = "IMAGE_REUSED";
              message = "This image (or a manipulated version) has been used recently.";
            } else {
              const { data: newLog, error: insertError } = await supabase
                .from("call_logs")
                .insert([{ 
                  ac_email: acEmail, 
                  phone: extracted.phone, 
                  call_time: extracted.time, 
                  duration: extracted.duration, 
                  image_hash: log.imageHash, 
                  exact_key: exactKey 
                }])
                .select()
                .single();
                
              if (insertError) throw insertError;
              logData = newLog;
              allLogs?.unshift({ image_hash: log.imageHash });
            }
          }
        }
      } catch (err: any) {
        status = "REJECTED";
        message = "Database error: " + err.message;
      }

      results.push({
        id: log.id,
        status,
        reason,
        message,
        extracted,
        log: logData
      });
    }

    res.json(results);

  } catch (error: any) {
    console.error("Batch Verification Error:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

app.get("/api/logs", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("call_logs")
      .select("*")
      .order("created_at", { ascending: false });
    res.json(data || []);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default app;
