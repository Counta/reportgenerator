<script setup lang="ts">
import { computed, nextTick, onUnmounted, ref, watch } from 'vue'
import {
  RotateCw,
  FlipHorizontal2,
  Trash2,
  Undo2,
  Redo2,
  Eraser,
  File,
} from 'lucide-vue-next'
import type { CircuitElement } from '@/types'
import {
  COMPONENTS,
  COMPONENT_MAP,
  GRID,
  elementBBox,
  elementMarkup,
  junctionMarkup,
  routeWires,
  snap,
} from '@/lib/circuit'

const props = defineProps<{
  visible: boolean
  /** 编辑已有电路图时传入其元件；新建时为空数组 */
  elements: CircuitElement[]
  /** 是否为编辑已有电路图 */
  editing?: boolean
  defaultPage: number
}>()

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
  (e: 'confirm', payload: { elements: CircuitElement[]; page: number }): void
}>()

const CANVAS_W = 1200
const CANVAS_H = 800

const els = ref<CircuitElement[]>([])
const tool = ref<string>('select')
const selectedId = ref<string | null>(null)
const page = ref(1)
const history = ref<CircuitElement[][]>([])
const future = ref<CircuitElement[][]>([])
const svgRef = ref<SVGSVGElement | null>(null)
const cardRef = ref<HTMLDivElement | null>(null)
const hover = ref<[number, number] | null>(null)

// ===== 触摸屏：双指捏合缩放画布（仅绘图区，工具栏不缩放） =====
const canvasZoom = ref(1)
const canvasWrapRef = ref<HTMLElement | null>(null)

let canvasPinch: { dist: number; zoom: number; cx: number; cy: number } | null = null

function onCanvasTouchStart(e: TouchEvent) {
  if (e.touches.length !== 2) return
  const svg = svgRef.value
  if (!svg) return
  const a = e.touches[0]
  const b = e.touches[1]
  const midX = (a.clientX + b.clientX) / 2
  const midY = (a.clientY + b.clientY) / 2
  const rect = svg.getBoundingClientRect()
  canvasPinch = {
    dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
    zoom: canvasZoom.value,
    cx: (midX - rect.left) / canvasZoom.value,
    cy: (midY - rect.top) / canvasZoom.value,
  }
  // 双指落下：回滚进行中的单指拖拽，避免误放/误移元件
  window.dispatchEvent(new PointerEvent('pointercancel'))
  e.preventDefault()
}

function onCanvasTouchMove(e: TouchEvent) {
  if (!canvasPinch || e.touches.length < 2) return
  const wrap = canvasWrapRef.value
  const svg = svgRef.value
  if (!wrap || !svg) return
  const a = e.touches[0]
  const b = e.touches[1]
  const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  const zoom = Math.min(4, Math.max(0.25, canvasPinch.zoom * (dist / canvasPinch.dist)))
  canvasZoom.value = zoom
  // 同步改属性保证布局立即更新，滚动锚点计算才准确
  svg.setAttribute('width', String(CANVAS_W * zoom))
  svg.setAttribute('height', String(CANVAS_H * zoom))
  const midX = (a.clientX + b.clientX) / 2
  const midY = (a.clientY + b.clientY) / 2
  const rect = svg.getBoundingClientRect()
  wrap.scrollLeft += rect.left - (midX - canvasPinch.cx * zoom)
  wrap.scrollTop += rect.top - (midY - canvasPinch.cy * zoom)
  e.preventDefault()
}

function onCanvasTouchEnd(e: TouchEvent) {
  if (e.touches.length < 2) canvasPinch = null
}

const groups = computed(() => {
  const map = new Map<string, typeof COMPONENTS>()
  for (const c of COMPONENTS) {
    if (!map.has(c.group)) map.set(c.group, [])
    map.get(c.group)!.push(c)
  }
  return [...map.entries()]
})

