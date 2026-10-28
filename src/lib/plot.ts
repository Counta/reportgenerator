import type { CurveKind, PlotCurve, PlotDocument, PlotNode } from '@/types/plot'
import { compileExpr, constValue } from '@/lib/plotMath'
import type { Fn } from '@/lib/plotMath'

export const PLOT = { width: 800, height: 500 } as const
export const WAVE_NAMES: Record<CurveKind, string> = {
  sin: '正弦', cos: '余弦', square: '方波', triangle: '三角波', saw: '锯齿波', nodes: '节点曲线',
  data: '实验数据', expr: '函数表达式',
}
/** Periodic template curves (sin/cos/square/triangle/saw). */
export function isWave(c: PlotCurve): boolean { return c.kind !== 'nodes' && c.kind !== 'data' && c.kind !== 'expr' }
/** Curves whose shape is a list of draggable points. */
export function hasPoints(c: PlotCurve): boolean { return c.kind === 'nodes' || c.kind === 'data' }
const COLORS = ['#2563eb', '#dc2626', '#059669', '#9333ea', '#b45309', '#0e7490']
export function newCurve(kind: PlotCurve['kind'], index = 0): PlotCurve {
  const c: PlotCurve = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 9), name: WAVE_NAMES[kind], color: COLORS[index % COLORS.length],
    dashed: false, kind, amplitude: 1, offset: 0, period: 2, phase: 0, duty: 0.5,
    nodes: [{ x: 0, y: 0, next: 'line' }, { x: 2, y: 1, next: 'line' },
      { x: 4, y: -1, next: 'line' }, { x: 6, y: 0, next: 'line' }],
  }
  if (kind === 'data') {
    // Sample measurement so the curve is visible straight away.
    c.nodes = [[0, 0], [1, 0.21], [2, 0.39], [3, 0.62], [4, 0.8], [5, 1.01]].map(([x, y]) => ({ x, y, next: 'line' as const }))
    c.marker = 'circle'
  }
  if (kind === 'expr') c.pieces = [{ expr: '0.2x', from: '', to: '' }]
  return c
}
/** A new plot starts without curves and shows only the axes; title, names, grid and legend are opt-in. */
export function newPlot(): PlotDocument {
  return { version: 1, title: '图表', xLabel: 'x', yLabel: 'y', xMin: 0, xMax: 6,
    yMin: -1.5, yMax: 1.5, grid: false, joinJumps: true, curves: [],
    showTitle: false, showAxes: true, showNames: false, showLegend: false, autoRange: true }
}
export function clonePlot(doc: PlotDocument): PlotDocument {
  return JSON.parse(JSON.stringify(doc)) as PlotDocument
}
/** Leading symbol of an axis label: "U / V" → "U", "I(mA)" → "I"; otherwise the fallback. */
export function axisSymbol(label: string, fallback: string): string {
  const m = /^\s*([A-Za-z\u0370-\u03ff][A-Za-z0-9_\u0370-\u03ff]{0,3})(?![A-Za-z0-9_\u0370-\u03ff])/.exec(label)
  return m && !['pi', 'e'].includes(m[1]) ? m[1] : fallback
}
export interface CompiledPiece { f: Fn; from: number; to: number }
/** Compile every piece of an expression curve; bounds are constant expressions, empty means ±∞. */
export function compilePieces(c: PlotCurve, d: PlotDocument): { pieces: CompiledPiece[]; error: string } {
  const vars = Array.from(new Set(['x', axisSymbol(d.xLabel, 'x')]))
  const pieces: CompiledPiece[] = []
  for (const [i, p] of (c.pieces ?? []).entries()) {
    const label = (c.pieces?.length ?? 0) > 1 ? `第 ${i + 1} 段` : '表达式'
    try {
      const from = constValue(p.from) ?? -Infinity, to = constValue(p.to) ?? Infinity
      if (Number.isNaN(from) || Number.isNaN(to) || !(from < to)) return { pieces, error: `${label}：区间需满足 起点 < 终点。` }
      pieces.push({ f: compileExpr(p.expr, vars), from, to })
    } catch (e) {
      return { pieces, error: `${label}：${(e as Error).message}` }
    }
  }
  return { pieces, error: pieces.length ? '' : '请至少填写一段表达式。' }
}
export function plotError(d: PlotDocument): string {
  if (![d.xMin, d.xMax, d.yMin, d.yMax].every(Number.isFinite) || d.xMin >= d.xMax || d.yMin >= d.yMax)
    return '坐标范围必须是有效数字，且最小值小于最大值。'
  if (Math.max(Math.abs(d.xMin), Math.abs(d.xMax), Math.abs(d.yMin), Math.abs(d.yMax)) > 1e9 ||
    d.xMax - d.xMin < 1e-9 || d.yMax - d.yMin < 1e-9) return '坐标绝对值不能超过 10⁹，坐标跨度不能小于 10⁻⁹。'
  if (d.curves.length > 6) return '最多 6 条曲线。'
  for (const c of d.curves) {
    if (!/^#[0-9a-f]{6}$/i.test(c.color)) return '曲线颜色必须是六位十六进制颜色。'
    if (c.kind === 'data') {
      if (c.nodes.length < 1 || c.nodes.length > 2000) return `${c.name}：需要 1 至 2000 个数据点。`
      if (c.nodes.some(n => !Number.isFinite(n.x) || !Number.isFinite(n.y))) return `${c.name}：数据点坐标必须是有效数字。`
      continue
    }
    if (c.kind === 'expr') {
      if (!c.pieces?.length || c.pieces.length > 12) return `${c.name}：需要 1 至 12 段表达式。`
      const { error } = compilePieces(c, d)
      if (error) return `${c.name}：${error}`
      continue
    }
    if (c.kind === 'nodes') {
      if (c.nodes.length < 2 || c.nodes.length > 2000) return `${c.name}：需要 2 至 2000 个节点。`
      if (c.nodes.some((n, i) => !Number.isFinite(n.x) || !Number.isFinite(n.y) || (i > 0 && n.x < c.nodes[i - 1].x)))
        return `${c.name}：节点坐标必须有效，X 按非递减顺序排列。`
      if (c.repeat) {
        if (!Number.isFinite(c.period) || c.period <= 0 || !Number.isFinite(c.phase)) return `${c.name}：周期必须大于 0，相移必须有效。`
        if (c.nodes[0].x !== 0 || Math.abs(c.nodes[c.nodes.length - 1].x - c.period) > Math.max(1e-12, c.period * 1e-9)) return `${c.name}：单周期节点须从 X=0 开始，到 X=周期结束。`
        const cycles = (d.xMax - d.xMin) / c.period
        if (cycles > 200 || c.nodes.length * (Math.ceil(cycles) + 3) > 50000) return `${c.name}：重复节点过多，请缩小 X 范围或简化单周期。`
        if (Math.abs((d.xMin - c.phase) / c.period) > 1e12) return `${c.name}：相移过大，请减小相移。`
      }
    } else {
      if (![c.amplitude, c.offset, c.period, c.phase, c.duty].every(Number.isFinite) || c.period <= 0 || c.duty <= 0 || c.duty >= 1)
        return `${c.name}：周期必须大于 0，占空比必须在 0 与 1 之间。`
      if ((d.xMax - d.xMin) / c.period > 200) return `${c.name}：当前范围超过 200 个周期，请增大周期或缩小 X 范围。`
      if (Math.abs((d.xMin - c.phase) / c.period) > 1e12) return `${c.name}：相移过大，请减小相移。`
    }
  }
  return ''
}
/** Parts default to shown so charts saved before these options keep rendering them. */
export const shows = (d: PlotDocument, key: 'showTitle' | 'showAxes' | 'showNames' | 'showLegend') => d[key] !== false
const textWidth = (s: string) => [...s].reduce((w, ch) => w + (ch.charCodeAt(0) > 0xff ? 13 : 7.5), 0)
export interface PlotLayout { left: number; top: number; w: number; h: number }
/**
 * Text / line scale for an image displayed `widthPt` wide on the page. Pure proportional scaling makes
 * small charts unreadable, so physical text size follows (w/800)^0.25 instead of w/800
 * (about 11pt at half width and 9.5pt at 240pt wide).
 */
export function styleScaleFor(widthPt: number): number {
  const s = widthPt / PLOT.width
  if (!(s > 0)) return 1
  return Number(Math.min(3, Math.max(1, s ** -0.75)).toFixed(2))
}
/** Copy of the plot rendered for an image of the given display width. */
export function withScale(d: PlotDocument, widthPt: number): PlotDocument {
  return { ...d, scale: styleScaleFor(widthPt) }
}
/** Logical drawing size: a larger style scale draws on a smaller canvas that is then enlarged to 800×500. */
export function canvasSize(d: PlotDocument): { W: number; H: number } {
  const k = d.scale && d.scale > 0 ? d.scale : 1
  return { W: PLOT.width / k, H: PLOT.height / k }
}
/** Plot area inside the image; margins shrink when title, names or legend are hidden. */
let layoutCache: { key: string; value: PlotLayout } | null = null
export function plotLayout(d: PlotDocument): PlotLayout {
  const { W, H } = canvasSize(d)
  const axes = shows(d, 'showAxes'), names = shows(d, 'showNames')
  const legendRows = shows(d, 'showLegend') && d.curves.length ? Math.ceil(d.curves.length / 3) : 0
  // toScreen calls this for every sample; cache on the inputs that affect the result.
  const key = [W, axes, names, legendRows, shows(d, 'showTitle'), d.xLabel, d.yMin, d.yMax].join('|')
  if (layoutCache?.key === key) return layoutCache.value
  const top = shows(d, 'showTitle') ? 56 : 26
  const bottom = (axes ? 30 : 12) + (legendRows ? 14 + legendRows * 18 : 0)
  const h = H - top - bottom
  // Left margin fits the widest Y tick label.
  const yLabels = axes ? axisTicks(d.yMin, d.yMax, h, 'y').map(v => textWidth(formatNumber(v))) : []
  const left = axes ? Math.max(40, Math.min(W * 0.3, Math.max(0, ...yLabels) + 20)) : 16
  const right = (axes ? 26 : 16) + (names ? Math.min(W * 0.25, textWidth(d.xLabel) + 8) : 0)
  const value = { left, top, w: W - left - right, h }
  layoutCache = { key, value }
  return value
}
export function toScreen(d: PlotDocument, x: number, y: number): [number, number] {
  const L = plotLayout(d)
  return [L.left + (x - d.xMin) / (d.xMax - d.xMin) * L.w,
    L.top + (d.yMax - y) / (d.yMax - d.yMin) * L.h]
}
export function fromScreen(d: PlotDocument, x: number, y: number): [number, number] {
  const L = plotLayout(d)
  return [d.xMin + (x - L.left) / L.w * (d.xMax - d.xMin),
    d.yMax - (y - L.top) / L.h * (d.yMax - d.yMin)]
}
export function waveValue(c: PlotCurve, x: number): number {
  const u = (x - c.phase) / c.period
  const f = u - Math.floor(u)
  const v = c.kind === 'sin' ? Math.sin(2 * Math.PI * u)
    : c.kind === 'cos' ? Math.cos(2 * Math.PI * u)
      : c.kind === 'square' ? (f < c.duty ? 1 : -1)
        : c.kind === 'triangle' ? 1 - 4 * Math.abs(f - 0.5) : 2 * f - 1
  return c.offset + c.amplitude * v
}
/** Analytic event boundaries: jumps are never inferred from sampled points. */
export function jumpEvents(c: PlotCurve, min: number, max: number): { x: number; before: number; after: number }[] {
  if (c.kind !== 'square' && c.kind !== 'saw') return []
  const result: { x: number; before: number; after: number }[] = []
  const start = Math.floor((min - c.phase) / c.period) - 1
  const end = Math.ceil((max - c.phase) / c.period) + 1
  for (let k = start; k <= end; k++) {
    const x = c.phase + k * c.period
    if (x > min && x <= max) result.push({ x, before: c.offset - (c.kind === 'square' ? c.amplitude : -c.amplitude), after: c.offset + (c.kind === 'square' ? c.amplitude : -c.amplitude) })
    const down = x + c.duty * c.period
    if (c.kind === 'square' && down > min && down <= max)
      result.push({ x: down, before: c.offset + c.amplitude, after: c.offset - c.amplitude })
  }
  return result.sort((a, b) => a.x - b.x)
}
/** Copy a template to nodes, retaining exact jump boundaries for square/saw waves. */
export function templateNodes(c: PlotCurve, d: PlotDocument): PlotNode[] {
  if (c.kind === 'square' || c.kind === 'saw') {
    const mode = c.kind === 'square' ? 'hold' : 'line'
    const nodes: PlotNode[] = [{ x: d.xMin, y: waveValue(c, d.xMin), next: mode }]
    for (const e of jumpEvents(c, d.xMin, d.xMax)) {
      if (c.kind === 'saw') nodes.push({ x: e.x, y: e.before, next: 'line' })
      nodes.push({ x: e.x, y: e.after, next: mode })
    }
    if (nodes[nodes.length - 1].x < d.xMax) nodes.push({ x: d.xMax, y: waveValue(c, d.xMax), next: mode })
    return nodes
  }
  const count = Math.min(1999, Math.max(48, Math.ceil((d.xMax - d.xMin) / c.period * 48)))
  return Array.from({ length: count + 1 }, (_, i) => {
    const x = d.xMin + (d.xMax - d.xMin) * i / count
    return { x, y: waveValue(c, x), next: 'line' }
  })
}
export interface PlotRange { xMin: number; xMax: number; yMin: number; yMax: number }
const MAX_SPAN = 1e9, MIN_SPAN = 1e-9
/** Round a range outward to tidy tick values so axis labels stay readable. */
function niceRange(min: number, max: number, pad: number): [number, number] {
  if (!(max > min)) { const m = Math.max(Math.abs(min) * 0.1, 1); min -= m; max += m }
  const span = max - min
  // Non-negative data keeps 0 as its lower bound instead of padding into negative values.
  const floor0 = min >= 0, ceil0 = max <= 0
  min -= span * pad; max += span * pad
  if (floor0) min = Math.max(0, min)
  if (ceil0) max = Math.min(0, max)
  const raw = (max - min) / 7
  const step = [1, 2, 5, 10].find(n => n * 10 ** Math.floor(Math.log10(raw)) >= raw)! * 10 ** Math.floor(Math.log10(raw))
  return [Number((Math.floor(min / step) * step).toPrecision(12)), Number((Math.ceil(max / step) * step).toPrecision(12))]
}
/** Range that shows every curve: Y covers all values, X covers node data or ~3 periods of periodic curves. */
export function fitRange(d: PlotDocument): PlotRange | null {
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, period = 0, phase = Infinity
  // With measured data, the axes follow the data alone; other curves are drawn within that range.
  const hasData = d.curves.some(c => c.kind === 'data' && c.nodes.length)
  for (const c of d.curves) {
    if (hasData && c.kind !== 'data') continue
    if (c.kind === 'data') {
      for (const n of c.nodes) { x0 = Math.min(x0, n.x); x1 = Math.max(x1, n.x); y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y) }
      continue
    }
    if (c.kind === 'expr') {
      const { pieces, error } = compilePieces(c, d)
      if (error) continue
      // Finite bounds define X; unbounded sides keep the current view.
      const a = Math.min(...pieces.map(p => p.from)), b = Math.max(...pieces.map(p => p.to))
      const from = Number.isFinite(a) ? a : d.xMin, to = Number.isFinite(b) ? b : d.xMax
      if (!(to > from)) continue
      x0 = Math.min(x0, from); x1 = Math.max(x1, to)
      const samples: number[] = []
      for (let i = 0; i <= 400; i++) {
        const x = from + (to - from) * i / 400
        const p = pieces.find(q => x >= q.from && x < q.to) ?? (x === to ? pieces.find(q => q.to === to) : undefined)
        const y = p?.f(x)
        if (y !== undefined && Number.isFinite(y)) samples.push(y)
      }
      // Ignore values shooting off near asymptotes (1/x etc.): keep samples near the 10–90 % band.
      samples.sort((a, b) => a - b)
      if (samples.length) {
        const q5 = samples[Math.floor(samples.length * 0.1)], q95 = samples[Math.ceil(samples.length * 0.9) - 1]
        const band = Math.max(q95 - q5, Math.abs(q95) * 1e-6, 1e-12) * 0.5
        for (const y of samples) if (y >= q5 - band && y <= q95 + band) { y0 = Math.min(y0, y); y1 = Math.max(y1, y) }
      }
      continue
    }
    if (c.kind === 'nodes') {
      for (const n of c.nodes) { y0 = Math.min(y0, n.y); y1 = Math.max(y1, n.y) }
      if (c.repeat) { period = Math.max(period, c.period); phase = Math.min(phase, c.phase) }
      else { x0 = Math.min(x0, c.nodes[0].x); x1 = Math.max(x1, c.nodes[c.nodes.length - 1].x) }
    } else {
      y0 = Math.min(y0, c.offset - Math.abs(c.amplitude)); y1 = Math.max(y1, c.offset + Math.abs(c.amplitude))
      period = Math.max(period, c.period); phase = Math.min(phase, c.phase)
    }
  }
  if (!Number.isFinite(y0) || !Number.isFinite(y1)) return null
  if (period > 0) { x0 = Math.min(x0, phase); x1 = Math.max(x1, phase + 3 * period) }
  if (!Number.isFinite(x0) || !Number.isFinite(x1)) return null
  const [yMin, yMax] = niceRange(y0, y1, 0.12)
  if (d.curves.some(c => c.kind === 'data')) {
    // Data charts end exactly at the largest X / Y; non-negative data starts at 0 so the axes meet at the origin.
    const tight = (lo: number, hi: number): [number, number] => {
      const a = lo >= 0 ? 0 : lo, b = hi <= 0 ? 0 : hi
      return b > a ? [a, b] : [a - 1, b + 1]
    }
    const [xMin, xMax] = tight(x0, x1), [yLo, yHi] = tight(y0, y1)
    return clampRange({ xMin, xMax, yMin: yLo, yMax: yHi })
  }
  const xMin = x1 > x0 ? x0 : x0 - 1, xMax = x1 > x0 ? x1 : x0 + 1
  return clampRange({ xMin, xMax, yMin, yMax })
}
/** Scale a range around an anchor point; factor < 1 zooms in. */
export function zoomAxis(min: number, max: number, anchor: number, factor: number): [number, number] {
  const span = Math.min(MAX_SPAN, Math.max(MIN_SPAN * 10, (max - min) * factor))
  const t = (anchor - min) / (max - min)
  return [anchor - span * t, anchor + span * (1 - t)]
}
/** Keep a range inside the limits enforced by plotError and trim float noise. */
export function clampRange(r: PlotRange): PlotRange {
  const fix = (n: number) => Number(Math.min(MAX_SPAN, Math.max(-MAX_SPAN, n)).toPrecision(10))
  return { xMin: fix(r.xMin), xMax: fix(r.xMax), yMin: fix(r.yMin), yMax: fix(r.yMax) }
}

