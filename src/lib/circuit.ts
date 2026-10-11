/**
 * 电路图元件库与渲染
 *
 * 设计参考 Circuit Diagram（circuit-diagram.org）：
 * - 画布为网格，所有端点吸附到网格（GRID 单位）
 * - 双端元件（电阻、电容……）由起点/终点定义，元件主体居中，两侧引线自动拉伸
 * - 导线端点与其他端点/导线重合 ≥3 处时自动绘制连接点
 * - 文档以结构化数据保存，可再次编辑；对外渲染为 SVG
 */
import type { CircuitData, CircuitElement } from '@/types'
import type { ObstacleRect } from '@/lib/textLayout'

export const GRID = 10

type Mode = 'line' | 'point'

export interface ComponentDef {
  kind: string
  name: string
  group: string
  mode: Mode
  /** line 模式：主体长度（单位） */
  bodyLen?: number
  /** line 模式：主体 SVG（局部坐标，x ∈ [0, bodyLen]，y 以 0 为中心） */
  body?: () => string
  /** point 模式：局部 SVG（原点为锚点） */
  shape?: () => string
  /** point 模式：局部包围盒 [minX, minY, maxX, maxY] */
  extent?: [number, number, number, number]
  /** point 模式：局部端点 */
  terminals?: [number, number][]
  /** 默认标签 */
  defaultLabel?: string
}

const arrow = (x1: number, y1: number, x2: number, y2: number) => {
  const a = Math.atan2(y2 - y1, x2 - x1)
  const l = 5
  const p1 = [x2 - l * Math.cos(a - 0.45), y2 - l * Math.sin(a - 0.45)]
  const p2 = [x2 - l * Math.cos(a + 0.45), y2 - l * Math.sin(a + 0.45)]
  return `<path d="M${x1},${y1}L${x2},${y2}M${p1[0]},${p1[1]}L${x2},${y2}L${p2[0]},${p2[1]}"/>`
}

const txt = (x: number, y: number, s: string, size = 14) =>
  `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" dominant-baseline="central" stroke="none" fill="currentColor">${s}</text>`