const selected = computed(() => els.value.find((e) => e.id === selectedId.value) || null)
const selectedDef = computed(() => (selected.value ? COMPONENT_MAP[selected.value.kind] : null))

watch(
  () => props.visible,
  (v) => {
    if (!v) return
    els.value = props.elements.map((e) => ({ ...e }))
    page.value = props.defaultPage || 1
    tool.value = props.elements.length ? 'select' : 'wire'
    selectedId.value = null
    history.value = []
    future.value = []
    nextTick(() => cardRef.value?.focus())
  },
  { immediate: true },
)

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7)
}

function snapshot() {
  history.value.push(els.value.map((e) => ({ ...e })))
  if (history.value.length > 100) history.value.shift()
  future.value = []
}

function undo() {
  const prev = history.value.pop()
  if (!prev) return
  future.value.push(els.value.map((e) => ({ ...e })))
  els.value = prev
  selectedId.value = null
}

function redo() {
  const next = future.value.pop()
  if (!next) return
  history.value.push(els.value.map((e) => ({ ...e })))
  els.value = next
  selectedId.value = null
}

/** 屏幕坐标 -> 画布坐标 */
function toCanvas(e: PointerEvent): [number, number] {
  const svg = svgRef.value!
  const m = svg.getScreenCTM()
  if (!m) return [0, 0]
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse())
  return [p.x, p.y]
}

function clampPt(x: number, y: number): [number, number] {
  return [Math.min(Math.max(snap(x), 0), CANVAS_W), Math.min(Math.max(snap(y), 0), CANVAS_H)]
}

/** 双端元件约束为水平或竖直（与 Circuit Diagram 一致） */
function orthogonal(x1: number, y1: number, x: number, y: number): [number, number] {
  return Math.abs(x - x1) >= Math.abs(y - y1) ? [x, y1] : [x1, y]
}

type Drag =
  | { type: 'create'; id: string }
  | { type: 'move'; id: string; start: [number, number]; orig: CircuitElement; moved: boolean }
  | { type: 'end'; id: string; which: 1 | 2; orig: CircuitElement }

let drag: Drag | null = null
let pendingSnapshot: CircuitElement[] | null = null

function beginChange() {
  pendingSnapshot = els.value.map((e) => ({ ...e }))
}

function commitChange() {
  if (!pendingSnapshot) return
  if (JSON.stringify(pendingSnapshot) !== JSON.stringify(els.value)) {
    history.value.push(pendingSnapshot)
    future.value = []
  }
  pendingSnapshot = null
}

function onCanvasDown(e: PointerEvent) {
  if (e.button !== 0) return
  // 触摸时忽略非主手指，避免双指操作误触画布
  if (e.pointerType === 'touch' && !e.isPrimary) return
  const [x, y] = clampPt(...toCanvas(e))
  if (tool.value === 'select') {
    selectedId.value = null
    return
  }
  const def = COMPONENT_MAP[tool.value]
  if (!def) return
  beginChange()
  const el: CircuitElement = {
    id: uid(),
    kind: def.kind,
    x1: x,
    y1: y,
    x2: x,
    y2: y,
    rot: 0,
    label: def.defaultLabel ? nextLabel(def.defaultLabel) : undefined,
  }
  if (def.kind === 'text') {
    const t = window.prompt('输入文字', '')
    if (!t) {
      pendingSnapshot = null
      return
    }
    el.label = t
  }
  els.value.push(el)
  selectedId.value = el.id
  if (def.mode === 'line' || e.pointerType === 'touch') {
    drag = { type: 'create', id: el.id }
    startWindowDrag()
  } else {
    commitChange()
  }
}

/** 自动编号：R → R1、R2… */
function nextLabel(base: string): string {
  let n = 1
  const used = new Set(els.value.map((e) => e.label))
  while (used.has(`${base}${n}`)) n++
  return `${base}${n}`
}