export function formatNumber(n: number): string {
  return Math.abs(n) < 1e-12 ? '0' : Number(n.toPrecision(5)).toString()
}
/**
 * Ticks whose labels fit the axis length: start from a fine 1-2-5 step and coarsen until neighbouring
 * labels keep a gap (X compares label widths, Y the line height). The step therefore follows both the
 * chart's display size and the zoom level.
 */
export function axisTicks(min: number, max: number, lengthPx: number, axis: 'x' | 'y'): number[] {
  const span = max - min
  if (!(span > 0) || !(lengthPx > 0)) return []
  let exp = Math.floor(Math.log10(span / 40)), mant = 0
  const mants = [1, 2, 5]
  for (let guard = 0; guard < 40; guard++) {
    const step = mants[mant] * 10 ** exp
    const values: number[] = []
    for (let i = Math.ceil(min / step - 1e-9); i <= Math.floor(max / step + 1e-9); i++) values.push(Number((i * step).toPrecision(12)))
    const spacing = step / span * lengthPx
    const need = axis === 'y' ? 30 : Math.max(...values.map(v => textWidth(formatNumber(v)))) + 14
    if (values.length <= 2 || spacing >= need) return values
    if (++mant === 3) { mant = 0; exp++ }
  }
  return [min, max]
}
const escapeXml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c]!)
/** Tile the exact cycle, including unequal endpoints and explicit boundary jumps. */
export function expandedNodes(c: PlotCurve, d: PlotDocument): PlotNode[] {
  if (!c.repeat) return c.nodes
  const start = Math.floor((d.xMin - c.phase) / c.period) - 1
  const end = Math.ceil((d.xMax - c.phase) / c.period)
  const result: PlotNode[] = []
  for (let k = start; k <= end; k++) {
    const origin = c.phase + k * c.period
    // Calculate shared boundaries the same way in both neighbouring cycles.
    c.nodes.forEach((n, i) => result.push({ ...n,
      x: i === c.nodes.length - 1 ? c.phase + (k + 1) * c.period : origin + n.x,
      next: i === c.nodes.length - 1 ? 'line' : n.next,
    }))
  }
  return result
}
/** Polyline of fn on [a, b]; pen lifts at undefined values and across vertical asymptotes. */
function sampledPath(fn: Fn, a: number, b: number, d: PlotDocument, connectStart: boolean): string {
  const count = Math.max(80, Math.round(900 * (b - a) / (d.xMax - d.xMin)))
  const span = d.yMax - d.yMin, lo = d.yMin - span * 20, hi = d.yMax + span * 20
  let path = '', down = false, prevSide = 0
  for (let i = 0; i <= count; i++) {
    const x = i === count ? b : a + (b - a) * i / count
    const y = fn(x)
    if (!Number.isFinite(y)) { down = false; continue }
    const side = y > hi ? 1 : y < lo ? -1 : 0
    if (side && side === -prevSide) down = false // jumped from +∞ to −∞: asymptote
    prevSide = side
    const [sx, sy] = toScreen(d, x, Math.min(hi, Math.max(lo, y)))
    path += `${down || (connectStart && !path) ? 'L' : 'M'}${Number(sx.toFixed(3))},${Number(sy.toFixed(3))}`
    down = true
  }
  return path
}
function markerShape(kind: PlotCurve['marker'], x: number, y: number, color: string, size = 4): string {
  const p = (n: number) => Number(n.toFixed(2))
  if (kind === 'square') return `<rect x="${p(x - size)}" y="${p(y - size)}" width="${size * 2}" height="${size * 2}" fill="${color}"/>`
  if (kind === 'triangle') return `<path d="M${p(x)},${p(y - size * 1.2)}L${p(x + size * 1.1)},${p(y + size * 0.8)}H${p(x - size * 1.1)}Z" fill="${color}"/>`
  if (kind === 'none') return ''
  return `<circle cx="${p(x)}" cy="${p(y)}" r="${size}" fill="${color}"/>`
}
/** Measured points joined by straight segments in ascending X. Markers are drawn by dataMarkers. */
function dataMarkup(c: PlotCurve, d: PlotDocument): string {
  const pts = c.nodes.map((n, i) => ({ n, i })).sort((u, v) => u.n.x - v.n.x || u.i - v.i)
    .map(({ n }) => toScreen(d, n.x, n.y))
  const path = pts.length > 1 ? pts.map((p, i) => `${i ? 'L' : 'M'}${Number(p[0].toFixed(3))},${Number(p[1].toFixed(3))}`).join('') : ''
  return path ? `<path d="${path}" stroke="${c.color}" stroke-width="2.2" fill="none" ${c.dashed ? 'stroke-dasharray="8 5"' : ''}/>` : ''
}
/** Markers sit outside the clip so points exactly on the range edge are drawn whole. */
function dataMarkers(c: PlotCurve, d: PlotDocument): string {
  const ex = (d.xMax - d.xMin) * 1e-9, ey = (d.yMax - d.yMin) * 1e-9
  return c.nodes.filter(n => n.x >= d.xMin - ex && n.x <= d.xMax + ex && n.y >= d.yMin - ey && n.y <= d.yMax + ey)
    .map(n => { const [x, y] = toScreen(d, n.x, n.y); return markerShape(c.marker ?? 'circle', x, y, c.color) }).join('')
}
function exprMarkup(c: PlotCurve, d: PlotDocument): string {
  const { pieces } = compilePieces(c, d)
  let path = '', dots = ''
  const dot = (x: number, y: number, open: boolean) => {
    if (!Number.isFinite(y)) return
    const [sx, sy] = toScreen(d, x, y)
    dots += `<circle cx="${Number(sx.toFixed(2))}" cy="${Number(sy.toFixed(2))}" r="3.5" fill="${open ? 'white' : c.color}" stroke="${c.color}" stroke-width="1.6"/>`
  }
  pieces.forEach((p, i) => {
    const from = Math.max(p.from, d.xMin), to = Math.min(p.to, d.xMax)
    if (!(to > from)) return
    const prev = pieces[i - 1]
    // Pieces sharing a boundary: join with a vertical jump line, or mark [closed / open) ends.
    const contiguous = !!prev && prev.to === p.from && p.from >= d.xMin && p.from <= d.xMax
    const before = contiguous ? prev.f(p.from) : NaN, after = p.f(p.from)
    const jumps = contiguous && Number.isFinite(before) && Number.isFinite(after) && Math.abs(before - after) > (d.yMax - d.yMin) * 1e-9
    path += sampledPath(p.f, from, to, d, contiguous && (d.joinJumps || !jumps))
    if (jumps && !d.joinJumps) { dot(p.from, before, true); dot(p.from, after, false) }
  })
  return `<path d="${path}" stroke="${c.color}" stroke-width="2.4" fill="none" ${c.dashed ? 'stroke-dasharray="8 5"' : ''}/>${dots}`
}
function curveMarkup(c: PlotCurve, d: PlotDocument): string {
  if (c.kind === 'data') return dataMarkup(c, d)
  if (c.kind === 'expr') return exprMarkup(c, d)
  const position = (x: number, y: number) => toScreen(d, x, y).map(n => Number(n.toFixed(3))).join(',')
  let path = ''
  let dots = ''
  function jump(x: number, before: number, after: number) {
    path += `${d.joinJumps ? 'L' : 'M'}${position(x, after)}`
    if (!d.joinJumps && before !== after) {
      dots += `<circle cx="${toScreen(d, x, before)[0]}" cy="${toScreen(d, x, before)[1]}" r="3.5" fill="white" stroke="${c.color}"/><circle cx="${toScreen(d, x, after)[0]}" cy="${toScreen(d, x, after)[1]}" r="3.5" fill="${c.color}"/>`
    }
  }
  if (c.kind === 'nodes') {
    const nodes = expandedNodes(c, d)
    nodes.forEach((n, i) => {
      if (!i) { path = `M${position(n.x, n.y)}`; return }
      const prev = nodes[i - 1]
      if (prev.next === 'break') path += `M${position(n.x, n.y)}`
      else if (prev.next === 'hold') { path += `L${position(n.x, prev.y)}`; jump(n.x, prev.y, n.y) }
      else if (prev.x === n.x) jump(n.x, prev.y, n.y)
      else path += `L${position(n.x, n.y)}`
    })
  } else if (c.kind === 'square' || c.kind === 'saw') {
    path = `M${position(d.xMin, waveValue(c, d.xMin))}`
    let last = waveValue(c, d.xMin)
    const events = jumpEvents(c, d.xMin, d.xMax)
    for (const e of events) {
      path += `L${position(e.x, e.before)}`
      jump(e.x, e.before, e.after)
      last = e.after
    }
    path += `L${position(d.xMax, c.kind === 'square' ? last : waveValue(c, d.xMax))}`
  } else {
    const count = Math.max(700, Math.ceil((d.xMax - d.xMin) / c.period * 80))
    for (let i = 0; i <= count; i++) {
      const x = d.xMin + (d.xMax - d.xMin) * i / count
      path += `${i ? 'L' : 'M'}${position(x, waveValue(c, x))}`
    }
  }
  return `<path d="${path}" stroke="${c.color}" stroke-width="2.4" fill="none" ${c.dashed ? 'stroke-dasharray="8 5"' : ''}/>${dots}`
}
/**
 * Same SVG source is used in the editor, persisted report image and raster/PDF export.
 * `outer` is the SVG's own width/height; the drawing is laid out on canvasSize(d) and scaled to fit.
 */
