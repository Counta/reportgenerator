import {
  prepareWithSegments,
  layoutNextLineRange,
  materializeLineRange,
  type LayoutCursor,
} from '@chenglou/pretext'
import type { TableData } from '@/types'

/**
 * 「实验内容」正文排版的唯一来源：编辑器预览与导出都使用这里的结果，
 * 字体、字号、行高、区域与换行位置完全一致。
 */
export const CONTENT_FONT_FAMILY = '"SimSun", "Songti SC", "STSong", "SimSun-ExtB", serif'
export const CONTENT_FONT_SIZE = 16

/** 两页正文区域（PDF 点）与各自行高 */
export const CONTENT_PAGES = {
  1: { x: 91.7, y: 558, w: 675.1, h: 545, lineHeight: 545 / 22 },
  2: { x: 91.7, y: 98, w: 675.1, h: 680, lineHeight: 680 / 28 },
} as const

export interface PositionedLine {
  /** 用于绘制的文本（pretext 生成） */
  text: string
  x: number
  y: number
  width: number
  page: number
  /** 在规范化正文中的起止偏移（UTF-16），end 不含换行符 */
  start: number
  end: number
  /** 行高（PDF 点） */
  lineHeight: number
  /** 字号（PDF 点） */
  fontSize: number
}

/** 与 pretext 的 pre-wrap 规范化一致：\r\n、\r、\f 统一为 \n */
export function normalizeContentText(text: string): string {
  return /[\r\f]/.test(text) ? text.replace(/\r\n/g, '\n').replace(/[\r\f]/g, '\n') : text
}

type GraphemeSegmenter = { segment(s: string): Iterable<{ index: number }> }
const GraphemeSegmenterCtor = (
  Intl as unknown as {
    Segmenter: new (locale?: string, opts?: { granularity: 'grapheme' }) => GraphemeSegmenter
  }
).Segmenter
let graphemeSegmenter: GraphemeSegmenter | null = null

/** 字符串中每个字素的起始 UTF-16 偏移 */
export function graphemeStarts(s: string): number[] {
  graphemeSegmenter ??= new GraphemeSegmenterCtor(undefined, { granularity: 'grapheme' })
  const out: number[] = []
  for (const g of graphemeSegmenter.segment(s)) out.push(g.index)
  return out
}

/** pretext 光标（段 + 字素）-> 正文 UTF-16 偏移 */
function createCursorMapper(source: string, segments: string[]) {
  const starts: number[] = []
  let p = 0
  for (const seg of segments) {
    // 段文本按顺序覆盖正文；防御性地用 indexOf 对齐
    const idx = source.startsWith(seg, p) ? p : source.indexOf(seg, p)
    const at = idx >= 0 ? idx : p
    starts.push(at)
    p = at + seg.length
  }
  const cache = new Map<number, number[]>()
  return (c: LayoutCursor): number => {
    if (c.segmentIndex >= segments.length) return source.length
    const base = starts[c.segmentIndex]!
    if (c.graphemeIndex === 0) return base
    let g = cache.get(c.segmentIndex)
    if (!g) {
      g = graphemeStarts(segments[c.segmentIndex]!)
      cache.set(c.segmentIndex, g)
    }
    const seg = segments[c.segmentIndex]!
    return base + (c.graphemeIndex < g.length ? g[c.graphemeIndex]! : seg.length)
  }
}

export interface ExperimentContentLayout {
  page1Lines: PositionedLine[]
  page2Lines: PositionedLine[]
  hasTablesPage1: boolean
  hasTablesPage2: boolean
  isOverflow: boolean
  /** 规范化后的正文；行的 start/end 以此为准 */
  source: string
}

export interface ExperimentContentSplit {
  page1Lines: string[]
  page2Lines: string[]
  isOverflow: boolean
  layout: ExperimentContentLayout
  page1HasTable: boolean
  page2HasTable: boolean
}