export const COMPONENTS: ComponentDef[] = [
  { kind: 'wire', name: '导线', group: '基础', mode: 'line', bodyLen: 0, body: () => '' },
  {
    kind: 'resistor', name: '电阻', group: '无源', mode: 'line', bodyLen: 40, defaultLabel: 'R',
    body: () => '<rect x="0" y="-7" width="40" height="14"/>',
  },
  {
    kind: 'rheostat', name: '可变电阻', group: '无源', mode: 'line', bodyLen: 40, defaultLabel: 'Rp',
    body: () => '<rect x="0" y="-7" width="40" height="14"/>' + arrow(4, 14, 36, -14),
  },
  {
    kind: 'capacitor', name: '电容', group: '无源', mode: 'line', bodyLen: 8, defaultLabel: 'C',
    body: () => '<path d="M0,-14V14M8,-14V14"/>',
  },
  {
    kind: 'ecapacitor', name: '电解电容', group: '无源', mode: 'line', bodyLen: 10, defaultLabel: 'C',
    body: () => '<path d="M0,-14V14"/><rect x="6" y="-14" width="4" height="28" fill="currentColor"/>' +
      '<path d="M-10,-14h6M-7,-17v6"/>',
  },
  {
    kind: 'inductor', name: '电感', group: '无源', mode: 'line', bodyLen: 40, defaultLabel: 'L',
    body: () => '<path d="M0,0a5,5 0 0 1 10,0a5,5 0 0 1 10,0a5,5 0 0 1 10,0a5,5 0 0 1 10,0"/>',
  },
  {
    kind: 'fuse', name: '保险丝', group: '无源', mode: 'line', bodyLen: 30, defaultLabel: 'FU',
    body: () => '<rect x="0" y="-5" width="30" height="10"/><path d="M0,0H30"/>',
  },
  {
    kind: 'diode', name: '二极管', group: '半导体', mode: 'line', bodyLen: 20, defaultLabel: 'D',
    body: () => '<path d="M0,0H20M0,-10V10L20,0Z M20,-10V10"/>',
  },
  {
    kind: 'zener', name: '稳压管', group: '半导体', mode: 'line', bodyLen: 20, defaultLabel: 'DZ',
    body: () => '<path d="M0,0H20M0,-10V10L20,0Z M16,-12L20,-10V10L24,12"/>',
  },
  {
    kind: 'led', name: '发光二极管', group: '半导体', mode: 'line', bodyLen: 20, defaultLabel: 'LED',
    body: () => '<path d="M0,0H20M0,-10V10L20,0Z M20,-10V10"/>' + arrow(8, -12, 16, -22) + arrow(14, -10, 22, -20),
  },
  {
    kind: 'battery', name: '直流电源', group: '电源', mode: 'line', bodyLen: 10, defaultLabel: 'E',
    body: () => '<path d="M0,-14V14"/><path d="M10,-7V7" stroke-width="4"/>',
  },
  {
    kind: 'vsource', name: '电压源', group: '电源', mode: 'line', bodyLen: 40, defaultLabel: 'Us',
    body: () => '<circle cx="20" cy="0" r="20"/>' + txt(10, 0, '+', 13) + txt(30, 0, '−', 13),
  },
  {
    kind: 'acsource', name: '交流电源', group: '电源', mode: 'line', bodyLen: 40, defaultLabel: 'u',
    body: () => '<circle cx="20" cy="0" r="20"/><path d="M8,0q6,-12 12,0t12,0"/>',
  },
  {
    kind: 'isource', name: '电流源', group: '电源', mode: 'line', bodyLen: 40, defaultLabel: 'Is',
    body: () => '<circle cx="20" cy="0" r="20"/>' + arrow(8, 0, 32, 0),
  },
  {
    kind: 'switch', name: '开关', group: '其他', mode: 'line', bodyLen: 40, defaultLabel: 'S',
    body: () => '<circle cx="2" cy="0" r="2.5"/><circle cx="38" cy="0" r="2.5"/><path d="M4,-1L36,-16"/>',
  },
  {
    kind: 'lamp', name: '灯泡', group: '其他', mode: 'line', bodyLen: 30, defaultLabel: 'HL',
    body: () => '<circle cx="15" cy="0" r="15"/><path d="M4.4,-10.6L25.6,10.6M4.4,10.6L25.6,-10.6"/>',
  },
  {
    kind: 'ammeter', name: '电流表', group: '仪表', mode: 'line', bodyLen: 30,
    body: () => '<circle cx="15" cy="0" r="15"/>' + txt(15, 0, 'A', 16),
  },
  {
    kind: 'voltmeter', name: '电压表', group: '仪表', mode: 'line', bodyLen: 30,
    body: () => '<circle cx="15" cy="0" r="15"/>' + txt(15, 0, 'V', 16),
  },
  {
    kind: 'ground', name: '接地', group: '基础', mode: 'point',
    shape: () => '<path d="M0,0V12M-12,12H12M-7,17H7M-2,22H2"/>',
    extent: [-12, 0, 12, 22], terminals: [[0, 0]],
  },
  {
    kind: 'terminal', name: '端子', group: '基础', mode: 'point',
    shape: () => '<circle cx="0" cy="0" r="3.5" fill="#fff"/>',
    extent: [-4, -4, 4, 4], terminals: [[0, 0]],
  },
  {
    kind: 'junction', name: '连接点', group: '基础', mode: 'point',
    shape: () => '<circle cx="0" cy="0" r="3" fill="currentColor"/>',
    extent: [-3, -3, 3, 3], terminals: [[0, 0]],
  },
  {
    kind: 'text', name: '文字', group: '基础', mode: 'point', defaultLabel: '文字',
    shape: () => '', extent: [0, 0, 0, 0], terminals: [],
  },
  {
    kind: 'npn', name: 'NPN 三极管', group: '半导体', mode: 'point', defaultLabel: 'VT',
    shape: () =>
      '<path d="M0,0H18M18,-14V14M18,-6L40,-20V-30M18,6L40,20V30"/>' +
      '<path d="M40,20L31,19L35,13Z" fill="currentColor"/>',
    extent: [0, -30, 40, 30], terminals: [[0, 0], [40, -30], [40, 30]],
  },
  {
    kind: 'pnp', name: 'PNP 三极管', group: '半导体', mode: 'point', defaultLabel: 'VT',
    shape: () =>
      '<path d="M0,0H18M18,-14V14M18,-6L40,-20V-30M18,6L40,20V30"/>' +
      '<path d="M18,6L27,7L23,13Z" fill="currentColor"/>',
    extent: [0, -30, 40, 30], terminals: [[0, 0], [40, -30], [40, 30]],
  },
  {
    kind: 'opamp', name: '运算放大器', group: '半导体', mode: 'point', defaultLabel: 'A',
    shape: () =>
      '<path d="M10,-30V30L60,0Z" fill="#fff"/><path d="M0,-10H10M0,10H10M60,0H70"/>' +
      txt(17, -10, '−', 13) + txt(17, 10, '+', 13),
    extent: [0, -30, 70, 30], terminals: [[0, -10], [0, 10], [70, 0]],
  },
]