function onElementDown(e: PointerEvent, el: CircuitElement) {
  if (tool.value !== 'select' || e.button !== 0) return
  if (e.pointerType === 'touch' && !e.isPrimary) return
  e.stopPropagation()
  selectedId.value = el.id
  beginChange()
  drag = { type: 'move', id: el.id, start: toCanvas(e), orig: { ...el }, moved: false }
  startWindowDrag()
}

function onHandleDown(e: PointerEvent, el: CircuitElement, which: 1 | 2) {
  if (e.button !== 0) return
  if (e.pointerType === 'touch' && !e.isPrimary) return
  e.stopPropagation()
  beginChange()
  drag = { type: 'end', id: el.id, which, orig: { ...el } }
  startWindowDrag()
}

function findEl(id: string) {
  return els.value.find((e) => e.id === id)
}

function onWindowMove(e: PointerEvent) {
  if (!drag || !svgRef.value) return
  const [rx, ry] = toCanvas(e)
  const el = findEl(drag.id)
  if (!el) return
  if (drag.type === 'create') {
    const [x, y] = clampPt(rx, ry)
    ;[el.x2, el.y2] = orthogonal(el.x1, el.y1, x, y)
  } else if (drag.type === 'end') {
    const [x, y] = clampPt(rx, ry)
    if (drag.which === 1) [el.x1, el.y1] = orthogonal(el.x2, el.y2, x, y)
    else [el.x2, el.y2] = orthogonal(el.x1, el.y1, x, y)
  } else {
    const dx = snap(rx - drag.start[0])
    const dy = snap(ry - drag.start[1])
    if (dx || dy) drag.moved = true
    el.x1 = drag.orig.x1 + dx
    el.y1 = drag.orig.y1 + dy
    el.x2 = drag.orig.x2 + dx
    el.y2 = drag.orig.y2 + dy
  }
}

function onWindowUp() {
  if (drag?.type === 'create') {
    const el = findEl(drag.id)
    if (el && el.x1 === el.x2 && el.y1 === el.y2) {
      const def = COMPONENT_MAP[el.kind]!
      if (def.kind === 'wire') {
        // 单击未拖动的导线无意义，丢弃
        els.value = els.value.filter((x) => x.id !== el.id)
        selectedId.value = null
      } else {
        // 单击放置：给一个默认长度（主体 + 两侧各 1 格引线）
        el.x2 = el.x1 + Math.ceil(((def.bodyLen || 0) + GRID * 2) / GRID) * GRID
      }
    }
  }
  drag = null
  commitChange()
  window.removeEventListener('pointermove', onWindowMove)
  window.removeEventListener('pointerup', onWindowUp)
  window.removeEventListener('pointercancel', onWindowCancel)
}

/** 捏合等导致的取消：回滚本次未完成的拖拽 */
function onWindowCancel() {
  const active = drag
  if (!active) return
  const el = findEl(active.id)
  if (active.type === 'create') {
    els.value = els.value.filter((x) => x.id !== active.id)
    if (selectedId.value === active.id) selectedId.value = null
  } else if (el) {
    Object.assign(el, active.orig)
  }
  drag = null
  pendingSnapshot = null
  window.removeEventListener('pointermove', onWindowMove)
  window.removeEventListener('pointerup', onWindowUp)
  window.removeEventListener('pointercancel', onWindowCancel)
}

function startWindowDrag() {
  window.addEventListener('pointermove', onWindowMove)
  window.addEventListener('pointerup', onWindowUp)
  window.addEventListener('pointercancel', onWindowCancel)
}

onUnmounted(() => {
  window.removeEventListener('pointermove', onWindowMove)
  window.removeEventListener('pointerup', onWindowUp)
  window.removeEventListener('pointercancel', onWindowCancel)
})

function onCanvasHover(e: PointerEvent) {
  hover.value = tool.value === 'select' ? null : clampPt(...toCanvas(e))
}

function removeSelected() {
  if (!selectedId.value) return
  snapshot()
  els.value = els.value.filter((e) => e.id !== selectedId.value)
  selectedId.value = null
}

