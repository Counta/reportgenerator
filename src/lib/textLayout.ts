import {
  prepareWithSegments,
  layoutNextLineRange,
  materializeLineRange,
  type LayoutCursor,
} from '@chenglou/pretext'
import type { TableData } from '@/types'

const FONT_FAMILY = '"SimSun", "Songti SC", "STSong", "SimSun-ExtB", serif'

export interface PositionedLine {
  text: string
  x: number
  y: number
  width: number
  page: number
}

export interface ExperimentContentLayout {
  page1Lines: PositionedLine[]
  page2Lines: PositionedLine[]
  hasTablesPage1: boolean
  hasTablesPage2: boolean
  isOverflow: boolean
}

export interface ExperimentContentSplit {
  page1Lines: string[]
  page2Lines: string[]
  isOverflow: boolean
  layout: ExperimentContentLayout
  page1HasTable: boolean
  page2HasTable: boolean
}

interface Interval {
  left: number
  right: number
}

interface Rect {
  x: number
  y: number
  width: number
  height: number
}

const MIN_SLOT_WIDTH = 42
const OBSTACLE_PAD = 8

function getRectIntervalsForBand(
  rects: Rect[],
  bandTop: number,
  bandBottom: number,
  hPad: number,
  vPad: number,
): Interval[] {
  const intervals: Interval[] = []
  for (let i = 0; i < rects.length; i++) {
    const r = rects[i]!
    if (
      bandBottom <= r.y - vPad ||
      bandTop >= r.y + r.height + vPad
    ) {
      continue
    }
    intervals.push({
      left: r.x - hPad,
      right: r.x + r.width + hPad,
    })
  }
  return intervals
}

function carveTextLineSlots(
  base: Interval,
  blocked: Interval[],
  minW = MIN_SLOT_WIDTH,
): Interval[] {
  let slots: Interval[] = [base]
  for (let i = 0; i < blocked.length; i++) {
    const b = blocked[i]!
    const next: Interval[] = []
    for (let j = 0; j < slots.length; j++) {
      const s = slots[j]!
      if (b.right <= s.left || b.left >= s.right) {
        next.push(s)
        continue
      }
      if (b.left > s.left) next.push({ left: s.left, right: b.left })
      if (b.right < s.right) next.push({ left: b.right, right: s.right })
    }
    slots = next
  }
  return slots.filter((s) => s.right - s.left >= minW)
}

function layoutPageWithPretext(
  prep: ReturnType<typeof prepareWithSegments>,
  tables: TableData[],
  page: number,
  bounds: { x: number; y: number; w: number; h: number },
  lineH: number,
  startCursor: LayoutCursor,
): { lines: PositionedLine[]; nextCursor: LayoutCursor; finished: boolean } {
  const pageTables = tables.filter((t) => t.page === page)
  const rects: Rect[] = pageTables.map((t) => ({
    x: t.x,
    y: t.y,
    width: t.colWidths.reduce((a, b) => a + b, 0),
    height: t.rowHeights.reduce((a, b) => a + b, 0),
  }))

  const baseInterval: Interval = {
    left: bounds.x,
    right: bounds.x + bounds.w,
  }

  const lines: PositionedLine[] = []
  let cursor = startCursor
  let lineTop = bounds.y
  let finished = false

  while (lineTop + lineH <= bounds.y + bounds.h + 2) {
    const bandTop = lineTop
    const bandBottom = lineTop + lineH

    const blocked = getRectIntervalsForBand(
      rects,
      bandTop,
      bandBottom,
      OBSTACLE_PAD,
      4,
    )

    const slots = carveTextLineSlots(baseInterval, blocked)
    if (slots.length === 0) {
      lineTop += lineH
      continue
    }

    let filledAny = false
    for (const slot of slots) {
      const slotWidth = slot.right - slot.left
      const range = layoutNextLineRange(prep, cursor, slotWidth)
      if (range === null) {
        finished = true
        break
      }

      const materialized = materializeLineRange(prep, range)
      lines.push({
        text: materialized.text,
        x: slot.left,
        y: lineTop,
        width: materialized.width,
        page,
      })

      cursor = range.end
      filledAny = true
    }

    if (finished) break
    if (!filledAny) {
      lineTop += lineH
      continue
    }

    lineTop += lineH
  }

  return { lines, nextCursor: cursor, finished }
}