export const COMPONENT_MAP: Record<string, ComponentDef> = Object.fromEntries(
  COMPONENTS.map((c) => [c.kind, c]),
)

export function snap(v: number): number {
  return Math.round(v / GRID) * GRID
}

function escapeXml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  )
}

function rotatePt(x: number, y: number, rot: number): [number, number] {
  switch (((rot % 360) + 360) % 360) {
    case 90: return [-y, x]
    case 180: return [-x, -y]
    case 270: return [y, -x]
    default: return [x, y]
  }
}

/** 元件的全部端点（全局坐标） */
export function terminalsOf(el: CircuitElement): [number, number][] {
  const def = COMPONENT_MAP[el.kind]
  if (!def) return []
  if (def.mode === 'line') return [[el.x1, el.y1], [el.x2, el.y2]]
  return (def.terminals || []).map(([x, y]) => {
    const [rx, ry] = rotatePt(x, y, el.rot || 0)
    return [el.x1 + rx, el.y1 + ry]
  })
}

/** 估算文字宽度（单位） */
function textW(s: string, size: number): number {
  let w = 0
  for (const ch of s) w += ch.charCodeAt(0) > 255 ? size : size * 0.58
  return w
}

const LABEL_SIZE = 14

function labelPos(el: CircuitElement): { x: number; y: number; anchor: string } | null {
  if (!el.label) return null
  const def = COMPONENT_MAP[el.kind]
  if (!def) return null
  if (def.kind === 'text') return { x: el.x1, y: el.y1, anchor: 'start' }
  if (def.mode === 'line') {
    const mx = (el.x1 + el.x2) / 2
    const my = (el.y1 + el.y2) / 2
    const horizontal = Math.abs(el.x2 - el.x1) >= Math.abs(el.y2 - el.y1)
    return horizontal
      ? { x: mx, y: my - 26, anchor: 'middle' }
      : { x: mx + 26, y: my, anchor: 'start' }
  }
  const b = rotatedExtent(def.extent!, el.rot || 0)
  return { x: el.x1 + b[2] + 6, y: el.y1 + (b[1] + b[3]) / 2, anchor: 'start' }
}

function rotatedExtent(e: [number, number, number, number], rot: number) {
  const pts = [rotatePt(e[0], e[1], rot), rotatePt(e[2], e[3], rot)]
  return [
    Math.min(pts[0][0], pts[1][0]),
    Math.min(pts[0][1], pts[1][1]),
    Math.max(pts[0][0], pts[1][0]),
    Math.max(pts[0][1], pts[1][1]),
  ] as [number, number, number, number]
}