function rotateSelected() {
  const el = selected.value
  if (!el) return
  snapshot()
  const def = COMPONENT_MAP[el.kind]
  if (def?.mode === 'line') {
    // 绕中点旋转 90°
    const cx = snap((el.x1 + el.x2) / 2)
    const cy = snap((el.y1 + el.y2) / 2)
    const r = (x: number, y: number): [number, number] => [cx - (y - cy), cy + (x - cx)]
    ;[el.x1, el.y1] = r(el.x1, el.y1)
    ;[el.x2, el.y2] = r(el.x2, el.y2)
  } else {
    el.rot = ((el.rot || 0) + 90) % 360
  }
}

function flipSelected() {
  const el = selected.value
  if (!el || selectedDef.value?.mode !== 'line') return
  snapshot()
  ;[el.x1, el.y1, el.x2, el.y2] = [el.x2, el.y2, el.x1, el.y1]
}

let labelSnapTaken = false
function onLabelInput(e: Event) {
  const el = selected.value
  if (!el) return
  if (!labelSnapTaken) {
    snapshot()
    labelSnapTaken = true
  }
  el.label = (e.target as HTMLInputElement).value
}
watch(selectedId, () => (labelSnapTaken = false))

function clearAll() {
  if (!els.value.length) return
  if (!window.confirm('确定清空画布？')) return
  snapshot()
  els.value = []
  selectedId.value = null
}

function close() {
  emit('update:visible', false)
}

function submit() {
  if (els.value.length === 0) {
    window.alert('电路图为空')
    return
  }
  emit('confirm', { elements: els.value.map((e) => ({ ...e })), page: page.value })
  close()
}

function onKeydown(e: KeyboardEvent) {
  const target = e.target as HTMLElement
  const typing = target.tagName === 'INPUT' || target.tagName === 'SELECT'
  e.stopPropagation()
  if (e.key === 'Escape') {
    if (tool.value !== 'select') tool.value = 'select'
    else close()
    return
  }
  if (typing) return
  const mod = e.ctrlKey || e.metaKey
  if (mod && (e.key === 'z' || e.key === 'Z')) {
    e.preventDefault()
    e.shiftKey ? redo() : undo()
  } else if (mod && (e.key === 'y' || e.key === 'Y')) {
    e.preventDefault()
    redo()
  } else if (e.key === 'Delete' || e.key === 'Backspace') {
    e.preventDefault()
    removeSelected()
  } else if (e.key === 'r' || e.key === 'R') {
    rotateSelected()
  } else if (e.key === 'w' || e.key === 'W') {
    tool.value = 'wire'
  } else if (e.key === 's' || e.key === 'S') {
    tool.value = 'select'
  }
}

/** 选中框 */
const selectionBox = computed(() => {
  if (!selected.value) return null
  const b = elementBBox(selected.value)
  return { x: b[0] - 3, y: b[1] - 3, w: b[2] - b[0] + 6, h: b[3] - b[1] + 6 }
})

function hitBox(el: CircuitElement) {
  const b = elementBBox(el)
  const pad = 4
  return { x: b[0] - pad, y: b[1] - pad, width: b[2] - b[0] + pad * 2, height: b[3] - b[1] + pad * 2 }
}

/** 调色板图标：在 60×40 内绘制一个示例元件 */
function paletteIcon(kind: string): string {
  const def = COMPONENT_MAP[kind]!
  let el: CircuitElement
  if (def.mode === 'line') el = { id: 'p', kind, x1: 0, y1: 0, x2: 60, y2: 0 }
  else el = { id: 'p', kind, x1: 0, y1: 0, x2: 0, y2: 0 }
  if (kind === 'text') return '<text x="0" y="0" font-size="22" text-anchor="middle" dominant-baseline="central" stroke="none" fill="currentColor">T</text>'
  const b = elementBBox(el)
  const cx = (b[0] + b[2]) / 2
  const cy = (b[1] + b[3]) / 2
  const s = Math.min(1, 52 / Math.max(b[2] - b[0], 1), 34 / Math.max(b[3] - b[1], 1))
  return `<g transform="scale(${s}) translate(${-cx},${-cy})">${elementMarkup(el)}</g>`
}

