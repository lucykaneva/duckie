import { getPool } from "./client.ts";
import {
  SEED_CONCEPTS,
  SEED_COURSE,
  SEED_SECTION,
  SEED_USER,
} from "./seed-data.ts";

// Idempotent: safe to run more than once.
async function seed() {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(
      `INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`,
      [SEED_USER.id, SEED_USER.name],
    );
    await client.query(
      `INSERT INTO courses (id, user_id, name) VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name`,
      [SEED_COURSE.id, SEED_COURSE.userId, SEED_COURSE.name],
    );
    await client.query(
      `INSERT INTO sections (id, course_id, name, type) VALUES ($1, $2, $3, $4)
       ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, type = EXCLUDED.type`,
      [SEED_SECTION.id, SEED_SECTION.courseId, SEED_SECTION.name, SEED_SECTION.type],
    );

    for (const c of SEED_CONCEPTS) {
      await client.query(
        `INSERT INTO concepts
           (id, section_id, topic, name, slide, kind, misconceptions, check_prompt, fallback_questions, plants_misconception)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::jsonb, $10)
         ON CONFLICT (id) DO UPDATE SET
           topic = EXCLUDED.topic, name = EXCLUDED.name, slide = EXCLUDED.slide,
           kind = EXCLUDED.kind, misconceptions = EXCLUDED.misconceptions,
           check_prompt = EXCLUDED.check_prompt,
           plants_misconception = EXCLUDED.plants_misconception,
           fallback_questions = EXCLUDED.fallback_questions`,
        [
          c.id,
          SEED_SECTION.id,
          c.topic,
          c.name,
          c.slide,
          c.kind,
          JSON.stringify(c.misconceptions),
          c.checkPrompt,
          JSON.stringify(c.fallbackQuestions),
          c.plantsMisconception === true,
        ],
      );

      if (c.secret) {
        await client.query(
          `INSERT INTO concept_secrets (concept_id, reference_code, expected_answer)
           VALUES ($1, $2, $3)
           ON CONFLICT (concept_id) DO UPDATE SET
             reference_code = EXCLUDED.reference_code,
             expected_answer = EXCLUDED.expected_answer`,
          [c.id, c.secret.referenceCode, c.secret.expectedAnswer],
        );
      } else {
        await client.query(`DELETE FROM concept_secrets WHERE concept_id = $1`, [c.id]);
      }
    }

    await client.query("COMMIT");
    console.log(`Seeded ${SEED_CONCEPTS.length} concepts into ${SEED_SECTION.id}.`);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
