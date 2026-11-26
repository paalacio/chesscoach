// The notes of the imported courses, for whoever needs them (analysis Explain, the
// trainer, "why" answers). The repertoire store fills this in when it loads; it's a
// plain module so the stores don't have to import each other.

import { annotationOn, type CourseAnnotation, courseContextFor, indexAnnotations, type LoadedCourse } from "../core/course";
import type { CourseContext } from "../core/context-packet";

let courses: LoadedCourse[] = [];

/** Replaces the loaded courses (one per repertoire that came from a course). */
export function setCourses(list: { repertoireId: number; title: string; annotations: CourseAnnotation[] }[]) {
  courses = list.filter((c) => c.annotations.length > 0).map((c) => ({ repertoireId: c.repertoireId, title: c.title, index: indexAnnotations(c.annotations) }));
}

export const loadedCourses = (): LoadedCourse[] => courses;

/** What the courses say about a position (and a move), for Claude's packet. */
export function courseContext(fen: string, played?: { fenBefore: string; uci: string }): CourseContext | null {
  return courseContextFor(courses, fen, played);
}

/** The author's comment on a move, preferring the given repertoire's course. */
export function courseNoteOn(fen: string, uci: string, repertoireId?: number | null): { title: string; note: CourseAnnotation } | null {
  const ordered = [...courses].sort((a, b) => Number(b.repertoireId === repertoireId) - Number(a.repertoireId === repertoireId));
  for (const c of ordered) {
    const note = annotationOn(c.index, fen, uci);
    if (note?.comment) return { title: c.title, note };
  }
  return null;
}
