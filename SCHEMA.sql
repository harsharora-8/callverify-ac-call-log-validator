-- TABLE: call_logs
-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS call_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    ac_email TEXT NOT NULL,
    phone TEXT NOT NULL,
    call_time TEXT NOT NULL,
    duration TEXT NOT NULL,
    image_hash TEXT NOT NULL,
    exact_key TEXT NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);


-- Index for hashing check
CREATE INDEX IF NOT EXISTS idx_image_hash ON call_logs(image_hash);

-- Index for phone check
CREATE INDEX IF NOT EXISTS idx_phone ON call_logs(phone);

-- Enable RLS
ALTER TABLE call_logs ENABLE ROW LEVEL SECURITY;

-- Allow anonymous select for demo (optional)
CREATE POLICY "Allow public select" ON call_logs FOR SELECT USING (true);

-- Allow anonymous insert for demo (optional, but backend uses service role)
CREATE POLICY "Allow public insert" ON call_logs FOR INSERT WITH CHECK (true);
