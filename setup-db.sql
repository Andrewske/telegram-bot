-- Personal Historian Bot Database Setup
-- Run this script on your CloudClusters Postgres database

-- Create the state table for tracking user check-in scheduling
CREATE TABLE IF NOT EXISTS state (
  id SERIAL PRIMARY KEY,
  user_id BIGINT UNIQUE NOT NULL,
  next_checkin_at TIMESTAMPTZ NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Create index for efficient check-in queries
CREATE INDEX IF NOT EXISTS idx_state_next_checkin
ON state(next_checkin_at)
WHERE next_checkin_at <= NOW();

-- Create updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
DROP TRIGGER IF EXISTS update_state_updated_at ON state;
CREATE TRIGGER update_state_updated_at
    BEFORE UPDATE ON state
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Display table info
\d state;

-- Example query to test
-- SELECT * FROM state WHERE next_checkin_at <= NOW();