/** 额外避让矩形（如电路图），PDF 点 */
export interface ObstacleRect {
  page: number
  x: number
  y: number
  w: number
  h: number
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

interface FlowContext {
  prep: ReturnType<typeof prepareWithSegments>
  fontSize: number
  source: string
  toOffset: (c: LayoutCursor) => number
  /** 正文为空或以换行结尾时，需要在末尾补一个空行承载光标 */
  needsTrailingLine: boolean
}

/** 去掉行尾的硬换行符，得到该行可见文本的结束偏移 */
function visibleEnd(source: string, start: number, end: number): number {
  return end > start && source.charCodeAt(end - 1) === 10 ? end - 1 : end
}

interface FlowBounds {
  x: number
  y: number
  w: number
  h: number
  lineHeight: number
}

function createFlowContext(text: string, fontSize: number): FlowContext {
  const source = normalizeContentText(text || '')
  const prep = prepareWithSegments(source, `${fontSize}px ${CONTENT_FONT_FAMILY}`, {
    whiteSpace: 'pre-wrap',
  })
  return {
    prep,
    fontSize,
    source,
    toOffset: createCursorMapper(source, prep.segments),
    needsTrailingLine: source.length === 0 || source.endsWith('\n'),
  }
}

function obstacleRectsForPage(tables: TableData[], extra: ObstacleRect[], page: number): Rect[] {
  const rects: Rect[] = tables
    .filter((t) => t.page === page)
    .map((t) => ({
      x: t.x,
      y: t.y,
      width: t.colWidths.reduce((a, b) => a + b, 0),
      height: t.rowHeights.reduce((a, b) => a + b, 0),
    }))
  for (const o of extra) {
    if (o.page === page) rects.push({ x: o.x, y: o.y, width: o.w, height: o.h })
  }
  return rects
}

/** 在一个矩形区域内逐行排版，避让 rects；返回本区域的行与续排光标 */
function layoutRegion(
  ctx: FlowContext,
  rects: Rect[],
  page: number,
  bounds: FlowBounds,
  startCursor: LayoutCursor,
): { lines: PositionedLine[]; nextCursor: LayoutCursor; finished: boolean } {
  const lineH = bounds.lineHeight
  const baseInterval: Interval = { left: bounds.x, right: bounds.x + bounds.w }
  const lines: PositionedLine[] = []
  let cursor = startCursor
  let lineTop = bounds.y
  let finished = false

  while (lineTop + lineH <= bounds.y + bounds.h + 2) {
    const blocked = getRectIntervalsForBand(rects, lineTop, lineTop + lineH, OBSTACLE_PAD, 4)
    // 元素把一行切成左右两段时只用最宽的一段（并列时取左侧）。
    // 若两段都填字，阅读顺序会在元素两侧来回跳，看起来像被分成了多个文本框。
    const slots = carveTextLineSlots(baseInterval, blocked)
      .reduce<Interval[]>((best, s) =>
        best.length === 0 || s.right - s.left > best[0]!.right - best[0]!.left + 0.01 ? [s] : best, [])
    for (const slot of slots) {
      const range = layoutNextLineRange(ctx.prep, cursor, slot.right - slot.left)
      if (range === null) {
        finished = true
        if (ctx.needsTrailingLine) {
          const len = ctx.source.length
          lines.push({
            text: '',
            x: slot.left,
            y: lineTop,
            width: 0,
            page,
            start: len,
            end: len,
            lineHeight: lineH,
            fontSize: ctx.fontSize,
          })
        }
        break
      }

      const materialized = materializeLineRange(ctx.prep, range)
      const start = ctx.toOffset(range.start)
      lines.push({
        text: materialized.text,
        x: slot.left,
        y: lineTop,
        width: materialized.width,
        page,
        start,
        end: visibleEnd(ctx.source, start, ctx.toOffset(range.end)),
        lineHeight: lineH,
        fontSize: ctx.fontSize,
      })
      cursor = range.end
    }

    if (finished) break
    lineTop += lineH
  }

  return { lines, nextCursor: cursor, finished }
}

/**
 * 「实验内容」排版：第 1 页排满后接续到第 2 页，并避让表格 / 电路图 / 图片。
 * 预览（PageEditor）与导出（exporter）都调用此函数，保证结果一致。
 */
export function splitExperimentContent(
  fullText: string,
  tables: TableData[] = [],
  extra: ObstacleRect[] = [],
): ExperimentContentSplit {
  const ctx = createFlowContext(fullText, CONTENT_FONT_SIZE)
  const source = ctx.source
  const start: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }

  const p1Res = layoutRegion(ctx, obstacleRectsForPage(tables, extra, 1), 1, CONTENT_PAGES[1], start)
  const p2Res = p1Res.finished
    ? { lines: [] as PositionedLine[], nextCursor: p1Res.nextCursor, finished: true }
    : layoutRegion(ctx, obstacleRectsForPage(tables, extra, 2), 2, CONTENT_PAGES[2], p1Res.nextCursor)

  const isOverflow = !p1Res.finished && p2Res.lines.length > 0
  const layout: ExperimentContentLayout = {
    page1Lines: p1Res.lines,
    page2Lines: p2Res.lines,
    hasTablesPage1: tables.some((t) => t.page === 1),
    hasTablesPage2: tables.some((t) => t.page === 2),
    isOverflow,
    source,
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

/** 多行文本框（实验目的 / 实验器材 / 问题讨论）的字号范围与行距 */
export const FIELD_FONT_MAX = 16
export const FIELD_FONT_MIN = 10
export const FIELD_LINE_HEIGHT_RATIO = 1.5

/** 使用 layoutFieldText 排版的多行框（「实验内容」两页走 splitExperimentContent） */
export function isFlowField(f: { id: string; type: string }): boolean {
  return f.type === 'textarea' && f.id !== 'content' && f.id !== 'contentContinuation'
}

export interface FieldTextLayout {
  lines: PositionedLine[]
  /** 规范化后的文本；行的 start/end 以此为准 */
  source: string
  fontSize: number
  /** 最小字号下仍放不下：超出部分不显示、不导出 */
  isOverflow: boolean
}

/**
 * 多行文本框排版：左上对齐，从 16pt 起按 0.5pt 递减，取能完整放下的最大字号（最小 10pt）。
 * 预览与导出共用此结果。
 */
export function layoutFieldText(
  text: string,
  page: number,
  rect: { x: number; y: number; w: number; h: number },
): FieldTextLayout {
  const start: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 }
  let last: FieldTextLayout | null = null
  for (let size = FIELD_FONT_MAX; size >= FIELD_FONT_MIN; size -= 0.5) {
    const ctx = createFlowContext(text, size)
    const res = layoutRegion(ctx, [], page, { ...rect, lineHeight: size * FIELD_LINE_HEIGHT_RATIO }, start)
    // 恰好排满最后一行时循环不会遇到“无下一行”，这里补判是否已全部放下
    const finished =
      res.finished ||
      (!ctx.needsTrailingLine && layoutNextLineRange(ctx.prep, res.nextCursor, rect.w) === null)
    last = { lines: res.lines, source: ctx.source, fontSize: size, isOverflow: !finished }
    if (finished) return last
  }
  return last!
}

export function calcCellFontSizePt(
  text: string,
  colWidthPt: number,
  rowHeightPt: number,
  /** 决定基础字号的行高；合并单元格传单行高度，避免字号随合并高度放大 */
  baseRowHeightPt: number = rowHeightPt,
): number {
  const baseSize = Math.max(7, Math.min(16, baseRowHeightPt * 0.48))
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