const iconCache = Object.fromEntries(COMPONENTS.map((c) => [c.kind, paletteIcon(c.kind)]))

const junctions = computed(() => junctionMarkup(els.value))
/** 渲染用：导线已为共线元件让路 */
const rendered = computed(() => routeWires(els.value))
</script>

<template>
  <div v-if="visible" class="modal-backdrop" @click.self="close">
    <div
      ref="cardRef"
      class="modal-card"
      role="dialog"
      aria-modal="true"
      aria-label="电路图编辑器"
      tabindex="-1"
      @keydown="onKeydown"
    >
      <header class="modal-header">
        <div class="modal-title">
          <span>{{ editing ? '编辑电路图' : '绘制电路图' }}</span>
          <span class="hint">拖动放置双端元件 · R 旋转 · Del 删除 · Esc 退出工具</span>
        </div>
        <button type="button" class="modal-close" title="关闭" aria-label="关闭" @click="close">✕</button>
      </header>

      <div class="body">
        <aside class="palette" aria-label="元件">
          <button
            type="button"
            class="tool"
            :class="{ active: tool === 'select' }"
            title="选择 / 移动 (S)"
            @click="tool = 'select'"
          >
            <svg viewBox="-30 -20 60 40" width="44" height="30" aria-hidden="true">
              <path d="M-6,-12L-6,10L0,4L5,13L8,11L3,2L11,2Z" fill="currentColor" />
            </svg>
            <span>选择</span>
          </button>
          <template v-for="[g, items] in groups" :key="g">
            <div class="group-title">{{ g }}</div>
            <button
              v-for="c in items"
              :key="c.kind"
              type="button"
              class="tool"
              :class="{ active: tool === c.kind }"
              :title="c.name"
              @click="tool = c.kind"
            >
              <svg
                viewBox="-30 -20 60 40"
                width="44"
                height="30"
                v-bind="{ fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6 }"
                aria-hidden="true"
                v-html="iconCache[c.kind]"
              />
              <span>{{ c.name }}</span>
            </button>
          </template>
        </aside>

        <div
          class="canvas-wrap"
          ref="canvasWrapRef"
          @touchstart="onCanvasTouchStart"
          @touchmove="onCanvasTouchMove"
          @touchend="onCanvasTouchEnd"
          @touchcancel="onCanvasTouchEnd"
        >
          <svg
            ref="svgRef"
            class="canvas"
            :class="{ placing: tool !== 'select' }"
            :viewBox="`0 0 ${CANVAS_W} ${CANVAS_H}`"
            :width="CANVAS_W * canvasZoom"
            :height="CANVAS_H * canvasZoom"
            @pointerdown="onCanvasDown"
            @pointermove="onCanvasHover"
            @pointerleave="hover = null"
          >
            <defs>
              <pattern id="cd-grid" :width="GRID" :height="GRID" patternUnits="userSpaceOnUse">
                <circle cx="0" cy="0" r="0.9" fill="#cbd5e1" />
              </pattern>
            </defs>
            <rect :width="CANVAS_W" :height="CANVAS_H" fill="url(#cd-grid)" />
            <g color="#111" v-bind="{ fill: 'none', stroke: 'currentColor', 'stroke-width': 1.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'font-family': 'SimSun, Songti SC, STSong, serif' }">
              <g v-for="el in rendered" :key="el.id" v-html="elementMarkup(el)" />
              <g v-html="junctions" />
            </g>
            <!-- 命中区域 -->
            <g v-if="tool === 'select'">
              <rect
                v-for="el in els"
                :key="'hit-' + el.id"
                v-bind="hitBox(el)"
                class="hit"
                @pointerdown="onElementDown($event, el)"
              />
            </g>
            <rect
              v-if="selectionBox"
              :x="selectionBox.x"
              :y="selectionBox.y"
              :width="selectionBox.w"
              :height="selectionBox.h"
              class="sel-box"
            />
            <template v-if="selected && selectedDef?.mode === 'line' && tool === 'select'">
              <circle :cx="selected.x1" :cy="selected.y1" r="5" class="handle" @pointerdown="onHandleDown($event, selected, 1)" />
              <circle :cx="selected.x2" :cy="selected.y2" r="5" class="handle" @pointerdown="onHandleDown($event, selected, 2)" />
            </template>
            <circle v-if="hover" :cx="hover[0]" :cy="hover[1]" r="4" class="cursor-dot" />
          </svg>
        </div>

        <aside class="props">
          <div class="prop-title">属性</div>
          <template v-if="selected">
            <div class="prop-row">{{ selectedDef?.name }}</div>
            <label v-if="selected.kind !== 'wire' && selected.kind !== 'junction'" class="prop-row">
              <span>{{ selected.kind === 'text' ? '文字' : '标签' }}</span>
              <input :value="selected.label ?? ''" placeholder="如 R1 10kΩ" @input="onLabelInput" />
            </label>
            <div class="prop-btns">
              <button type="button" class="icon-btn" title="旋转 90°" aria-label="旋转 90°" @click="rotateSelected">
                <RotateCw :size="16" :stroke-width="2" />
              </button>
              <button v-if="selectedDef?.mode === 'line'" type="button" class="icon-btn" title="翻转方向" aria-label="翻转方向" @click="flipSelected">
                <FlipHorizontal2 :size="16" :stroke-width="2" />
              </button>
              <button type="button" class="icon-btn danger" title="删除" aria-label="删除" @click="removeSelected">
                <Trash2 :size="16" :stroke-width="2" />
              </button>
            </div>
          </template>
          <p v-else class="muted">选中元件后可修改标签、旋转或删除。</p>

          <div class="prop-title">编辑</div>
          <div class="prop-btns">
            <button type="button" class="icon-btn" title="撤销" aria-label="撤销" :disabled="!history.length" @click="undo">
              <Undo2 :size="16" :stroke-width="2" />
            </button>
            <button type="button" class="icon-btn" title="重做" aria-label="重做" :disabled="!future.length" @click="redo">
              <Redo2 :size="16" :stroke-width="2" />
            </button>
            <button type="button" class="icon-btn danger" title="清空画布" aria-label="清空画布" @click="clearAll">
                <Eraser :size="16" :stroke-width="2" />
            </button>
          </div>

          <template v-if="!editing">
            <div class="prop-title">插入位置</div>
            <div class="prop-btns">
              <button type="button" class="icon-btn" :class="{ on: page === 1 }" title="插入到第 1 页" aria-label="插入到第 1 页" @click="page = 1">
                <File :size="16" :stroke-width="2" />
                <span class="page-num">1</span>
              </button>
              <button type="button" class="icon-btn" :class="{ on: page === 2 }" title="插入到第 2 页" aria-label="插入到第 2 页" @click="page = 2">
                <File :size="16" :stroke-width="2" />
                <span class="page-num">2</span>
              </button>
            </div>
          </template>
        </aside>
      </div>

      <footer class="modal-footer">
        <button type="button" class="btn-cancel" @click="close">取消</button>
        <button type="button" class="btn-submit" @click="submit">{{ editing ? '保存修改' : '插入电路图' }}</button>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.modal-backdrop {
  position: fixed;
  inset: 0;
  z-index: 100;
  background: rgba(17, 24, 39, 0.45);
  /* 阻止原生捏合缩放：画布用自定义缩放，工具栏不缩放 */
  touch-action: pan-y;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}
