import type {
  Concept,
  Course,
  DuckMove,
  Section,
  SectionType,
  SessionResults,
  SessionStart,
  UploadJob,
} from "@/lib/duck/types";

export type UploadStatus = UploadJob;

async function request<T>(path: string, action: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers: {
        Accept: "application/json",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
    });
  } catch {
    throw new Error(`Couldn't ${action}. The server didn't respond.`);
  }

  if (!response.ok) {
    throw await errorFor(response, action);
  }

  try {
    return (await response.json()) as T;
  } catch {
    throw new Error(`Couldn't ${action}. The response wasn't valid.`);
  }
}

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

async function errorFor(response: Response, action: string): Promise<ApiError> {
  let detail = "";
  let code: string | undefined;
  try {
    const body = (await response.json()) as { error?: unknown; message?: unknown; code?: unknown };
    if (typeof body.error === "string") detail = ` ${body.error}`;
    else if (typeof body.message === "string") detail = ` ${body.message}`;
    if (typeof body.code === "string") code = body.code;
  } catch {
    // The body wasn't JSON.
  }
  return new ApiError(`Couldn't ${action} (${response.status}).${detail}`, response.status, code);
}

export function isTooManyPagesError(error: unknown): boolean {
  if (error instanceof ApiError && error.code === "too_many_pages") return true;
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  return (
    message.includes("too_many_pages") ||
    (/\bhas \d+ pages\b/.test(message) && message.includes("limit"))
  );
}

export async function getCourses(): Promise<Course[]> {
  const courses = await request<Course[]>("/api/courses", "load courses");
  if (!Array.isArray(courses)) {
    throw new Error("Couldn't load courses. The response wasn't a list.");
  }
  return courses;
}

export async function createCourse(name: string): Promise<Course> {
  return request<Course>("/api/courses", "create the course", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export async function getSections(courseId: string): Promise<Section[]> {
  const path = `/api/courses/${encodeURIComponent(courseId)}/sections`;
  let response: Response;
  try {
    response = await fetch(path, { headers: { Accept: "application/json" } });
  } catch {
    throw new Error("Couldn't load sections. The server didn't respond.");
  }

  // TODO: remove this fallback once GET /api/courses/:id/sections exists.
  // The route only implements POST today, so Next answers 405. Treat that,
  // and a real 404, as "not built yet".
  if (response.status === 404 || response.status === 405) {
    return [
      { id: "sec_midterm", courseId, name: "Midterm", type: "test" },
      { id: "sec_final", courseId, name: "Final project", type: "project" },
    ];
  }

  if (!response.ok) {
    throw await errorFor(response, "load sections");
  }

  try {
    const sections = (await response.json()) as Section[];
    if (!Array.isArray(sections)) {
      throw new Error("not a list");
    }
    return sections;
  } catch {
    throw new Error("Couldn't load sections. The response wasn't a list.");
  }
}

export async function createSection(
  courseId: string,
  name: string,
  type: SectionType,
): Promise<Section> {
  return request<Section>(`/api/courses/${encodeURIComponent(courseId)}/sections`, "create the section", {
    method: "POST",
    body: JSON.stringify({ name, type }),
  });
}

export async function uploadFiles(sectionId: string, files: File[]): Promise<UploadStatus> {
  const form = new FormData();
  // The live route reads one file from the field named "file".
  const file = files[0];
  if (file) form.append("file", file, file.name);

  let response: Response;
  try {
    // The browser sets the multipart boundary, so no Content-Type here.
    response = await fetch(`/api/sections/${encodeURIComponent(sectionId)}/upload`, {
      method: "POST",
      headers: { Accept: "application/json" },
      body: form,
    });
  } catch {
    throw new Error("Couldn't send the files. The server didn't respond.");
  }

  if (!response.ok) {
    throw await errorFor(response, "send the files");
  }

  try {
    return (await response.json()) as UploadStatus;
  } catch {
    throw new Error("Couldn't send the files. The response wasn't valid.");
  }
}

export async function getUploadStatus(sectionId: string): Promise<UploadStatus | null> {
  let response: Response;
  try {
    response = await fetch(`/api/sections/${encodeURIComponent(sectionId)}/upload`, {
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new Error("Couldn't check the upload. The server didn't respond.");
  }

  // Nothing uploaded yet.
  if (response.status === 404) return null;

  if (!response.ok) {
    throw await errorFor(response, "check the upload");
  }

  try {
    return (await response.json()) as UploadStatus;
  } catch {
    throw new Error("Couldn't check the upload. The response wasn't valid.");
  }
}

const FALLBACK_CONCEPTS: Concept[] = [
  {
    id: "c_12",
    topic: "Binary search",
    name: "Sorted input",
    slide: 4,
    kind: "explain",
    misconceptions: ["Binary search works on any list"],
  },
  {
    id: "c_13",
    topic: "Binary search",
    name: "Halving",
    slide: 5,
    kind: "explain",
    misconceptions: [],
  },
];

export async function getConcepts(sectionId: string): Promise<Concept[]> {
  try {
    const concepts = await request<Concept[]>(
      `/api/sections/${encodeURIComponent(sectionId)}/concepts`,
      "load concepts",
    );
    if (!Array.isArray(concepts)) {
      throw new Error("Couldn't load concepts. The response wasn't a list.");
    }
    return concepts;
  } catch {
    // Fall through to the stub list.
  }

  // TODO: remove this fallback once GET /api/sections/:id/concepts can
  // return concepts without a live database.
  return FALLBACK_CONCEPTS.map((concept) => ({ ...concept }));
}

export async function startSession(
  sectionId: string,
  topic: string,
  confidence: number,
): Promise<SessionStart> {
  try {
    return await request<SessionStart>("/api/sessions", "start the session", {
      method: "POST",
      body: JSON.stringify({ sectionId, topic, confidence }),
    });
  } catch {
    // TODO: remove this fallback once POST /api/sessions works without a live
    // database. The session screen only needs a sessionId to open.
    return {
      sessionId: "s_demo",
      topic,
      confidence,
      move: {
        kind: "open",
        level: "L0",
        conceptId: "c_12",
        line: "Ooh! Can you explain it to me? I'm just a duck.",
        sessionState: "active",
        concepts: [{ id: "c_12", state: "not_yet", score: 0 }],
      },
    };
  }
}

export async function endSession(sessionId: string, reason: string): Promise<DuckMove> {
  return request<DuckMove>(
    `/api/sessions/${encodeURIComponent(sessionId)}/end`,
    "end the session",
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

export async function getResults(sessionId: string): Promise<SessionResults> {
  return request<SessionResults>(
    `/api/sessions/${encodeURIComponent(sessionId)}/results`,
    "load the results",
  );
}
