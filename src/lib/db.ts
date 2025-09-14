import { Pool } from 'pg';

let pool: Pool | null = null;

export function getDB(): Pool {
  if (!pool) {
    const DATABASE_URL = process.env.DATABASE_URL;
    if (!DATABASE_URL) {
      throw new Error('DATABASE_URL environment variable is required');
    }

    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });
  }

  return pool;
}

export interface UserState {
  id: number;
  user_id: bigint;
  next_checkin_at: Date;
  timezone: string;
}

export async function getUserState(telegramUserId: string): Promise<UserState | null> {
  const db = getDB();
  const result = await db.query(
    'SELECT * FROM state WHERE user_id = $1',
    [telegramUserId]
  );
  return result.rows[0] || null;
}

export async function upsertUserState(
  telegramUserId: string,
  nextCheckinAt: Date,
  timezone: string = process.env.TZ_DEFAULT || 'America/Los_Angeles'
): Promise<void> {
  const db = getDB();
  await db.query(`
    INSERT INTO state (user_id, next_checkin_at, timezone)
    VALUES ($1, $2, $3)
    ON CONFLICT (user_id)
    DO UPDATE SET next_checkin_at = $2, timezone = $3
  `, [telegramUserId, nextCheckinAt, timezone]);
}

export async function getDueCheckins(): Promise<UserState[]> {
  const db = getDB();
  const result = await db.query(
    'SELECT * FROM state WHERE next_checkin_at <= NOW()'
  );
  return result.rows;
}

export async function updateNextCheckin(telegramUserId: string, nextCheckinAt: Date): Promise<void> {
  const db = getDB();
  await db.query(
    'UPDATE state SET next_checkin_at = $1 WHERE user_id = $2',
    [nextCheckinAt, telegramUserId]
  );
}