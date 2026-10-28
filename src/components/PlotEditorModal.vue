<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import type { PlotCurve, PlotDocument, PlotNode } from '@/types/plot'
import { axisSymbol, canvasSize, clampRange, clonePlot, fitRange, formatNumber, fromScreen, hasPoints, isWave, newCurve, newPlot, PLOT, plotDataUrl, plotError, plotLayout, plotSvg, shows, templateNodes, toScreen, WAVE_NAMES, zoomAxis } from '@/lib/plot'
import type { PlotRange } from '@/lib/plot'
import type { ExprPiece, MarkerKind } from '@/types/plot'

const props = defineProps<{ visible: boolean; source: PlotDocument | null; defaultPage: number; editing: boolean }>()
const emit = defineEmits<{
  (e: 'update:visible', value: boolean): void
  (e: 'confirm', payload: { plot: PlotDocument; page: number; src: string; naturalW: number; naturalH: number }): void
}>()
const doc = ref(newPlot())
const page = ref(1)
const selected = ref('')
const selectedNode = ref(0)
const panel = ref<'curve' | 'chart'>('curve')
const adding = ref(false)
const singleCycle = ref(true)
const tool = ref<'select' | 'add'>('select')
const snap = ref(true)
const step = ref(0.1)
const tableText = ref('')
const tableError = ref('')
const past = ref<PlotDocument[]>([])
const future = ref<PlotDocument[]>([])
const card = ref<HTMLElement | null>(null)
const svg = ref<SVGSVGElement | null>(null)
let returnFocus: HTMLElement | null = null
const curve = computed(() => doc.value.curves.find(c => c.id === selected.value))
const node = computed(() => curve.value?.nodes[selectedNode.value])
const error = computed(() => plotError(doc.value))
const empty = computed(() => !doc.value.curves.length)
const canSubmit = computed(() => !error.value && !empty.value)
const cycleEditing = computed(() => !!curve.value?.repeat && curve.value.kind === 'nodes' && singleCycle.value)
const viewDoc = computed<PlotDocument>(() => cycleEditing.value && curve.value
  ? { ...doc.value, title: `${curve.value.name} · 单周期`, xMin: 0, xMax: curve.value.period, curves: [{ ...curve.value, repeat: false }] }
  : doc.value)