/** 单个元件的 SVG 片段（全局坐标） */
export function elementMarkup(el: CircuitElement): string {
  const def = COMPONENT_MAP[el.kind]
  if (!def) return ''
  let out = ''
  if (def.mode === 'line') {
    const dx = el.x2 - el.x1
    const dy = el.y2 - el.y1
    const L = Math.hypot(dx, dy)
    const ang = (Math.atan2(dy, dx) * 180) / Math.PI
    const b = Math.min(def.bodyLen || 0, L)
    const s = (L - b) / 2
    let inner = ''
    if (b === 0) inner = `<path d="M0,0H${L}"/>`
    else {
      inner = `<path d="M0,0H${s}M${s + b},0H${L}"/>`
      inner += `<g transform="translate(${s},0)">${def.body!()}</g>`
    }
    out += `<g transform="translate(${el.x1},${el.y1}) rotate(${ang})">${inner}</g>`
  } else {
    out += `<g transform="translate(${el.x1},${el.y1}) rotate(${el.rot || 0})">${def.shape!()}</g>`
  }
  const lp = labelPos(el)
  if (lp) {
    out += `<text x="${lp.x}" y="${lp.y}" font-size="${LABEL_SIZE}" text-anchor="${lp.anchor}" dominant-baseline="central" stroke="none" fill="currentColor">${escapeXml(el.label!)}</text>`
  }
  return out
}

/** 元件包围盒 */
export function elementBBox(el: CircuitElement): [number, number, number, number] {
  const def = COMPONENT_MAP[el.kind]
  let box: [number, number, number, number]
  if (!def) return [el.x1, el.y1, el.x1, el.y1]
  if (def.mode === 'line') {
    const pad = def.bodyLen ? 22 : 2
    const horizontal = Math.abs(el.x2 - el.x1) >= Math.abs(el.y2 - el.y1)
    box = [
      Math.min(el.x1, el.x2) - (horizontal ? 2 : pad),
      Math.min(el.y1, el.y2) - (horizontal ? pad : 2),
      Math.max(el.x1, el.x2) + (horizontal ? 2 : pad),
      Math.max(el.y1, el.y2) + (horizontal ? pad : 2),
    ]
  } else {
    const e = rotatedExtent(def.extent!, el.rot || 0)
    box = [el.x1 + e[0], el.y1 + e[1], el.x1 + e[2], el.y1 + e[3]]
  }
  const lp = labelPos(el)
  if (lp) {
    const w = textW(el.label!, LABEL_SIZE)
    const left = lp.anchor === 'middle' ? lp.x - w / 2 : lp.x
    box = [
      Math.min(box[0], left),
      Math.min(box[1], lp.y - LABEL_SIZE / 2 - 2),
      Math.max(box[2], left + w),
      Math.max(box[3], lp.y + LABEL_SIZE / 2 + 2),
    ]
  }
  return box
}

/**
 * 导线让路：导线与共线的双端元件重叠时，扣除元件占据的区段。
 * 仅影响渲染与连接点判定，原始数据不变（元件移开后导线自动恢复）。
 */
export function routeWires(elements: CircuitElement[]): CircuitElement[] {
  const parts = elements.filter((e) => {
    const d = COMPONENT_MAP[e.kind]
    return d?.mode === 'line' && e.kind !== 'wire' && (e.x1 !== e.x2 || e.y1 !== e.y2)
  })
  if (parts.length === 0) return elements
  const out: CircuitElement[] = []
  for (const el of elements) {
    if (el.kind !== 'wire') {
      out.push(el)
      continue
    }
    const horizontal = el.y1 === el.y2
    const vertical = el.x1 === el.x2
    if (!horizontal && !vertical) {
      out.push(el)
      continue
    }
    // 沿导线方向的一维区间
    const fixed = horizontal ? el.y1 : el.x1
    const a = horizontal ? Math.min(el.x1, el.x2) : Math.min(el.y1, el.y2)
    const b = horizontal ? Math.max(el.x1, el.x2) : Math.max(el.y1, el.y2)
    let segs: [number, number][] = [[a, b]]
    for (const p of parts) {
      const pH = p.y1 === p.y2
      if (horizontal ? !(pH && p.y1 === fixed) : !(p.x1 === p.x2 && p.x1 === fixed)) continue
      const pa = horizontal ? Math.min(p.x1, p.x2) : Math.min(p.y1, p.y2)
      const pb = horizontal ? Math.max(p.x1, p.x2) : Math.max(p.y1, p.y2)
      const next: [number, number][] = []
      for (const [s, e] of segs) {
        if (pb <= s || pa >= e) {
          next.push([s, e])
          continue
        }
        if (pa > s) next.push([s, pa])
        if (pb < e) next.push([pb, e])
      }
      segs = next
    }
    segs.forEach(([s, e], i) => {
      out.push(
        horizontal
          ? { ...el, id: `${el.id}~${i}`, x1: s, y1: fixed, x2: e, y2: fixed }
          : { ...el, id: `${el.id}~${i}`, x1: fixed, y1: s, x2: fixed, y2: e },
      )
    })
  }
  return out
}