.modal-card {
  width: min(1280px, 100%);
  height: min(860px, 100%);
  background: #fff;
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  outline: none;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 18px;
  border-bottom: 1px solid var(--border);
}
.modal-title {
  display: flex;
  align-items: baseline;
  gap: 12px;
  font-size: 16px;
  font-weight: 600;
}
.hint {
  font-size: 12px;
  font-weight: 400;
  color: var(--muted);
}
.modal-close {
  background: transparent;
  border: none;
  font-size: 16px;
  color: var(--muted);
  padding: 4px 8px;
  border-radius: 6px;
}
.modal-close:hover {
  background: var(--bg);
}
.body {
  flex: 1;
  display: flex;
  min-height: 0;
}
.palette {
  width: 176px;
  overflow-y: auto;
  border-right: 1px solid var(--border);
  padding: 8px;
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  align-content: start;
}
.group-title {
  grid-column: 1 / -1;
  font-size: 12px;
  color: var(--muted);
  margin: 6px 2px 0;
}
.tool {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 4px 2px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  font-size: 11px;
  color: var(--text);
}
.tool:hover {
  background: var(--bg);
}
.tool.active {
  border-color: var(--primary);
  background: rgba(37, 99, 235, 0.08);
  color: var(--primary);
}
.canvas-wrap {
  flex: 1;
  overflow: auto;
  background: #f8fafc;
}
.canvas {
  display: block;
  background: #fff;
  touch-action: none;
  user-select: none;
}
.canvas.placing {
  cursor: crosshair;
}
.hit {
  fill: transparent;
  stroke: none;
  cursor: move;
}
.hit:hover {
  fill: rgba(37, 99, 235, 0.06);
}
.sel-box {
  fill: none;
  stroke: var(--primary);
  stroke-dasharray: 4 3;
  pointer-events: none;
}
.handle {
  fill: #fff;
  stroke: var(--primary);
  stroke-width: 2;
  cursor: grab;
}
.cursor-dot {
  fill: var(--primary);
  opacity: 0.6;
  pointer-events: none;
}
.props {
  width: 200px;
  border-left: 1px solid var(--border);
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 13px;
}
.prop-title {
  font-weight: 600;
  margin-top: 6px;
}
.prop-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.prop-row input {
  padding: 5px 8px;
  border: 1px solid var(--border);
  border-radius: 6px;
}
.prop-btns {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.prop-btns button {
  padding: 5px 10px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: #fff;
  font-size: 12px;
}
.prop-btns button:hover:not(:disabled) {
  background: var(--bg);
}
.icon-btn {
  position: relative;
  width: 34px;
  height: 30px;
  padding: 0 !important;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--muted);
}
.icon-btn:hover:not(:disabled) {
  color: var(--primary);
  border-color: var(--primary);
}
.icon-btn.danger:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}
/* 数字角标（第 1 / 2 页） */
.page-num {
  position: absolute;
  right: -4px;
  top: -4px;
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--primary);
  color: #fff;
  font-size: 10px;
  line-height: 14px;
  text-align: center;
}
.icon-btn:not(.on) .page-num {
  background: var(--muted);
}
.prop-btns button:disabled {
  opacity: 0.45;
  cursor: not-allowed;
}
.prop-btns button.on {
  border-color: var(--primary);
  color: var(--primary);
}
.prop-btns button.danger {
  color: var(--danger);
}
.muted {
  color: var(--muted);
  margin: 0;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 12px 18px;
  border-top: 1px solid var(--border);
  background: #fafafa;
}
.btn-cancel {
  padding: 8px 16px;
  background: #fff;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  font-size: 13px;
}
.btn-submit {
  padding: 8px 20px;
  background: var(--primary);
  border: none;
  border-radius: var(--radius);
  color: #fff;
  font-size: 13px;
  font-weight: 600;
}
.btn-submit:hover {
  background: var(--primary-hover);
}
</style>
