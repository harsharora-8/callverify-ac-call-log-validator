import express from "express";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(express.json({ limit: '10mb' }));

// Supabase Init
const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("CRITICAL: Supabase environment variables are missing! Please set SUPABASE_URL and SUPABASE_ANON_KEY in your secrets.");
}

const supabase = createClient(supabaseUrl, supabaseKey);

// Hamming distance helper for hex segments
function calculateHammingDistance(h1: string, h2: string): number {
  if (h1.length !== h2.length) return 999;
  let distance = 0;
  for (let i = 0; i < h1.length; i++) {
    const v1 = parseInt(h1[i], 16);
    const v2 = parseInt(h2[i], 16);
    let xor = v1 ^ v2;
    // Count set bits
    while (xor > 0) {
      if (xor & 1) distance++;
      xor >>= 1;
    }
  }
  return distance;
}

// API Routes
app.post("/api/verify-log", async (req, res) => {
  try {
    const { acEmail, phone, callTime, duration, imageHash, exactKey } = req.body;

    if (!acEmail || !phone || !callTime || !duration || !imageHash || !exactKey) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 1. Exact Match Check (DB side)
    const { data: exactMatch, error: exactError } = await supabase
      .from("call_logs")
      .select("*")
      .eq("exact_key", exactKey)
      .maybeSingle();

    if (exactError) {
      if (exactError.code === 'PGRST116' || exactError.message.includes('relation "call_logs" does not exist')) {
        return res.status(500).json({ 
          error: "Database Table Missing", 
          message: "Please run the SQL in SCHEMA.sql in your Supabase SQL Editor to create the call_logs table." 
        });
      }
      throw exactError;
    }
    if (exactMatch) {
      return res.json({ 
        status: "REJECTED", 
        reason: "DUPLICATE_ENTRY", 
        message: "This exact call (Phone + Time + Duration) has already been logged." 
      });
    }

    // 2. Fuzzy Match Check (Same phone + close time/duration)
    const { data: fuzzyMatch, error: fuzzyError } = await supabase
      .from("call_logs")
      .select("*")
      .eq("phone", phone)
      .eq("duration", duration)
      .limit(5);

    if (fuzzyError) throw fuzzyError;
    if (fuzzyMatch && fuzzyMatch.length > 0) {
      return res.json({ 
        status: "REJECTED", 
        reason: "LIKELY_DUPLICATE", 
        message: "A very similar call with this phone number already exists in our records." 
      });
    }

    // 3. Advanced Image Similarity Check (Hamming Distance)
    const { data: allLogs, error: hashError } = await supabase
      .from("call_logs")
      .select("image_hash")
      .order('created_at', { ascending: false })
      .limit(200);

    if (hashError) throw hashError;
    
    const SIMILARITY_THRESHOLD = 10; 
    
    const similarLog = allLogs?.find(log => {
      if (!log.image_hash) return false;
      const dist = calculateHammingDistance(imageHash, log.image_hash);
      return dist <= SIMILARITY_THRESHOLD;
    });

    if (similarLog) {
      return res.json({ 
        status: "REJECTED", 
        reason: "IMAGE_REUSED", 
        message: "This image (or a manipulated version) has been used recently. Please upload a fresh screenshot." 
      });
    }

    // 4. Accept Entry
    const { data: newLog, error: insertError } = await supabase
      .from("call_logs")
      .insert([
        { 
          ac_email: acEmail, 
          phone, 
          call_time: callTime, 
          duration, 
          image_hash: imageHash, 
          exact_key: exactKey 
        }
      ])
      .select()
      .single();

    if (insertError) throw insertError;

    res.json({ 
      status: "ACCEPTED", 
      message: "Call log verified and stored successfully!",
      log: newLog
    });

  } catch (error: any) {
    console.error("Verification Error:", error);
    res.status(500).json({ error: error.message || "Internal Server Error" });
  }
});

app.get("/api/logs", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("call_logs")
      .select("*")
      .order("created_at", { ascending: false });
    
    if (error) {
      console.error("Supabase Error:", error);
      const isMissingTable = 
        error.code === 'PGRST116' || 
        error.message.includes('relation "call_logs" does not exist') ||
        error.message.includes('schema cache') ||
        error.message.includes('not found');

      const message = isMissingTable
        ? "The 'call_logs' table was not found. Please run the SQL from SCHEMA.sql in your Supabase dashboard."
        : error.message;
      return res.status(500).json({ error: message, code: error.code });
    }
    
    res.json(data || []);
  } catch (err: any) {
    console.error("Server Error in /api/logs:", err);
    res.status(500).json({ error: err.message || "Internal Server Error" });
  }
});

export default app;