/** 自动连接点：某坐标处有 ≥3 个端点 / 导线经过 */
export function junctionPoints(input: CircuitElement[]): [number, number][] {
  const elements = routeWires(input)
  const counts = new Map<string, number>()
  const add = (x: number, y: number, n = 1) => {
    const k = `${x},${y}`
    counts.set(k, (counts.get(k) || 0) + n)
  }
  const pts: [number, number][] = []
  for (const el of elements) {
    if (el.kind === 'junction' || el.kind === 'text') continue
    for (const [x, y] of terminalsOf(el)) {
      add(x, y)
      pts.push([x, y])
    }
  }
  // 端点落在导线中段：T 形连接，计 2
  const wires = elements.filter((e) => e.kind === 'wire')
  const seen = new Set<string>()
  for (const [x, y] of pts) {
    const k = `${x},${y}`
    if (seen.has(k)) continue
    seen.add(k)
    for (const w of wires) {
      const onH = w.y1 === w.y2 && y === w.y1 && x > Math.min(w.x1, w.x2) && x < Math.max(w.x1, w.x2)
      const onV = w.x1 === w.x2 && x === w.x1 && y > Math.min(w.y1, w.y2) && y < Math.max(w.y1, w.y2)
      if (onH || onV) add(x, y, 2)
    }
  }
  const out: [number, number][] = []
  counts.forEach((n, k) => {
    if (n >= 3) {
      const [x, y] = k.split(',').map(Number)
      out.push([x!, y!])
    }
  })
  return out
}

export function junctionMarkup(elements: CircuitElement[]): string {
  return junctionPoints(elements)
    .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3" fill="currentColor" stroke="none"/>`)
    .join('')
}

const PAD = 8

/** 整张图的包围盒（含边距） */
export function circuitBBox(elements: CircuitElement[]): { x: number; y: number; w: number; h: number } {
  if (elements.length === 0) return { x: 0, y: 0, w: 100, h: 60 }
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity]
  for (const el of elements) {
    const b = elementBBox(el)
    x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1])
    x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3])
  }
  return { x: x0 - PAD, y: y0 - PAD, w: x1 - x0 + PAD * 2, h: y1 - y0 + PAD * 2 }
}

export const SVG_STYLE =
  'fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" font-family="SimSun, Songti SC, STSong, serif"'

/** 完整 SVG 文档（裁切到内容包围盒） */
export function renderCircuitSvg(elements: CircuitElement[]): string {
  const b = circuitBBox(elements)
  const body = routeWires(elements).map(elementMarkup).join('') + junctionMarkup(elements)
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${b.x} ${b.y} ${b.w} ${b.h}" ` +
    `width="${b.w}" height="${b.h}" color="#000" ${SVG_STYLE}>${body}</svg>`
  )
}

export function circuitDataUrl(elements: CircuitElement[]): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(renderCircuitSvg(elements))
}

/** 电路图在页面上的显示高度（PDF 点），按内容宽高比保持形状 */
export function circuitDisplayHeight(c: CircuitData): number {
  const b = circuitBBox(c.elements)
  return (c.w * b.h) / b.w
}

/** 用于文字避让的矩形 */
export function circuitObstacles(circuits: CircuitData[] = []): ObstacleRect[] {
  return circuits.map((c) => ({ page: c.page, x: c.x, y: c.y, w: c.w, h: circuitDisplayHeight(c) }))
}

export function cloneCircuit(c: CircuitData): CircuitData {
  return { ...c, elements: c.elements.map((e) => ({ ...e })) }
}