// The preview uses the same logical canvas as the report image, so text and lines match its scale.
const canvas = computed(() => canvasSize(viewDoc.value))
/** Handle size factor: keeps editor handles the same size on screen at any style scale. */
const hs = computed(() => canvas.value.W / PLOT.width)
const drawing = computed(() => plotSvg(viewDoc.value, { width: canvas.value.W, height: canvas.value.H }))
const allKinds = Object.entries(WAVE_NAMES) as [PlotCurve['kind'], string][]
const dataKinds = allKinds.filter(([k]) => k === 'data' || k === 'expr')
const waveKinds = allKinds.filter(([k]) => k !== 'data' && k !== 'expr')
const exprVars = computed(() => Array.from(new Set([axisSymbol(doc.value.xLabel, 'x'), 'x'])).join(' 或 '))
const exprY = computed(() => axisSymbol(doc.value.yLabel, 'y'))
const minPoints = computed(() => curve.value?.kind === 'data' ? 1 : 2)
function setMarker(value: string) {
  change(() => { if (curve.value) curve.value.marker = value as MarkerKind })
}
function setPiece(i: number, key: keyof ExprPiece, value: string) {
  change(() => { const p = curve.value?.pieces?.[i]; if (p) p[key] = value })
}
function addPiece() {
  change(() => {
    const c = curve.value
    if (!c) return
    c.pieces ??= []
    // Continue from the previous piece's end so the intervals line up.
    const last = c.pieces[c.pieces.length - 1]
    c.pieces.push({ expr: last?.expr ?? 'x', from: last?.to ?? '', to: '' })
  })
}
function removePiece(i: number) {
  change(() => { curve.value?.pieces?.splice(i, 1) })
}
watch(selected, () => {
  singleCycle.value = true; tool.value = 'select'; tableError.value = ''
  tableText.value = ''
  if (curve.value?.kind === 'data') loadTable()
})
function syncSelection() {
  if (!doc.value.curves.some(c => c.id === selected.value)) selected.value = doc.value.curves[0]?.id || ''
  selectedNode.value = Math.min(selectedNode.value, Math.max(0, (curve.value?.nodes.length || 1) - 1))
  tableError.value = ''
}
watch(() => props.visible, async visible => {
  if (visible) {
    returnFocus = document.activeElement as HTMLElement | null
    doc.value = props.source ? clonePlot(props.source) : newPlot()
    page.value = props.defaultPage
    selected.value = doc.value.curves[0]?.id || ''
    selectedNode.value = 0
    panel.value = 'curve'; adding.value = !doc.value.curves.length; singleCycle.value = true
    past.value = []; future.value = []
    tool.value = 'select'; tableText.value = ''; tableError.value = ''
    await nextTick(); card.value?.focus()
  } else {
    cancelDrag(); returnFocus?.focus()
  }
})
function push(before: PlotDocument) {
  if (JSON.stringify(before) === JSON.stringify(doc.value)) return
  past.value.push(before)
  if (past.value.length > 80) past.value.shift()
  future.value = []
}
function change(action: () => void) { const before = clonePlot(doc.value); action(); autoFit(); push(before) }
/** While auto range is on, every edit refits the view so it ends at the largest point. */
function autoFit() {
  if (!doc.value.autoRange || cycleEditing.value || plotError({ ...doc.value, xMin: 0, xMax: 1, yMin: 0, yMax: 1 })) return
  const r = fitRange(doc.value)
  if (r) Object.assign(doc.value, r)
}
function flushWheel() {
  clearTimeout(wheelTimer)
  if (wheelBefore) { push(wheelBefore); wheelBefore = null }
}
function undo() {
  flushWheel()
  const previous = past.value.pop()
  if (previous) { future.value.push(clonePlot(doc.value)); doc.value = previous; syncSelection() }
}
function redo() {
  flushWheel()
  const next = future.value.pop()
  if (next) { past.value.push(clonePlot(doc.value)); doc.value = next; syncSelection() }
}
function valueOf(e: Event): string { return (e.target as HTMLInputElement).value }
function setDoc(key: 'title' | 'xLabel' | 'yLabel', e: Event) { change(() => { doc.value[key] = valueOf(e) }) }
function toggleShow(key: 'showTitle' | 'showAxes' | 'showNames' | 'showLegend') { change(() => { doc.value[key] = !shows(doc.value, key) }) }
function setRange(key: 'xMin' | 'xMax' | 'yMin' | 'yMax', e: Event) { change(() => { doc.value.autoRange = false; doc.value[key] = valueOf(e).trim() ? Number(valueOf(e)) : NaN }) }
function setParam(key: 'amplitude' | 'offset' | 'period' | 'phase' | 'duty', e: Event) {
  change(() => {
    if (!curve.value) return
    const c = curve.value, v = valueOf(e).trim() ? Number(valueOf(e)) : NaN
    if (key === 'period' && c.repeat && Number.isFinite(v) && v > 0 && Number.isFinite(c.period) && c.period > 0)
      c.nodes = c.nodes.map((n, i) => ({ ...n, x: i === c.nodes.length - 1 ? v : n.x / c.period * v }))
    c[key] = v
  })
}
function setLevel(high: boolean, e: Event) {
  if (!curve.value) return
  const c = curve.value, v = valueOf(e).trim() ? Number(valueOf(e)) : NaN
  change(() => {
    const other = c.offset + (high ? -c.amplitude : c.amplitude)
    c.offset = (other + v) / 2
    c.amplitude = (high ? v - other : other - v) / 2
  })
}
function addCurve(kind: PlotCurve['kind'], repeat = false) {
  if (doc.value.curves.length >= 6) return
  change(() => {
    const c = newCurve(kind, doc.value.curves.length)
    if (repeat) {
      c.name = '自定义周期'; c.repeat = true
      c.nodes = [{ x: 0, y: 0.2, next: 'line' }, { x: 0.3, y: 1, next: 'hold' }, { x: 1.1, y: -0.4, next: 'line' }, { x: 1.6, y: 0.6, next: 'hold' }, { x: 2, y: 0.6, next: 'line' }]
    }
    doc.value.curves.push(c); selected.value = c.id; selectedNode.value = 0
    // The first curve sets the initial view so it is never drawn off-screen.
    if (doc.value.curves.length === 1) { const r = fitRange(doc.value); if (r) Object.assign(doc.value, r) }
    // The first data curve switches auto range on, so the axes end at its largest point.
    if (kind === 'data' && doc.value.curves.filter(x => x.kind === 'data').length === 1) doc.value.autoRange = true
  })
  adding.value = false; panel.value = 'curve'
}
function toggleRepeat() {
  if (!curve.value) return
  change(() => {
    const c = curve.value!
    if (c.repeat) {
      c.nodes = c.nodes.map(n => ({ ...n, x: n.x + c.phase })); c.repeat = false
    } else {
      const first = c.nodes[0].x, span = c.nodes[c.nodes.length - 1].x - first
      if (!(span > 0)) return
      c.period = span; c.phase = first
      c.nodes = c.nodes.map(n => ({ ...n, x: n.x - first })); c.repeat = true; singleCycle.value = true
    }
  })
}
function removeCurve() {
  if (!curve.value) return
  change(() => { doc.value.curves = doc.value.curves.filter(c => c.id !== selected.value) }); syncSelection()
  if (!doc.value.curves.length) adding.value = true
}
function copyAsNodes() {
  if (!curve.value || error.value || doc.value.curves.length >= 6) return
  const original = curve.value
  change(() => {
    const c = newCurve('nodes', doc.value.curves.length)
    c.name = original.name + '（节点副本）'
    c.nodes = templateNodes(original, doc.value)
    doc.value.curves.push(c); selected.value = c.id; selectedNode.value = 0
  })
}
function setNode(key: 'x' | 'y' | 'next', e: Event) {
  if (!node.value) return
  change(() => {
    if (!node.value) return
    if (key === 'next') node.value.next = valueOf(e) as PlotNode['next']
    else node.value[key] = valueOf(e).trim() ? Number(valueOf(e)) : NaN
  })
}
function canDeleteAt(i: number): boolean {
  const c = curve.value
  if (!c || !hasPoints(c) || c.nodes.length <= minPoints.value || i < 0 || i >= c.nodes.length) return false
  return !(c.repeat && (i === 0 || i === c.nodes.length - 1))
}
function deleteNode() { deletePoint(selectedNode.value) }
function deletePoint(i: number | undefined) {
  if (i === undefined || !canDeleteAt(i)) return
  change(() => { curve.value!.nodes.splice(i, 1) })
  selectedNode.value = Math.max(0, i - 1); syncSelection()
}
/** Insert a point in X order (nodes curves need it; data curves keep it tidy). */
function insertPoint(x: number, y: number) {
  const c = curve.value
  if (!c || !hasPoints(c) || error.value || c.nodes.length >= 2000) return
  if (c.repeat && !cycleEditing.value) return
  if (x < viewDoc.value.xMin || x > viewDoc.value.xMax || y < doc.value.yMin || y > doc.value.yMax) return
  change(() => {
    const nodes = c.nodes
    const n: PlotNode = { x: Math.min(viewDoc.value.xMax, Math.max(viewDoc.value.xMin, rounded(x))), y: rounded(y), next: 'line' }
    // Keep repeat endpoints fixed at 0 and T by inserting strictly inside them.
    let i = nodes.findIndex(p => p.x > n.x)
    if (i < 0) i = c.repeat ? nodes.length - 1 : nodes.length
    if (c.repeat && i === 0) i = 1
    nodes.splice(i, 0, n); selectedNode.value = i
  })
}
function setPoint(i: number, key: 'x' | 'y', e: Event) {
  const raw = valueOf(e).trim()
  change(() => { const n = curve.value?.nodes[i]; if (n) n[key] = raw ? Number(raw) : NaN })
}
function onStageDblClick(e: MouseEvent) {
  if (tool.value === 'add' || (e.target as Element).closest('[data-handle]')) return
  const [x, y] = pointerPosition(e)
  insertPoint(x, y)
}
function loadTable() {
  tableText.value = curve.value?.nodes.map(n => curve.value?.kind === 'data' ? `${n.x}\t${n.y}` : `${n.x}\t${n.y}\t${n.next}`).join('\n') || ''
}
function applyTable() {
  tableError.value = ''
  const nodes: PlotNode[] = []
  const isData = curve.value?.kind === 'data'
  const rows = tableText.value.trim().split(/\r?\n/).filter(l => l.trim())
  for (const [i, line] of rows.entries()) {
    const fields = line.trim().split(/[\s,，;；]+/)
    if (isData) {
      const [x, y] = fields.slice(0, 2).map(Number)
      if (fields.length < 2 || !Number.isFinite(x) || !Number.isFinite(y)) {
        // Allow a header row such as "U/V  I/mA" copied from Excel.
        if (i === 0 && fields.some(f => !Number.isFinite(Number(f)))) continue
        tableError.value = `第 ${i + 1} 行无效：需要 X、Y 两个数字。`; return
      }
      nodes.push({ x, y, next: 'line' }); continue
    }
    const [x, y] = fields.slice(0, 2).map(Number)
    const next = fields[2] || 'line'
    if (fields.length < 2 || fields.length > 3 || !Number.isFinite(x) || !Number.isFinite(y) || !['line', 'hold', 'break'].includes(next) || (i > 0 && x < nodes[i - 1].x)) {
      tableError.value = `第 ${i + 1} 行无效：填写 X、Y，可选 line / hold / break，X 需非递减。`; return
    }
    nodes.push({ x, y, next: next as PlotNode['next'] })
  }
  if (nodes.length < minPoints.value || nodes.length > 2000) { tableError.value = `需要 ${minPoints.value} 至 2000 行数据。`; return }
  if (curve.value?.repeat && (nodes[0].x !== 0 || nodes[nodes.length - 1].x !== curve.value.period)) { tableError.value = '单周期数据必须从 X=0 开始，到 X=周期结束。'; return }
  change(() => { if (curve.value) { curve.value.nodes = nodes; selectedNode.value = 0 } })
}
function rounded(v: number) {
  return snap.value && Number.isFinite(step.value) && step.value > 0 ? Number((Math.round(v / step.value) * step.value).toPrecision(12)) : Number(v.toPrecision(8))
}
function pointerPosition(e: MouseEvent): [number, number] {
  const p = svgPoint(e)
  return fromScreen(viewDoc.value, p.x, p.y)
}
function svgPoint(e: MouseEvent): DOMPoint {
  const matrix = svg.value!.getScreenCTM()!
  return new DOMPoint(e.clientX, e.clientY).matrixTransform(matrix.inverse())
}
/** Apply a new view range. In single-cycle view X is fixed to [0, T], so only Y changes. */
function applyRange(r: PlotRange) {
  const next = clampRange(r)
  doc.value.autoRange = false // a manual view change ends auto range
  if (!cycleEditing.value) { doc.value.xMin = next.xMin; doc.value.xMax = next.xMax }
  doc.value.yMin = next.yMin; doc.value.yMax = next.yMax
}
function currentRange(): PlotRange {
  const v = viewDoc.value
  return { xMin: v.xMin, xMax: v.xMax, yMin: v.yMin, yMax: v.yMax }
}
function zoomBy(factor: number, anchor?: [number, number], axes: 'xy' | 'x' | 'y' = 'xy') {
  if (error.value) return
  const r = currentRange()
  const [ax, ay] = anchor ?? [(r.xMin + r.xMax) / 2, (r.yMin + r.yMax) / 2]
  const [xMin, xMax] = axes === 'y' ? [r.xMin, r.xMax] : zoomAxis(r.xMin, r.xMax, ax, factor)
  const [yMin, yMax] = axes === 'x' ? [r.yMin, r.yMax] : zoomAxis(r.yMin, r.yMax, ay, factor)
  applyRange({ xMin, xMax, yMin, yMax })
}
function zoomStep(factor: number) { change(() => zoomBy(factor)) }
function fitView() {
  const r = fitRange(cycleEditing.value && curve.value ? viewDoc.value : doc.value)
  if (r) change(() => { applyRange(r); if (!cycleEditing.value) doc.value.autoRange = true })
}
function toggleAutoRange() {
  change(() => { doc.value.autoRange = !doc.value.autoRange })
}
function showPeriods(n: number) {
  const c = curve.value
  if (!c || !(c.period > 0)) return
  change(() => { doc.value.autoRange = false; doc.value.xMin = Number(c.phase.toPrecision(10)); doc.value.xMax = Number((c.phase + n * c.period).toPrecision(10)) })
}
// Consecutive wheel ticks form one undo step.
let wheelBefore: PlotDocument | null = null
let wheelTimer = 0
function onWheel(e: WheelEvent) {
  if (error.value || empty.value) return
  e.preventDefault()
  if (!wheelBefore) wheelBefore = clonePlot(doc.value)
  zoomBy(e.deltaY > 0 ? 1.15 : 1 / 1.15, pointerPosition(e), e.shiftKey ? 'x' : e.altKey ? 'y' : 'xy')
  clearTimeout(wheelTimer)
  wheelTimer = window.setTimeout(() => { if (wheelBefore) push(wheelBefore); wheelBefore = null }, 400)
}
let pan: { before: PlotDocument; start: DOMPoint; range: PlotRange; pointerId: number } | null = null
const panning = ref(false)
function onStagePointerDown(e: PointerEvent) {
  card.value?.focus({ preventScroll: true })
  const creating = e.button === 0 && tool.value === 'add' && !!curve.value && hasPoints(curve.value)
  if (creating) { addNode(e); return }
  if ((e.button !== 0 && e.button !== 1) || error.value || empty.value) return
  e.preventDefault()
  pan = { before: clonePlot(doc.value), start: svgPoint(e), range: currentRange(), pointerId: e.pointerId }
  panning.value = true
  svg.value!.setPointerCapture(e.pointerId)
}
function movePan(e: PointerEvent) {
  if (!pan || pan.pointerId !== e.pointerId) return
  const p = svgPoint(e), r = pan.range, L = plotLayout(viewDoc.value)
  const dx = (p.x - pan.start.x) / L.w * (r.xMax - r.xMin)
  const dy = (p.y - pan.start.y) / L.h * (r.yMax - r.yMin)
  applyRange({ xMin: r.xMin - dx, xMax: r.xMax - dx, yMin: r.yMin + dy, yMax: r.yMax + dy })
}
function endPan(e: PointerEvent) {
  if (!pan || pan.pointerId !== e.pointerId) return
  const before = pan.before; pan = null; panning.value = false
  if (svg.value?.hasPointerCapture(e.pointerId)) svg.value.releasePointerCapture(e.pointerId)
  push(before)
}
function onPointerMove(e: PointerEvent) { if (pan) movePan(e); else moveDrag(e) }
function onPointerUp(e: PointerEvent) { if (pan) endPan(e); else endDrag(e) }
function onPointerCancel(e: PointerEvent) { if (pan) endPan(e); else cancelDrag() }
function addNode(e: PointerEvent) {
  if (e.button !== 0 || tool.value !== 'add') return
  const [x, y] = pointerPosition(e)
  insertPoint(x, y)
}
type HandleKind = 'node' | 'high' | 'low' | 'period' | 'phase' | 'duty'
const handles = computed(() => {
  const c = curve.value
  if (!c || error.value) return []
  if (c.repeat && !cycleEditing.value) return []
  if (c.kind === 'expr') return []
  const raw: { kind: HandleKind; x: number; y: number; label: string; index?: number }[] = hasPoints(c)
    ? c.nodes.map((n, i) => ({ kind: 'node', ...n, label: `${i + 1}`, index: i }))
    : [
      { kind: 'high', x: c.phase + c.period * (c.kind === 'square' ? c.duty / 2 : c.kind === 'cos' ? 0 : c.kind === 'triangle' ? 0.5 : c.kind === 'saw' ? 1 : 0.25), y: c.offset + c.amplitude, label: '上电平 / 振幅' },
      { kind: 'low', x: c.phase + c.period * (c.kind === 'square' ? (1 + c.duty) / 2 : c.kind === 'cos' ? 0.5 : c.kind === 'triangle' || c.kind === 'saw' ? 0 : 0.75), y: c.offset - c.amplitude, label: '下电平 / 振幅' },
      { kind: 'phase', x: c.phase, y: c.offset, label: '相移' },
      { kind: 'period', x: c.phase + c.period, y: c.offset, label: '周期' },
      ...(c.kind === 'square' ? [{ kind: 'duty' as const, x: c.phase + c.period * c.duty, y: c.offset, label: '占空比' }] : []),
    ]
  return raw.filter(h => h.x >= viewDoc.value.xMin && h.x <= viewDoc.value.xMax && h.y >= doc.value.yMin && h.y <= doc.value.yMax)
    .map(h => ({ ...h, pos: toScreen(viewDoc.value, h.x, h.y) }))
})
let drag: { before: PlotDocument; view: PlotDocument; c: PlotCurve; kind: HandleKind; index: number; pointerId: number } | null = null
function startDrag(e: PointerEvent, kind: HandleKind, index = 0) {
  // Right-click or Alt+click on a point deletes it.
  if (kind === 'node' && (e.button === 2 || (e.button === 0 && e.altKey))) {
    e.preventDefault(); e.stopPropagation(); deletePoint(index); return
  }
  if (e.button !== 0 || !curve.value) return
  e.preventDefault(); e.stopPropagation()
  card.value?.focus({ preventScroll: true })
  selectedNode.value = index
  panel.value = 'curve'
  drag = { before: clonePlot(doc.value), view: clonePlot(viewDoc.value), c: curve.value, kind, index, pointerId: e.pointerId }
  svg.value!.setPointerCapture(e.pointerId)
}
function moveDrag(e: PointerEvent) {
  if (!drag || drag.pointerId !== e.pointerId) return
  const { c, kind, index } = drag
  // Auto range: data points may leave the view; map the pointer with the range from drag start
  // so growing axes do not feed back into the pointer position.
  const free = kind === 'node' && c.kind === 'data' && !!doc.value.autoRange
  let [x, y] = free ? (() => { const p = svgPoint(e); return fromScreen(drag!.view, p.x, p.y) })() : pointerPosition(e)
  if (free) { x = rounded(x); y = rounded(y) }
  else {
    x = Math.min(viewDoc.value.xMax, Math.max(viewDoc.value.xMin, rounded(x)))
    y = Math.min(doc.value.yMax, Math.max(doc.value.yMin, rounded(y)))
  }
  if (kind === 'node') {
    if (c.kind === 'data') c.nodes[index].x = x // measured points may be in any order
    else if (!(c.repeat && (index === 0 || index === c.nodes.length - 1))) c.nodes[index].x = Math.min(c.nodes[index + 1]?.x ?? doc.value.xMax, Math.max(c.nodes[index - 1]?.x ?? doc.value.xMin, x))
    c.nodes[index].y = y
    if (free) autoFit()
  } else if (kind === 'phase') c.phase = x
  else if (kind === 'period') c.period = Math.max((doc.value.xMax - doc.value.xMin) / 200, x - c.phase)
  else if (kind === 'duty') c.duty = Math.min(0.99, Math.max(0.01, (x - c.phase) / c.period))
  else {
    const other = c.offset + (kind === 'high' ? -c.amplitude : c.amplitude)
    c.offset = (y + other) / 2
    c.amplitude = (kind === 'high' ? y - other : other - y) / 2
  }
}
function endDrag(e: PointerEvent) {
  if (!drag || drag.pointerId !== e.pointerId) return
  const before = drag.before; drag = null
  if (svg.value?.hasPointerCapture(e.pointerId)) svg.value.releasePointerCapture(e.pointerId)
  autoFit()
  push(before)
}
function cancelDrag() {
  if (pan) {
    const { before, pointerId } = pan; pan = null; panning.value = false; doc.value = before
    if (svg.value?.hasPointerCapture(pointerId)) svg.value.releasePointerCapture(pointerId)
  }
  if (!drag) return
  const { before, pointerId } = drag; drag = null; doc.value = before
  if (svg.value?.hasPointerCapture(pointerId)) svg.value.releasePointerCapture(pointerId)
}
onUnmounted(() => { cancelDrag(); clearTimeout(wheelTimer) })
function close() { emit('update:visible', false) }
function submit() {
  if (!canSubmit.value) return
  emit('confirm', { plot: clonePlot(doc.value), page: page.value, src: plotDataUrl(doc.value), naturalW: PLOT.width, naturalH: PLOT.height })
  close()
}
function onKeydown(e: KeyboardEvent) {
  e.stopPropagation()
  const target = e.target as HTMLElement
  const typing = target.closest('input, textarea, select') !== null
  if ((e.key === 'Delete' || e.key === 'Backspace') && !typing && curve.value && hasPoints(curve.value) && !drag) {
    e.preventDefault(); deleteNode(); return
  }
  if (e.key === 'Escape') { e.preventDefault(); if (drag || pan) cancelDrag(); else if (tool.value === 'add') tool.value = 'select'; else if (adding.value) adding.value = false; else close() }
  if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
    e.preventDefault(); if (drag) cancelDrag()
    if (e.key.toLowerCase() === 'y' || e.shiftKey) redo(); else undo()
  }
  if (e.key === 'Tab') {
    const items = Array.from(card.value!.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea, summary, [tabindex="0"]')).filter(el => el.getClientRects().length > 0)
    const first = items[0], last = items[items.length - 1]
    if (e.shiftKey && (document.activeElement === first || document.activeElement === card.value)) { e.preventDefault(); last?.focus() }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
  }
}
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="plot-backdrop" @keydown="onKeydown">
      <section ref="card" class="plot-modal" role="dialog" aria-modal="true" aria-labelledby="plot-heading" tabindex="-1">
        <header class="plot-header">
          <h2 id="plot-heading">图表绘制器</h2>
          <button class="icon-button" aria-label="关闭绘制器" @click="close">✕</button>
        </header>
        <div class="plot-body">
          <main class="plot-main">
            <div class="canvas-toolbar">
              <div class="history-tools"><button aria-label="撤销" title="撤销 Ctrl+Z" :disabled="!past.length" @click="undo">↶</button><button aria-label="重做" title="重做 Ctrl+Y" :disabled="!future.length" @click="redo">↷</button></div>
              <div class="history-tools view-tools" role="group" aria-label="视图"><button aria-label="缩小" title="缩小（或在画布上滚轮）" :disabled="!!error || empty" @click="zoomStep(1.25)">−</button><button aria-label="放大" title="放大（或在画布上滚轮）" :disabled="!!error || empty" @click="zoomStep(0.8)">＋</button><button class="fit-button" title="让坐标范围恰好容纳全部曲线" :disabled="empty" @click="fitView">适应曲线</button></div>
              <div v-if="curve && hasPoints(curve)" class="point-tools" role="group" aria-label="增删点">
                <button :class="{ chosen: tool === 'add' }" :aria-pressed="tool === 'add'" :disabled="!!error || (curve.repeat && !singleCycle) || curve.nodes.length >= 2000" title="开启后单击画布即可加点，Esc 结束；平时也可双击空白处加点" @click="tool = tool === 'add' ? 'select' : 'add'">＋ 添加点</button>
                <button class="danger" :disabled="!canDeleteAt(selectedNode) || (curve.repeat && !singleCycle)" :title="`删除选中的第 ${selectedNode + 1} 个点（Delete）`" @click="deleteNode">✕ 删除点</button>
              </div>
              <div v-if="curve?.repeat" class="mode-switch" role="group" aria-label="周期视图">
                <button :class="{ chosen: singleCycle }" :aria-pressed="singleCycle" @click="singleCycle = true; tool = 'select'">编辑一个周期</button>
                <button :class="{ chosen: !singleCycle }" :aria-pressed="!singleCycle" @click="singleCycle = false; tool = 'select'">重复预览</button>
              </div>
              <span v-else class="canvas-caption">{{ curve?.name }}</span>
              <span class="range-caption">{{ formatNumber(viewDoc.xMin) }} ≤ x ≤ {{ formatNumber(viewDoc.xMax) }}</span>
            </div>
            <div class="plot-stage" :class="{ adding: tool === 'add' && curve && hasPoints(curve), panning }">
              <svg ref="svg" :viewBox="`0 0 ${canvas.W} ${canvas.H}`" role="img" aria-label="图表预览，可拖动控制点" @pointerdown="onStagePointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp" @pointercancel="onPointerCancel" @lostpointercapture="onPointerCancel" @wheel="onWheel" @dblclick="onStageDblClick" @contextmenu.prevent @auxclick.prevent>
                <g class="plot-render" v-html="drawing" />
                <g v-if="!error" class="plot-handles">
                  <g v-for="(h, i) in handles" :key="`${selected}-${h.kind}-${i}`" :data-handle="h.kind" :data-index="h.index" @pointerdown="startDrag($event, h.kind, h.index)">
                    <title>{{ h.kind === 'node' ? `节点 ${i + 1}` : h.label }}：{{ formatNumber(h.x) }}, {{ formatNumber(h.y) }}</title>
                    <circle :cx="h.pos[0]" :cy="h.pos[1]" :r="15 * hs" fill="transparent" />
                    <circle :cx="h.pos[0]" :cy="h.pos[1]" :r="(h.kind === 'node' ? 5 : 7) * hs" :fill="h.kind === 'node' && h.index !== selectedNode ? 'white' : '#2563eb'" stroke="#2563eb" :stroke-width="2 * hs" />
                    <text v-if="h.kind !== 'node'" :x="h.pos[0] + 11 * hs" :y="h.pos[1] - 12 * hs" :font-size="13 * hs" fill="#1d4ed8" stroke="white" :stroke-width="3 * hs" paint-order="stroke">{{ h.label }}</text>
                  </g>
                </g>
              </svg>
              <div v-if="error" class="preview-error" role="alert">{{ error }}</div>
              <div v-else-if="empty" class="empty-state">
                <p>选择一种波形开始绘制</p>
                <div class="empty-templates">
                  <button v-for="[kind, name] in dataKinds" :key="kind" class="primary" @click="addCurve(kind)">{{ name }}</button>
                  <button v-for="[kind, name] in waveKinds" :key="kind" @click="addCurve(kind)">{{ name }}</button>
                  <button @click="addCurve('nodes', true)">自定义周期</button>
                </div>
              </div>
            </div>
            <p class="canvas-help" role="status">{{ empty ? '尚未添加曲线。可在画布或右侧选择模板。' : curve?.repeat ? (singleCycle ? '仅编辑这一周期，各段独立；首尾数值可以不同。' : '按原样重复，不镜像、不补对称；切回单周期即可修改。') : curve?.kind === 'data' || curve?.kind === 'nodes' ? (tool === 'add' ? '添加点模式：单击画布加点，再点“＋ 添加点”或按 Esc 结束。' : '拖动点修改；双击空白处加点；右键、Alt+单击或选中后按 Delete 删除。') : curve?.kind === 'expr' ? '在右侧输入表达式；可分多段定义分段函数。' : '拖动蓝色手柄调整波形，也可在右侧输入精确数值。' }}</p>
          </main>
          <aside class="plot-sidebar">
            <nav class="inspector-tabs" aria-label="设置面板">
              <button role="tab" :aria-selected="panel === 'curve'" aria-controls="curve-panel" @click="panel = 'curve'; adding = false">曲线</button>
              <button role="tab" :aria-selected="panel === 'chart'" aria-controls="chart-panel" @click="panel = 'chart'; adding = false">图表</button>
            </nav>
            <div v-show="panel === 'curve'" id="curve-panel" class="inspector-content" role="tabpanel" aria-label="曲线设置">
              <div class="curve-picker">
                <select v-model="selected" aria-label="当前曲线" :disabled="empty"><option v-if="empty" value="">暂无曲线</option><option v-for="c in doc.curves" :key="c.id" :value="c.id">{{ c.name }}</option></select>
                <button class="add-button" aria-label="添加曲线" :aria-expanded="adding || empty" :disabled="doc.curves.length >= 6 || empty" @click="adding = !adding">＋</button>
              </div>
              <div v-if="adding || empty" class="template-picker" aria-label="曲线模板">
                <p class="picker-group">数据 / 函数</p>
                <button v-for="[kind, name] in dataKinds" :key="kind" class="accent" @click="addCurve(kind)">{{ name }}</button>
                <p class="picker-group">波形</p>
                <button v-for="[kind, name] in waveKinds" :key="kind" @click="addCurve(kind)">{{ name }}</button>
                <button @click="addCurve('nodes', true)">自定义周期</button>
              </div>
              <template v-if="curve">
                <p class="section-caption">{{ curve.repeat ? '自定义周期' : WAVE_NAMES[curve.kind] }} <span>{{ doc.curves.length }} / 6 条</span></p>
                <template v-if="curve.kind === 'data'">
                  <label>数据点标记<select :value="curve.marker ?? 'circle'" @change="setMarker(valueOf($event))"><option value="circle">● 圆点</option><option value="square">■ 方块</option><option value="triangle">▲ 三角</option><option value="none">不显示</option></select></label>
                  <div class="point-list" role="table" aria-label="数据点">
                    <div class="point-row point-head" role="row"><span>#</span><span>X</span><span>Y</span><span /></div>
                    <div v-for="(n, i) in curve.nodes" :key="i" class="point-row" :class="{ current: i === selectedNode }" role="row" :data-point-row="i" @focusin="selectedNode = i">
                      <span class="point-index">{{ i + 1 }}</span>
                      <input type="number" step="any" :value="n.x" :aria-label="`第 ${i + 1} 点 X`" @change="setPoint(i, 'x', $event)" />
                      <input type="number" step="any" :value="n.y" :aria-label="`第 ${i + 1} 点 Y`" @change="setPoint(i, 'y', $event)" />
                      <button class="row-delete" :disabled="!canDeleteAt(i)" :aria-label="`删除第 ${i + 1} 点`" title="删除" @click="deletePoint(i)">✕</button>
                    </div>
                  </div>
                  <p class="hint">增删点用画布上方的按钮，或双击空白处加点、右键点删除。各点按 X 从小到大用直线连接。</p>
                </template>
                <template v-else-if="curve.kind === 'expr'">
                  <p class="hint">自变量写 {{ exprVars }}。支持 + − × ÷ ^、2x 省略乘号、pi、e，以及 sin cos tan sqrt abs exp ln log 等函数。区间留空表示无限。</p>
                  <div v-for="(p, i) in curve.pieces" :key="i" class="piece">
                    <div class="piece-head"><span>{{ (curve.pieces?.length ?? 0) > 1 ? `第 ${i + 1} 段` : '表达式' }}</span><button v-if="(curve.pieces?.length ?? 0) > 1" class="link danger" :aria-label="`删除第 ${i + 1} 段`" @click="removePiece(i)">删除</button></div>
                    <label class="expr-input"><span class="expr-prefix">{{ exprY }} =</span><input :value="p.expr" spellcheck="false" placeholder="例如 0.5x^2 + 1" :aria-label="`第 ${i + 1} 段表达式`" @change="setPiece(i, 'expr', valueOf($event))" /></label>
                    <div class="piece-range"><input :value="p.from" placeholder="−∞" :aria-label="`第 ${i + 1} 段起点`" @change="setPiece(i, 'from', valueOf($event))" /><span>≤ {{ exprVars.split(' ')[0] }} &lt;</span><input :value="p.to" placeholder="+∞" :aria-label="`第 ${i + 1} 段终点`" @change="setPiece(i, 'to', valueOf($event))" /></div>
                  </div>
                  <button class="wide-button" :disabled="(curve.pieces?.length ?? 0) >= 12" @click="addPiece">＋ 添加分段</button>
                </template>
                <template v-else-if="isWave(curve)">
                  <div class="field-grid">
                    <template v-if="curve.kind === 'square'"><label>高电平<input type="number" step="any" :value="curve.offset + curve.amplitude" @change="setLevel(true, $event)" /></label><label>低电平<input type="number" step="any" :value="curve.offset - curve.amplitude" @change="setLevel(false, $event)" /></label></template>
                    <label v-else>振幅 A<input type="number" step="any" :value="curve.amplitude" @change="setParam('amplitude', $event)" /></label>
                    <label>周期 T<input type="number" step="any" :value="curve.period" @change="setParam('period', $event)" /></label>
                    <label v-if="curve.kind === 'square'">占空比（0—1）<input type="number" min="0.01" max="0.99" step="0.01" :value="curve.duty" @change="setParam('duty', $event)" /></label>
                  </div>
                </template>
                <template v-else>
                  <label class="check repeat-control"><input type="checkbox" :checked="curve.repeat || false" @change="toggleRepeat" />按周期重复</label>
                  <label v-if="curve.repeat">周期 T<input type="number" step="any" :value="curve.period" @change="setParam('period', $event)" /></label>
                  <label>当前节点<select v-model="selectedNode" aria-label="当前节点"><option v-for="(_, i) in curve.nodes" :key="i" :value="i">节点 {{ i + 1 }}</option></select></label>
                  <template v-if="node">
                    <div class="field-grid"><label>X<input type="number" step="any" :value="node.x" :disabled="curve.repeat && (selectedNode === 0 || selectedNode === curve.nodes.length - 1)" @change="setNode('x', $event)" /></label><label>Y<input type="number" step="any" :value="node.y" @change="setNode('y', $event)" /></label></div>
                    <label v-if="selectedNode < curve.nodes.length - 1">到下一节点<select aria-label="到下一节点" :value="node.next" @change="setNode('next', $event)"><option value="line">直线连接</option><option value="hold">保持当前 Y，再跳变</option><option value="break">断开，不连接</option></select></label>
                  </template>
                </template>
                <details v-if="isWave(curve) || curve.kind === 'nodes'" :key="selected + '-parameters'" class="more-parameters">
                  <summary>更多参数</summary>
                  <label v-if="isWave(curve) || curve.repeat">相移 s（X 单位）<input type="number" step="any" :value="curve.phase" @change="setParam('phase', $event)" /></label>
                  <label v-if="isWave(curve) && curve.kind !== 'square'">偏移 b<input type="number" step="any" :value="curve.offset" @change="setParam('offset', $event)" /></label>
                  <p v-if="curve.kind === 'sin' || curve.kind === 'cos'" class="formula">y = A {{ curve.kind }}(2π(x − s) / T) + b</p>
                  <label class="check"><input v-model="snap" type="checkbox" />网格吸附</label>
                  <label class="inline-field">步长<input v-model.number="step" type="number" min="0.000001" step="any" aria-label="吸附步长" /></label>
                </details>
                <details v-if="hasPoints(curve)" :key="selected + '-data'" class="node-data">
                  <summary>{{ curve.kind === 'data' ? '粘贴数据（Excel）' : '粘贴 / 编辑数据' }}</summary>
                  <p class="hint">{{ curve.kind === 'data' ? '每行 X、Y，可直接粘贴 Excel 两列，顺序不限。' : `每行 X、Y；可粘贴 Excel 两列。第三列可填 line / hold / break。${curve.repeat ? 'X 从 0 到周期 T。' : ''}` }}</p>
                  <textarea v-model="tableText" aria-label="节点数据" rows="7" placeholder="0&#9;1&#10;1&#9;-1&#10;2&#9;1" />
                  <div class="button-row"><button @click="loadTable">读取当前节点</button><button @click="applyTable">应用数据</button></div>
                  <p v-if="tableError" class="error" role="alert">{{ tableError }}</p>
                </details>
                <details :key="selected + '-style'" class="curve-appearance">
                  <summary>样式与操作</summary>
                  <label>名称<input :value="curve.name" maxlength="24" @change="change(() => { if (curve) curve.name = valueOf($event) })" /></label>
                  <div class="style-row"><label>颜色<input type="color" :value="curve.color" @input="change(() => { if (curve) curve.color = valueOf($event) })" /></label><label class="check"><input type="checkbox" :checked="curve.dashed" @change="change(() => { if (curve) curve.dashed = !curve.dashed })" />虚线</label></div>
                  <button v-if="isWave(curve)" class="wide-button" :disabled="!!error || doc.curves.length >= 6" @click="copyAsNodes">复制为节点曲线</button>
                  <p v-if="isWave(curve)" class="hint">保留原模板；正弦、余弦副本是近似折线。</p>
                  <div class="button-row"><button class="danger" @click="removeCurve">删除曲线</button></div>
                </details>
              </template>
            </div>
            <div v-show="panel === 'chart'" id="chart-panel" class="inspector-content" role="tabpanel" aria-label="图表设置">
              <label>图表标题<input :value="doc.title" maxlength="48" :disabled="!shows(doc, 'showTitle')" @change="setDoc('title', $event)" /></label>
              <h3>坐标范围</h3>
              <div class="range-summary"><span>X {{ formatNumber(doc.xMin) }} ~ {{ formatNumber(doc.xMax) }}</span><span>Y {{ formatNumber(doc.yMin) }} ~ {{ formatNumber(doc.yMax) }}</span></div>
              <div class="button-row range-actions"><button :disabled="empty" @click="fitView">适应曲线</button><button :disabled="!!error || empty" @click="zoomStep(0.8)">放大</button><button :disabled="!!error || empty" @click="zoomStep(1.25)">缩小</button></div>
              <label class="check"><input type="checkbox" :checked="!!doc.autoRange" @change="toggleAutoRange" />自动适应（范围止于数据最大值，缩放 / 平移后自动关闭）</label>
              <template v-if="curve && curve.period > 0 && (isWave(curve) || curve.repeat)">
                <p class="hint">按当前曲线的周期设置 X 范围：</p>
                <div class="button-row period-presets"><button v-for="n in [1, 2, 3, 5, 10]" :key="n" @click="showPeriods(n)">{{ n }} 个周期</button></div>
              </template>
              <p class="hint">在画布上：滚轮缩放（Shift 仅 X，Alt 仅 Y），拖动空白处平移。</p>
              <div class="field-grid exact-range"><label>X 最小值<input type="number" step="any" :value="doc.xMin" @change="setRange('xMin', $event)" /></label><label>X 最大值<input type="number" step="any" :value="doc.xMax" @change="setRange('xMax', $event)" /></label><label>Y 最小值<input type="number" step="any" :value="doc.yMin" @change="setRange('yMin', $event)" /></label><label>Y 最大值<input type="number" step="any" :value="doc.yMax" @change="setRange('yMax', $event)" /></label></div>
              <h3>坐标名称</h3>
              <div class="field-grid"><label>X 轴<input :value="doc.xLabel" maxlength="32" placeholder="名称 / 单位" @change="setDoc('xLabel', $event)" /></label><label>Y 轴<input :value="doc.yLabel" maxlength="32" placeholder="名称 / 单位" @change="setDoc('yLabel', $event)" /></label></div>
              <h3>显示</h3>
              <div class="show-grid">
                <label class="check"><input type="checkbox" :checked="shows(doc, 'showAxes')" @change="toggleShow('showAxes')" />坐标轴</label>
                <label class="check"><input type="checkbox" :checked="shows(doc, 'showNames')" @change="toggleShow('showNames')" />坐标名称</label>
                <label class="check"><input type="checkbox" :checked="doc.grid" @change="change(() => { doc.grid = !doc.grid })" />网格线</label>
                <label class="check"><input type="checkbox" :checked="shows(doc, 'showTitle')" @change="toggleShow('showTitle')" />图表标题</label>
                <label class="check"><input type="checkbox" :checked="shows(doc, 'showLegend')" @change="toggleShow('showLegend')" />图例</label>
              </div>
              <label class="check"><input type="checkbox" :checked="doc.joinJumps" @change="change(() => { doc.joinJumps = !doc.joinJumps })" />用竖线标记跳变</label>
              <p class="hint">{{ doc.joinJumps ? '竖线表示瞬时切换，不平滑跳变。' : '跳变断开；空心为左侧极限，实心为右侧取值。' }}</p>
            </div>
          </aside>
        </div>
        <footer class="plot-footer"><label class="page-picker">位置<select v-model="page" :disabled="editing" aria-label="图表插入页"><option :value="1">第 1 页</option><option :value="2">第 2 页</option></select></label><div class="button-row"><button @click="close">取消</button><button class="primary" :disabled="!canSubmit" :title="empty ? '请先添加曲线' : undefined" @click="submit">{{ editing ? '保存图表' : '插入报告' }}</button></div></footer>
      </section>
    </div>
  </Teleport>
