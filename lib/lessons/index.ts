import { pictureLessons } from "@/lib/lessons/pictures"
import { pipelineLessons } from "@/lib/lessons/pipeline"
import { readingLessons } from "@/lib/lessons/reading"
import { stageLessons } from "@/lib/lessons/stages"
import type { Lesson } from "@/lib/lessons/types"

export const lessons: Lesson[] = [...readingLessons, ...stageLessons, ...pipelineLessons, ...pictureLessons]

export function chaptersOf(list: Lesson[]) {
  const chapters: { name: string; lessons: Lesson[] }[] = []
  for (const lesson of list) {
    const last = chapters[chapters.length - 1]
    if (!last || last.name !== lesson.chapter) chapters.push({ name: lesson.chapter, lessons: [lesson] })
    else last.lessons.push(lesson)
  }
  return chapters
}
