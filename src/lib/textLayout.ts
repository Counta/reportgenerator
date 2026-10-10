/**
 * 文本排版与分页拆分工具
 * 用于处理第一页「实验内容」在溢出时，自动续接到第二页「问题讨论」之上
 */

let offscreenCtx: CanvasRenderingContext2D | null = null

function getMeasureCtx(): CanvasRenderingContext2D | null {
  if (typeof document === 'undefined') return null
  if (!offscreenCtx) {
    const canvas = document.createElement('canvas')
    offscreenCtx = canvas.getContext('2d')
  }
  return offscreenCtx
}

/** 估算字符宽度（用于无 canvas 环境的回退） */
function estimateWidth(str: string, fontSize: number): number {
  let w = 0
  for (const ch of str) {
    w += ch.charCodeAt(0) > 255 ? fontSize : fontSize * 0.55
  }
  return w
}

/** 将段落按最大宽度拆分为多行 */
export function wrapTextLines(
  text: string,
  maxWidth: number,
  fontSize: number,
): string[] {
  if (!text) return []
  const ctx = getMeasureCtx()
  const measure = ctx
    ? (s: string) => {
        ctx.font = `${fontSize}px "SimSun", "Songti SC", "STSong", serif`
        return ctx.measureText(s).width
      }
    : (s: string) => estimateWidth(s, fontSize)

  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const ch of para) {
      if (line !== '' && measure(line + ch) > maxWidth) {
        lines.push(line)
        line = ch
      } else {
        line += ch
      }
    }
    lines.push(line)
  }
  return lines
}

/** 第一页实验内容最大容纳行数（y: 558 -> 1108，高度约 550pt，行距 24pt） */
export const PAGE1_CONTENT_MAX_LINES = 22

/** 第二页接续区最大容纳行数（y: 100 -> 772，高度约 672pt，行距 24pt） */
export const PAGE2_CONTINUATION_MAX_LINES = 28

/**
 * 拆分实验内容：
 * 将 fullText 分割为第 1 页内容行和第 2 页续接行
 */
export function splitExperimentContent(
  fullText: string,
  maxWidthPt = 675.1,
  fontSizePt = 16,
): {
  page1Lines: string[]
  page2Lines: string[]
  isOverflow: boolean
} {
  if (!fullText) {
    return { page1Lines: [], page2Lines: [], isOverflow: false }
  }

  const lines = wrapTextLines(fullText, maxWidthPt, fontSizePt)
  const page1Lines = lines.slice(0, PAGE1_CONTENT_MAX_LINES)
  const page2Lines = lines.slice(PAGE1_CONTENT_MAX_LINES)

  return {
    page1Lines,
    page2Lines,
    isOverflow: page2Lines.length > 0,
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
