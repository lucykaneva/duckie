import type { PoolClient } from "pg";
import type { DuckConfig } from "../duck/config";
import type { Profile } from "../duck/types";
import { DEMO_USER_ID } from "../duck/types";
import { emptyProfile } from "../engine/profile";
import { getPool } from "./client";

type Queryable = Pick<PoolClient, "query">;

interface ProfileRow {
  user_id: string;
  calibration: string | null;
  pace: string | null;
  nagginess: string | null;
  teaching_habits: unknown;
  tone: string | null;
  config_overrides: unknown;
  duck_learned: unknown;
  updated_at: Date;
}

function asStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function asOverrides(value: unknown): Partial<DuckConfig> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Partial<DuckConfig>) : {};
}

function fromRow(row: ProfileRow): Profile {
  return {
    userId: row.user_id,
    calibration: row.calibration ?? "",
    pace: row.pace ?? "",
    nagginess: row.nagginess ?? "",
    teachingHabits: asStringList(row.teaching_habits),
    tone: row.tone ?? "",
    configOverrides: asOverrides(row.config_overrides),
    duckLearned: asStringList(row.duck_learned),
    updatedAt: row.updated_at.toISOString(),
  };
}

export async function getLearnerProfile(userId = DEMO_USER_ID, client?: Queryable): Promise<Profile> {
  const db = client ?? getPool();
  const { rows } = await db.query<ProfileRow>(
    `SELECT user_id, calibration, pace, nagginess, teaching_habits, tone, config_overrides, duck_learned, updated_at
       FROM learner_profile WHERE user_id = $1`,
    [userId],
  );
  return rows[0] ? fromRow(rows[0]) : emptyProfile(userId);
}

export async function saveLearnerProfile(profile: Profile, client?: Queryable): Promise<void> {
  const db = client ?? getPool();
  await db.query(
    `INSERT INTO learner_profile
       (user_id, calibration, pace, nagginess, teaching_habits, tone, config_overrides, duck_learned, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb, $9::timestamptz)
     ON CONFLICT (user_id) DO UPDATE SET
       calibration = EXCLUDED.calibration,
       pace = EXCLUDED.pace,
       nagginess = EXCLUDED.nagginess,
       teaching_habits = EXCLUDED.teaching_habits,
       tone = EXCLUDED.tone,
       config_overrides = EXCLUDED.config_overrides,
       duck_learned = EXCLUDED.duck_learned,
       updated_at = EXCLUDED.updated_at`,
    [
      profile.userId,
      profile.calibration,
      profile.pace,
      profile.nagginess,
      JSON.stringify(profile.teachingHabits),
      profile.tone,
      JSON.stringify(profile.configOverrides),
      JSON.stringify(profile.duckLearned),
      profile.updatedAt,
    ],
  );
}