</template>

<style scoped>
.plot-backdrop { position: fixed; inset: 0; z-index: 1000; background: #11182788; display: flex; align-items: center; justify-content: center; padding: 20px; }
.plot-modal { width: min(1220px, 100%); height: min(780px, calc(100dvh - 40px)); display: flex; flex-direction: column; background: var(--panel); border-radius: 14px; box-shadow: 0 24px 80px #0004; outline: none; overflow: hidden; }
.plot-header { padding: 15px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; flex-shrink: 0; }
h2 { margin: 0; font-size: 18px; } h3 { margin: 24px 0 12px; font-size: 13px; color: #4b5563; }
button, select, input, textarea { font: inherit; font-size: 13px; }
button { border: 1px solid #d1d5db; background: white; border-radius: 7px; padding: 8px 12px; color: var(--text); white-space: nowrap; }
button:hover:not(:disabled) { border-color: var(--primary); color: var(--primary); }
button:disabled { opacity: .4; cursor: not-allowed; }
button.primary { background: var(--primary); color: white; border-color: var(--primary); }
button.chosen { background: #eff6ff; border-color: #93c5fd; color: #1d4ed8; }
button.danger { color: #b91c1c; }
button.icon-button { border: 0; background: transparent; width: 34px; height: 34px; padding: 0; color: var(--muted); font-size: 17px; }
input:focus-visible, select:focus-visible, textarea:focus-visible, button:focus-visible, summary:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
.plot-body { display: grid; grid-template-columns: minmax(0, 1fr) 292px; flex: 1; min-height: 0; }
.plot-main { display: flex; flex-direction: column; min-height: 0; min-width: 0; padding: 16px 20px; background: #f8fafc; }
.canvas-toolbar { display: flex; align-items: center; gap: 14px; min-height: 36px; margin-bottom: 12px; flex-wrap: wrap; }
.history-tools { display: flex; gap: 2px; }.history-tools button { width: 32px; height: 32px; padding: 0; font-size: 22px; background: transparent; border-color: transparent; }
.canvas-caption { font-size: 13px; color: #475569; max-width: 170px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.range-caption { font-size: 12px; color: #64748b; margin-left: auto; }
.mode-switch { display: flex; border: 1px solid #dbe2ea; border-radius: 7px; padding: 2px; background: white; }.mode-switch button { border: 0; padding: 5px 9px; }.mode-switch button.chosen { background: #eff6ff; }
.plot-stage { position: relative; background: white; border: 1px solid #e2e8f0; border-radius: 9px; overflow: hidden; flex: 1; min-height: 0; }
.plot-stage svg { display: block; width: 100%; height: 100%; touch-action: none; user-select: none; }
.plot-render { pointer-events: none; }.plot-stage svg { cursor: grab; }.plot-stage.panning svg { cursor: grabbing; }.plot-stage.adding svg { cursor: crosshair; }
.view-tools .fit-button { width: auto; font-size: 13px; padding: 0 8px; }
.range-summary { display: flex; flex-direction: column; gap: 4px; font-size: 13px; color: #334155; font-variant-numeric: tabular-nums; margin-bottom: 12px; }
.range-actions button { flex: 1; }.period-presets { margin-bottom: 12px; }.period-presets button { padding: 6px 9px; }
.exact-range { margin-top: 12px; }.plot-handles { cursor: grab; }.plot-handles text { pointer-events: none; opacity: 0; }.plot-handles > g:hover text { opacity: 1; }.adding { cursor: crosshair; }
.preview-error { position: absolute; inset: 0; display: grid; place-items: center; padding: 24px; color: #b91c1c; background: #fff7ed; }
.empty-state { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px; padding: 24px; background: #ffffffcc; }
.empty-state p { margin: 0; color: #475569; font-size: 15px; }
.empty-templates { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; max-width: 460px; }
.canvas-help { margin: 12px 0 0; color: #64748b; font-size: 12px; line-height: 1.7; min-height: 21px; }
.plot-sidebar { border-left: 1px solid var(--border); display: flex; flex-direction: column; min-height: 0; min-width: 0; }
.inspector-tabs { display: flex; border-bottom: 1px solid var(--border); padding: 0 18px; flex-shrink: 0; }
.inspector-tabs button { flex: 1; border: 0; border-radius: 0; background: transparent; color: var(--muted); padding: 15px 0 13px; border-bottom: 2px solid transparent; font-weight: 500; }
.inspector-tabs button[aria-selected=true] { border-bottom-color: var(--primary); color: var(--primary); }
.inspector-content { padding: 18px; overflow-y: auto; min-height: 0; flex: 1; }
.curve-picker { display: flex; align-items: center; gap: 8px; }.curve-picker select { flex: 1; }.add-button { font-size: 20px; padding: 0; height: 36px; width: 36px; }
.template-picker { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; padding: 10px; margin: 10px 0 0; border: 1px solid #dbe2ea; border-radius: 8px; background: #f8fafc; }
.picker-group { grid-column: 1 / -1; margin: 4px 0 0; font-size: 12px; color: #64748b; }.picker-group:first-child { margin-top: 0; }
button.accent { color: var(--primary); border-color: #bfdbfe; }
.point-list { border: 1px solid #e2e8f0; border-radius: 8px; max-height: 260px; overflow-y: auto; margin-bottom: 8px; }
.point-row { display: grid; grid-template-columns: 26px 1fr 1fr 30px; gap: 4px; align-items: center; padding: 3px 6px; }
.point-row input { padding: 5px 6px; }
.point-row.current { background: #eff6ff; }
.point-head { position: sticky; top: 0; background: #f8fafc; font-size: 12px; color: #64748b; padding-top: 6px; padding-bottom: 6px; border-bottom: 1px solid #e2e8f0; z-index: 1; }
.point-index { font-size: 12px; color: #94a3b8; text-align: right; font-variant-numeric: tabular-nums; }
button.row-delete { border: 0; background: transparent; padding: 4px; color: #94a3b8; font-size: 13px; }
button.row-delete:hover:not(:disabled) { color: #dc2626; }
.show-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }.show-grid .check { margin: 6px 0; }
.point-tools { display: flex; gap: 4px; }.point-tools button { padding: 5px 10px; }
.piece { border: 1px solid #e2e8f0; border-radius: 8px; padding: 10px; margin-bottom: 10px; background: #f8fafc; }
.piece-head { display: flex; justify-content: space-between; align-items: center; font-size: 12px; color: #64748b; margin-bottom: 8px; }
button.link { border: 0; background: transparent; padding: 0 2px; font-size: 12px; }
.expr-input { flex-direction: row; align-items: center; gap: 6px; margin-bottom: 8px; }.expr-prefix { white-space: nowrap; font-family: 'Times New Roman', serif; font-style: italic; color: #334155; }
.expr-input input { font-family: Consolas, monospace; }
.piece-range { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: 6px; font-size: 12px; color: #64748b; }.piece-range span { white-space: nowrap; }
.section-caption { margin: 20px 0 12px; color: #64748b; font-size: 12px; display: flex; justify-content: space-between; }.section-caption span { color: #94a3b8; }
label { display: flex; flex-direction: column; gap: 7px; font-size: 13px; color: #475569; min-width: 0; margin-bottom: 16px; }
input, select, textarea { width: 100%; min-width: 0; padding: 8px 10px; border: 1px solid #d1d5db; border-radius: 6px; background: white; color: var(--text); }
input:disabled { background: #f8fafc; color: #94a3b8; }
input[type=color] { padding: 2px; height: 36px; }.field-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.check { flex-direction: row; align-items: center; gap: 8px; margin: 12px 0; }.check input { width: auto; }
details { border-top: 1px solid var(--border); padding: 14px 0; } summary { cursor: pointer; font-size: 13px; color: #475569; }details[open] summary { margin-bottom: 16px; }
.formula { font-size: 12px; color: #64748b; overflow-wrap: anywhere; line-height: 1.7; }
.inline-field { flex-direction: row; align-items: center; justify-content: space-between; margin: 12px 0 0; }.inline-field input { width: 100px; }
.style-row { display: flex; align-items: center; gap: 22px; }.style-row label:first-child { flex: 1; }.wide-button { width: 100%; }
.button-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
textarea { resize: vertical; font-family: monospace; margin-bottom: 10px; }.hint, .error { font-size: 12px; line-height: 1.7; color: #64748b; overflow-wrap: anywhere; }.error { color: #b91c1c; }
.plot-footer { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 20px; border-top: 1px solid var(--border); flex-shrink: 0; }
.page-picker { flex-direction: row; align-items: center; margin: 0; gap: 8px; white-space: nowrap; }.page-picker select { width: auto; }
@media (max-width: 760px) {
  .plot-backdrop { padding: 8px; }.plot-modal { height: calc(100dvh - 16px); }.plot-header { padding: 10px 12px; }
  .plot-body { display: flex; flex-direction: column; overflow-y: auto; }.plot-main { flex-shrink: 0; padding: 10px 12px; }.plot-stage { flex: none; height: auto; aspect-ratio: 8 / 5; }.plot-stage svg { height: 100%; }
  .canvas-toolbar { gap: 8px; margin-bottom: 8px; }.range-caption { display: none; }.mode-switch button { font-size: 12px; padding: 5px 7px; }.canvas-help { margin-top: 8px; }
  .plot-sidebar { border-left: 0; border-top: 1px solid var(--border); flex-shrink: 0; overflow: visible; }.inspector-content { overflow: visible; flex: none; padding: 14px; }.inspector-tabs { padding: 0 14px; }.inspector-tabs button { padding: 12px 0; }
  .plot-footer { padding: 10px 12px; gap: 6px; }.plot-footer button { padding: 8px 10px; }
}
</style>