export function plotSvg(d: PlotDocument, outer: { width: number; height: number } = PLOT): string {
  const error = plotError(d)
  if (error) return ''
  const { W, H } = canvasSize(d)
  const L = plotLayout(d), right = L.left + L.w, bottom = L.top + L.h
  const axes = shows(d, 'showAxes'), names = shows(d, 'showNames')
  const n = (v: number) => Number(v.toFixed(2))
  // Tick spacing adapts to label size, chart size and zoom so labels never collide.
  const xt = axisTicks(d.xMin, d.xMax, L.w, 'x')
  const yt = axisTicks(d.yMin, d.yMax, L.h, 'y')
  let content = `<rect width="${n(W)}" height="${n(H)}" fill="white"/><defs><clipPath id="plot-clip"><rect x="${n(L.left - 2)}" y="${n(L.top - 2)}" width="${n(L.w + 4)}" height="${n(L.h + 4)}"/></clipPath>`
    + `<marker id="axis-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="9" markerHeight="9" orient="auto-start-reverse"><path d="M0,1L10,5L0,9L3,5Z" fill="#374151"/></marker></defs>`
  content += `<g font-family="'Microsoft YaHei', sans-serif" font-size="13" fill="#374151">`
  const maxTitle = Math.max(8, Math.floor(W / 20))
  if (shows(d, 'showTitle')) content += `<text x="${n(W / 2)}" y="32" text-anchor="middle" font-size="19" font-weight="600">${escapeXml(d.title.length > maxTitle ? d.title.slice(0, maxTitle - 1) + '…' : d.title)}</text>`
  if (d.grid) {
    for (const x of xt) content += `<path d="M${n(toScreen(d, x, 0)[0])},${n(L.top)}V${n(bottom)}" stroke="#e5e7eb"/>`
    for (const y of yt) content += `<path d="M${n(L.left)},${n(toScreen(d, 0, y)[1])}H${n(right)}" stroke="#e5e7eb"/>`
  }
  // Axes cross at the origin when it is in view, otherwise along the left / bottom edge.
  const xZero = d.xMin <= 0 && d.xMax >= 0, yZero = d.yMin <= 0 && d.yMax >= 0
  const [ax, ay] = toScreen(d, xZero ? 0 : d.xMin, yZero ? 0 : d.yMin)
  const origin = xZero && yZero
  if (axes) {
    content += `<path d="M${n(L.left)},${n(ay)}H${n(right + 18)}" stroke="#374151" stroke-width="1.3" marker-end="url(#axis-arrow)"/>`
    content += `<path d="M${n(ax)},${n(bottom)}V${n(L.top - 18)}" stroke="#374151" stroke-width="1.3" marker-end="url(#axis-arrow)"/>`
    for (const x of xt) {
      if (origin && x === 0) continue
      const sx = n(toScreen(d, x, 0)[0])
      content += `<path d="M${sx},${n(ay)}v5" stroke="#374151"/><text x="${sx}" y="${n(ay + 19)}" text-anchor="middle">${formatNumber(x)}</text>`
    }
    for (const y of yt) {
      if (origin && y === 0) continue
      const sy = n(toScreen(d, 0, y)[1])
      content += `<path d="M${n(ax)},${sy}h-5" stroke="#374151"/><text x="${n(ax - 8)}" y="${n(sy + 4)}" text-anchor="end">${formatNumber(y)}</text>`
    }
    if (origin) content += `<text x="${n(ax - 6)}" y="${n(ay + 17)}" text-anchor="end">0</text>`
  }
  if (names) {
    // Names sit at the arrow tips: X to the right of its arrow, Y beside the top of its arrow.
    content += `<text x="${n(right + 24)}" y="${n(ay + 4)}">${escapeXml(d.xLabel)}</text>`
    content += `<text x="${n(ax + 10)}" y="${n(L.top - 10)}">${escapeXml(d.yLabel)}</text>`
  }
  content += `<g clip-path="url(#plot-clip)">${d.curves.map(c => curveMarkup(c, d)).join('')}</g>`
  content += d.curves.filter(c => c.kind === 'data').map(c => dataMarkers(c, d)).join('')
  if (shows(d, 'showLegend')) {
    const rows = Math.ceil(d.curves.length / 3)
    d.curves.forEach((c, i) => {
      const x = L.left + (i % 3) * (L.w / 3), y = H - 12 - (rows - 1 - Math.floor(i / 3)) * 18
      const mark = c.kind === 'data' ? markerShape(c.marker ?? 'circle', x + 11, y - 4, c.color, 3.5) : ''
      content += `<path d="M${n(x)},${y - 4}h22" stroke="${c.color}" stroke-width="2.4" ${c.dashed ? 'stroke-dasharray="6 3"' : ''}/>${mark}<text x="${n(x + 29)}" y="${y}"><title>${escapeXml(c.name)}</title>${escapeXml(c.name.length > 14 ? c.name.slice(0, 13) + '…' : c.name)}</text>`
    })
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${outer.width}" height="${outer.height}" viewBox="0 0 ${n(W)} ${n(H)}">${content}</g></svg>`
}
export function plotDataUrl(d: PlotDocument): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(plotSvg(d))}`
}
