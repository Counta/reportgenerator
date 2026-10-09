import { PAGE_SIZE_PT } from '@/types'
import type { FormTemplate, ReportData } from '@/types'
import { splitExperimentContent } from '@/lib/textLayout'

/**
 * 逐页导出：将背景图与填写内容合成为 PNG。
 * 每页生成一张图片（dataURL）。
 */

/** 绘制时使用的字体：优先宋体，后回退到系统默认 */
const FONT_FAMILY =
  '"SimSun", "Songti SC", "STSong", "SimSun-ExtB", -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif'

function px(value: number, scale: number): number {
  return value * scale
}

/** 根据可用宽度自适应字体大小 */
function fitFontSize(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  base: number,
  min: number,
): number {
  let size = base
  ctx.font = `${size}px ${FONT_FAMILY}`
  while (size > min && ctx.measureText(text).width > maxWidth) {
    size -= 0.5
    ctx.font = `${size}px ${FONT_FAMILY}`
  }
  return size
}

/** 将文本按自动换行绘制在矩形内 */
function drawWrapped(
  ctx: CanvasRenderingContext2D,
  text: string,
  rect: { x: number; y: number; w: number; h: number },
  opts: { fontSize: number; lineHeight: number; color?: string },
) {
  const { fontSize, lineHeight, color = '#000' } = opts
  ctx.fillStyle = color
  ctx.font = `${fontSize}px ${FONT_FAMILY}`

  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const ch of para) {
      if (line !== '' && ctx.measureText(line + ch).width > rect.w) {
        lines.push(line)
        line = ch
      } else {
        line += ch
      }
    }
    lines.push(line)
  }

  let y = rect.y
  for (const line of lines) {
    ctx.fillText(line, rect.x, y)
    y += lineHeight
    if (y > rect.y + rect.h) break
  }
}

/** 绘制单个字段 */
function drawField(
  ctx: CanvasRenderingContext2D,
  value: string,
  rect: { x: number; y: number; w: number; h: number },
  ptToPx: number,
  fieldId?: string,
) {
  if (!value) return

  // 课程前缀（模拟电路 / 数字电路）：匹配“实验报告”的 22pt 字号并右对齐贴近
  if (fieldId === 'courseType') {
    const fontSize = ptToPx * 21.96
    ctx.font = `${fontSize}px ${FONT_FAMILY}`
    ctx.fillStyle = '#000'
    ctx.textAlign = 'right'
    ctx.textBaseline = 'bottom'
    ctx.fillText(value, px(530.52 - 12, ptToPx), px(114.5, ptToPx))
    return
  }

  const r = px(rect.x, ptToPx)
  const top = px(rect.y, ptToPx)
  const w = px(rect.w, ptToPx)
  const h = px(rect.h, ptToPx)

  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'

  // 短内容（单行）：水平垂直居中，字号按宽度自适应、封顶
  const isShort = value.length <= 14
  if (isShort) {
    const base = ptToPx * 20
    const fontSize = Math.max(
      fitFontSize(ctx, value, w * 0.92, base, ptToPx * 10),
      ptToPx * 10,
    )
    ctx.font = `${fontSize}px ${FONT_FAMILY}`
    ctx.fillStyle = '#000'
    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'
    ctx.fillText(value, r + w / 2, top + h / 2)
    return
  }

  // 长文本（多行）：顶部对齐 + 自动换行
  const base = ptToPx * 16
  const fontSize = Math.max(
    fitFontSize(ctx, value, w * 0.95, base, ptToPx * 10),
    ptToPx * 10,
  )
  ctx.font = `${fontSize}px ${FONT_FAMILY}`
  ctx.fillStyle = '#000'
  drawWrapped(ctx, value, { x: r, y: top, w, h }, { fontSize, lineHeight: fontSize * 1.5 })
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(`加载背景图失败: ${url}`))
    img.src = url
  })
}

/**
 * 导出指定页的合成图。
 * @param page 页码（1 起）
 * @param bgUrl 背景图 URL
 * @param data 报告数据
 * @param template 表单模板
 * @param dpi 输出分辨率（每 PDF 点对应的像素数，建议 2）
 */
export async function exportPage(
  page: number,
  bgUrl: string,
  data: ReportData,
  template: FormTemplate,
  dpi = 2,
): Promise<{ dataUrl: string; width: number; height: number }> {
  const img = await loadImage(bgUrl)

  const outW = Math.round(PAGE_SIZE_PT.width * dpi)
  const outH = Math.round(PAGE_SIZE_PT.height * dpi)

  const canvas = document.createElement('canvas')
  canvas.width = outW
  canvas.height = outH
  const ctx = canvas.getContext('2d')!
  ctx.imageSmoothingEnabled = true

  // 绘制背景图（缩放到输出尺寸）
  ctx.drawImage(img, 0, 0, outW, outH)

  const split = splitExperimentContent(data.values['content'] || '')

  for (const f of template.fields) {
    if (f.page !== page) continue

    let value = data.values[f.id] ?? ''

    // 第 1 页实验内容：只绘制未溢出的前 22 行
    if (f.id === 'content') {
      value = split.page1Lines.join('\n')
    }
    // 第 2 页实验内容接续区：只有在第 1 页溢出时才绘制第 23+ 行
    else if (f.id === 'contentContinuation') {
      value = split.isOverflow ? split.page2Lines.join('\n') : ''
    }

    drawField(ctx, value, f.rect, dpi, f.id)
  }

  return { dataUrl: canvas.toDataURL('image/png'), width: outW, height: outH }
}
