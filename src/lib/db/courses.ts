import { randomUUID } from "node:crypto";
import type { Course, Section, SectionType } from "../duck/types";
import { DEMO_USER_ID } from "../duck/types";
import { getPool } from "./client";

export async function listCourses(userId: string = DEMO_USER_ID): Promise<Course[]> {
  const { rows } = await getPool().query<Course>(
    `SELECT id, user_id AS "userId", name
       FROM courses
      WHERE user_id = $1
      ORDER BY name, id`,
    [userId],
  );
  return rows;
}

export async function createCourse(name: string, userId: string = DEMO_USER_ID): Promise<Course> {
  const pool = getPool();
  await pool.query(`INSERT INTO users (id, name) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING`, [
    userId,
    "Demo student",
  ]);
  const id = `course_${randomUUID().slice(0, 8)}`;
  const { rows } = await pool.query<Course>(
    `INSERT INTO courses (id, user_id, name) VALUES ($1, $2, $3)
     RETURNING id, user_id AS "userId", name`,
    [id, userId, name],
  );
  return rows[0];
}

export async function courseExists(courseId: string): Promise<boolean> {
  const { rowCount } = await getPool().query(`SELECT 1 FROM courses WHERE id = $1`, [courseId]);
  return (rowCount ?? 0) > 0;
}

export async function listSections(courseId: string): Promise<Section[]> {
  const { rows } = await getPool().query<Section>(
    `SELECT id, course_id AS "courseId", name, type
       FROM sections
      WHERE course_id = $1
      ORDER BY name, id`,
    [courseId],
  );
  return rows;
}

export async function createSection(
  courseId: string,
  name: string,
  type: SectionType,
): Promise<Section | null> {
  if (!(await courseExists(courseId))) return null;
  const id = `sec_${randomUUID().slice(0, 8)}`;
  const { rows } = await getPool().query<Section>(
    `INSERT INTO sections (id, course_id, name, type) VALUES ($1, $2, $3, $4)
     RETURNING id, course_id AS "courseId", name, type`,
    [id, courseId, name, type],
  );
  return rows[0];
}