export function splitExperimentContent(
  fullText: string,
  maxWidthPt = 675.1,
  fontSizePt = 16,
  tables: TableData[] = [],
): ExperimentContentSplit {
  if (!fullText || fullText.trim() === '') {
    const emptyLayout: ExperimentContentLayout = {
      page1Lines: [],
      page2Lines: [],
      hasTablesPage1: tables.some((t) => t.page === 1),
      hasTablesPage2: tables.some((t) => t.page === 2),
      isOverflow: false,
    }
    return {
      page1Lines: [],
      page2Lines: [],
      isOverflow: false,
      layout: emptyLayout,
      page1HasTable: emptyLayout.hasTablesPage1,
      page2HasTable: emptyLayout.hasTablesPage2,
    }
  }

  const font = `${fontSizePt}px ${FONT_FAMILY}`
  const prep = prepareWithSegments(fullText, font, {
    whiteSpace: 'pre-wrap',
  })

  const p1Bounds = { x: 91.7, y: 558, w: maxWidthPt, h: 545 }
  const p1LineH = 545 / 22

  const p1Res = layoutPageWithPretext(
    prep,
    tables,
    1,
    p1Bounds,
    p1LineH,
    { segmentIndex: 0, graphemeIndex: 0 },
  )

  const p2Bounds = { x: 91.7, y: 98, w: maxWidthPt, h: 680 }
  const p2LineH = 680 / 28

  const p2Res = p1Res.finished
    ? { lines: [], nextCursor: p1Res.nextCursor, finished: true }
    : layoutPageWithPretext(
        prep,
        tables,
        2,
        p2Bounds,
        p2LineH,
        p1Res.nextCursor,
      )

  const isOverflow = !p1Res.finished && p2Res.lines.length > 0
  const layout: ExperimentContentLayout = {
    page1Lines: p1Res.lines,
    page2Lines: p2Res.lines,
    hasTablesPage1: tables.some((t) => t.page === 1),
    hasTablesPage2: tables.some((t) => t.page === 2),
    isOverflow,
  }

  return {
    page1Lines: p1Res.lines.map((l) => l.text),
    page2Lines: p2Res.lines.map((l) => l.text),
    isOverflow,
    layout,
    page1HasTable: layout.hasTablesPage1,
    page2HasTable: layout.hasTablesPage2,
  }
}

export function calcCellFontSizePt(
  text: string,
  colWidthPt: number,
  rowHeightPt: number,
): number {
  const baseSize = Math.max(7, Math.min(16, rowHeightPt * 0.48))
  if (!text || text.trim() === '') {
    return Math.round(baseSize * 10) / 10
  }

  const availW = Math.max(8, colWidthPt - 6)
  const availH = Math.max(8, rowHeightPt - 4)
  const lines = text.split('\n')

  const emOf = (s: string) => {
    let em = 0
    for (const ch of s) {
      em += ch.charCodeAt(0) > 255 ? 1.0 : 0.58
    }
    return Math.max(em, 0.6)
  }

  const maxLineEm = lines.reduce((max, l) => Math.max(max, emOf(l)), 0)

  let size = baseSize
  if (maxLineEm * size > availW) {
    size = availW / maxLineEm
  }

  const lineCount = lines.length
  const totalHNeeded = lineCount * size * 1.3
  if (totalHNeeded > availH) {
    size = availH / (lineCount * 1.3)
  }

  const clamped = Math.max(6.5, Math.min(16, size))
  return Math.round(clamped * 10) / 10
}
