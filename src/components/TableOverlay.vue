<script setup lang="ts">
import { computed, ref } from 'vue'
import type { TableData } from '@/types'
import { PAGE_SIZE_PT } from '@/types'
import { calcCellFontSizePt } from '@/lib/textLayout'

const props = defineProps<{
  table: TableData
  editable?: boolean
}>()

const emit = defineEmits<{
  (e: 'update', table: TableData): void
  (e: 'remove', tableId: string): void
  (e: 'gesture-start'): void
  (e: 'gesture-end'): void
}>()

const PW = PAGE_SIZE_PT.width
const PH = PAGE_SIZE_PT.height
const MIN_SIZE = 14 // 单元格最小尺寸（pt）

const isMoving = ref(false)
const activeResizeCol = ref<number | null>(null)
const activeResizeRow = ref<number | null>(null)

const totalW = computed(() => props.table.colWidths.reduce((a, b) => a + b, 0))
const totalH = computed(() => props.table.rowHeights.reduce((a, b) => a + b, 0))

const containerStyle = computed(() => ({
  left: `${(props.table.x / PW) * 100}%`,
  top: `${(props.table.y / PH) * 100}%`,
  width: `${(totalW.value / PW) * 100}%`,
  height: `${(totalH.value / PH) * 100}%`,
}))

/** 某列占表格总宽的比例 */
function colPct(i: number): string {
  return `${(props.table.colWidths[i] / totalW.value) * 100}%`
}

/** 某行占表格总高的比例 */
function rowPct(i: number): string {
  return `${(props.table.rowHeights[i] / totalH.value) * 100}%`
}

/** 各列右边框的累积位置（百分比） */
const colDividerPcts = computed(() => {
  const list: number[] = []
  let acc = 0
  for (let i = 0; i < props.table.cols; i++) {
    acc += props.table.colWidths[i]
    list.push((acc / totalW.value) * 100)
  }
  return list
})

/** 各行底边框的累积位置（百分比） */
const rowDividerPcts = computed(() => {
  const list: number[] = []
  let acc = 0
  for (let i = 0; i < props.table.rows; i++) {
    acc += props.table.rowHeights[i]
    list.push((acc / totalH.value) * 100)
  }
  return list
})

function getPageEl(el: EventTarget | null): HTMLElement | null {
  if (!(el instanceof HTMLElement)) return null
  return el.closest('.page-editor')
}

function scaleOf(el: HTMLElement | null): number {
  if (!el) return 1
  return el.getBoundingClientRect().width / PW
}

function commit(patch: Partial<TableData>) {
  emit('update', {
    ...props.table,
    ...patch,
    colWidths: patch.colWidths
      ? [...patch.colWidths]
      : [...props.table.colWidths],
    rowHeights: patch.rowHeights
      ? [...patch.rowHeights]
      : [...props.table.rowHeights],
    cells: patch.cells
      ? patch.cells.map((r) => [...r])
      : props.table.cells.map((r) => [...r]),
  })
}

/* ================= 拖动表格 ================= */
function onMoveStart(e: PointerEvent) {
  if (!props.editable) return
  const pageEl = getPageEl(e.currentTarget)
  if (!pageEl) return
  e.preventDefault()
  isMoving.value = true
  emit('gesture-start')

  const scale = scaleOf(pageEl)
  const startX = e.clientX
  const startY = e.clientY
  const origX = props.table.x
  const origY = props.table.y
  const maxX = PW - totalW.value
  const maxY = PH - totalH.value

  const onMove = (ev: PointerEvent) => {
    const dx = (ev.clientX - startX) / scale
    const dy = (ev.clientY - startY) / scale
    commit({
      x: Math.min(Math.max(origX + dx, 0), Math.max(maxX, 0)),
      y: Math.min(Math.max(origY + dy, 0), Math.max(maxY, 0)),
    })
  }

  const onUp = () => {
    isMoving.value = false
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    emit('gesture-end')
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

/* ================= 调整单列列宽 ================= */
function onColResizeStart(e: PointerEvent, colIdx: number) {
  if (!props.editable) return
  e.stopPropagation()
  e.preventDefault()
  const pageEl = getPageEl(e.currentTarget)
  if (!pageEl) return
  activeResizeCol.value = colIdx
  emit('gesture-start')

  const scale = scaleOf(pageEl)
  const startX = e.clientX
  const origWidth = props.table.colWidths[colIdx]
  const widths = [...props.table.colWidths]

  const onMove = (ev: PointerEvent) => {
    const dx = (ev.clientX - startX) / scale
    const nextW = Math.max(MIN_SIZE, origWidth + dx)
    const prevSum = widths
      .slice(0, colIdx)
      .reduce((a, b) => a + b, 0)
    const afterSum = widths
      .slice(colIdx + 1)
      .reduce((a, b) => a + b, 0)
    const maxAllowed = PW - props.table.x - prevSum - afterSum - 10
    const clampedW = Math.min(nextW, Math.max(MIN_SIZE, maxAllowed))

    const nextWidths = [...widths]
    nextWidths[colIdx] = clampedW
    commit({ colWidths: nextWidths })
  }

  const onUp = () => {
    activeResizeCol.value = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    emit('gesture-end')
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

/* ================= 调整单行行高 ================= */
function onRowResizeStart(e: PointerEvent, rowIdx: number) {
  if (!props.editable) return
  e.stopPropagation()
  e.preventDefault()
  const pageEl = getPageEl(e.currentTarget)
  if (!pageEl) return
  activeResizeRow.value = rowIdx
  emit('gesture-start')

  const scale = scaleOf(pageEl)
  const startY = e.clientY
  const origHeight = props.table.rowHeights[rowIdx]
  const heights = [...props.table.rowHeights]

  const onMove = (ev: PointerEvent) => {
    const dy = (ev.clientY - startY) / scale
    const nextH = Math.max(MIN_SIZE, origHeight + dy)
    const prevSum = heights
      .slice(0, rowIdx)
      .reduce((a, b) => a + b, 0)
    const afterSum = heights
      .slice(rowIdx + 1)
      .reduce((a, b) => a + b, 0)
    const maxAllowed = PH - props.table.y - prevSum - afterSum - 10
    const clampedH = Math.min(nextH, Math.max(MIN_SIZE, maxAllowed))

    const nextHeights = [...heights]
    nextHeights[rowIdx] = clampedH
    commit({ rowHeights: nextHeights })
  }

  const onUp = () => {
    activeResizeRow.value = null
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    emit('gesture-end')
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

/* ================= 插入多一列（在指定表格线处） ================= */
function insertColAt(insertIdx: number) {
  if (props.table.cols >= 15) return
  const prevW =
    props.table.colWidths[Math.min(insertIdx - 1, props.table.cols - 1)] || 80
  const colW = Math.max(MIN_SIZE, Math.min(prevW, 80))
  const nextColWidths = [...props.table.colWidths]
  nextColWidths.splice(insertIdx, 0, colW)

  const nextCells = Array.from({ length: props.table.rows }, (_, r) => {
    const row = [...(props.table.cells[r] || [])]
    while (row.length < props.table.cols) {
      row.push('')
    }
    row.splice(insertIdx, 0, '')
    return row
  })

  commit({
    cols: props.table.cols + 1,
    colWidths: nextColWidths,
    cells: nextCells,
  })
}

/* ================= 插入多一行（在指定表格线处） ================= */
function insertRowAt(insertIdx: number) {
  if (props.table.rows >= 25) return
  const prevH =
    props.table.rowHeights[Math.min(insertIdx - 1, props.table.rows - 1)] || 24
  const rowH = Math.max(MIN_SIZE, Math.min(prevH, 26))
  const nextRowHeights = [...props.table.rowHeights]
  nextRowHeights.splice(insertIdx, 0, rowH)

  const nextCells = props.table.cells.map((row) => {
    const copy = [...row]
    while (copy.length < props.table.cols) copy.push('')
    return copy
  })
  while (nextCells.length < props.table.rows) {
    nextCells.push(Array(props.table.cols).fill(''))
  }
  nextCells.splice(insertIdx, 0, Array(props.table.cols).fill(''))

  commit({
    rows: props.table.rows + 1,
    rowHeights: nextRowHeights,
    cells: nextCells,
  })
}

/* ================= 右下角整体等比拉伸 ================= */
function onCornerResizeStart(e: PointerEvent) {
  if (!props.editable) return
  e.stopPropagation()
  e.preventDefault()
  const pageEl = getPageEl(e.currentTarget)
  if (!pageEl) return
  emit('gesture-start')

  const scale = scaleOf(pageEl)
  const startX = e.clientX
  const startY = e.clientY
  const origColWidths = [...props.table.colWidths]
  const origRowHeights = [...props.table.rowHeights]
  const origTotalW = totalW.value
  const origTotalH = totalH.value

  const onMove = (ev: PointerEvent) => {
    const dx = (ev.clientX - startX) / scale
    const dy = (ev.clientY - startY) / scale
    const targetW = Math.max(props.table.cols * MIN_SIZE, origTotalW + dx)
    const targetH = Math.max(props.table.rows * MIN_SIZE, origTotalH + dy)
    const ratioX = targetW / origTotalW
    const ratioY = targetH / origTotalH

    const nextColWidths = origColWidths.map((w) =>
      Math.max(MIN_SIZE, w * ratioX),
    )
    const nextRowHeights = origRowHeights.map((h) =>
      Math.max(MIN_SIZE, h * ratioY),
    )
    commit({ colWidths: nextColWidths, rowHeights: nextRowHeights })
  }

  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    emit('gesture-end')
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

/* ================= 单元格文本输入 ================= */
let isComposing = false

function onCompStart() {
  isComposing = true
}

function onCompEnd(e: Event, r: number, c: number) {
  isComposing = false
  const val = (e.target as HTMLTextAreaElement).value
  onCellInput(r, c, val)
}

function onCellInputEvent(e: Event, r: number, c: number) {
  if (isComposing) return
  const val = (e.target as HTMLTextAreaElement).value
  onCellInput(r, c, val)
}

function onCellInput(r: number, c: number, val: string) {
  const cells = props.table.cells.map((row) => [...row])
  while (cells.length <= r) {
    cells.push([])
  }
  cells[r][c] = val
  commit({ cells })
}

function onRemove() {
  emit('remove', props.table.id)
}

/** 动态计算每个单元格的自适应字号（根据列宽、行高与文字长度） */
function getCellFontSize(r: number, c: number): string {
  const colW = props.table.colWidths[c] || 80
  const rowH = props.table.rowHeights[r] || 24
  const text = props.table.cells[r]?.[c] ?? ''
  const sizePt = calcCellFontSizePt(text, colW, rowH)
  const cqiVal = (sizePt * 100) / 841.92
  const minPx = Math.max(7, Math.round(sizePt * 0.75))
  const maxPx = Math.round(sizePt * 1.6)
  return `clamp(${minPx}px, ${cqiVal.toFixed(4)}cqi, ${maxPx}px)`
}
</script>

<template>
  <div
    class="table-overlay"
    :class="{ 'is-moving': isMoving, editable }"
    :style="containerStyle"
  >
    <!-- 顶部拖动条（无任何文字与按钮） -->
    <div
      v-if="editable"
      class="t-toolbar"
      @pointerdown="onMoveStart"
    >
      <span class="t-drag-bar" />
    </div>

    <!-- 悬浮删除按钮（左上角角标，直接删除无二次确认） -->
    <button
      v-if="editable"
      type="button"
      class="t-float-del"
      @pointerdown.stop
      @click.stop="onRemove"
    >
      <svg
        viewBox="0 0 24 24"
        width="10"
        height="10"
        fill="none"
        stroke="currentColor"
        stroke-width="2.5"
      >
        <path d="M18 6 6 18M6 6l12 12" />
      </svg>
    </button>

    <!-- 表格主体 -->
    <div class="t-body">
      <div
        v-for="r in table.rows"
        :key="'row-' + r"
        class="t-row"
        :style="{ height: rowPct(r - 1) }"
      >
        <div
          v-for="c in table.cols"
          :key="'cell-' + r + '-' + c"
          class="t-cell"
          :style="{ width: colPct(c - 1) }"
        >
          <textarea
            v-if="editable"
            class="t-cell-input"
            :style="{ fontSize: getCellFontSize(r - 1, c - 1) }"
            :value="table.cells[r - 1]?.[c - 1] ?? ''"
            rows="1"
            spellcheck="false"
            @pointerdown.stop
            @compositionstart="onCompStart"
            @compositionend="onCompEnd($event, r - 1, c - 1)"
            @input="onCellInputEvent($event, r - 1, c - 1)"
          />
          <div
            v-else
            class="t-cell-text"
            :style="{ fontSize: getCellFontSize(r - 1, c - 1) }"
          >
            {{ table.cells[r - 1]?.[c - 1] ?? '' }}
          </div>
        </div>
      </div>

      <!-- 列宽调整手柄（每列右边界，贯穿全表；表格线上方带有加号按钮，用于插入多一列） -->
      <template v-if="editable">
        <div
          v-for="(pctPos, cIdx) in colDividerPcts"
          :key="'col-handle-' + cIdx"
          class="t-col-handle"
          :class="{ active: activeResizeCol === cIdx }"
          :style="{ left: `calc(${pctPos}% - 6px)` }"
          @pointerdown="onColResizeStart($event, cIdx)"
        >
          <button
            type="button"
            class="t-insert-col-btn"
            @pointerdown.stop
            @click.stop="insertColAt(cIdx + 1)"
          >
            <svg
              viewBox="0 0 24 24"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              stroke-width="2.6"
              stroke-linecap="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </template>

      <!-- 行高调整手柄（每行底边界，贯穿全表；表格线右方带有加号按钮，用于插入多一行） -->
      <template v-if="editable">
        <div
          v-for="(pctPos, rIdx) in rowDividerPcts"
          :key="'row-handle-' + rIdx"
          class="t-row-handle"
          :class="{ active: activeResizeRow === rIdx }"
          :style="{ top: `calc(${pctPos}% - 6px)` }"
          @pointerdown="onRowResizeStart($event, rIdx)"
        >
          <!-- 仅在非最后一行显示加号按钮（避免与右下角整表等比拉伸角标冲突） -->
          <button
            v-if="rIdx < table.rows - 1"
            type="button"
            class="t-insert-row-btn"
            @pointerdown.stop
            @click.stop="insertRowAt(rIdx + 1)"
          >
            <svg
              viewBox="0 0 24 24"
              width="9"
              height="9"
              fill="none"
              stroke="currentColor"
              stroke-width="2.6"
              stroke-linecap="round"
            >
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
        </div>
      </template>

      <!-- 右下角等比缩放手柄 -->
      <div
        v-if="editable"
        class="t-corner-handle"
        @pointerdown="onCornerResizeStart"
      />
    </div>
  </div>
</template>

<style scoped>
.table-overlay {
  position: absolute;
  z-index: 6;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
}

.table-overlay.is-moving {
  opacity: 0.92;
  box-shadow: 0 8px 24px rgba(37, 99, 235, 0.25);
}

/* 顶部纯拖动条（无文字、无按钮） */
.t-toolbar {
  position: relative;
  height: 10px;
  flex: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(37, 99, 235, 0.16);
  border: 1px solid rgba(37, 99, 235, 0.45);
  border-bottom: none;
  border-radius: 4px 4px 0 0;
  cursor: grab;
  user-select: none;
  touch-action: none;
  transition: background 0.15s, border-color 0.15s;
}
.t-toolbar:hover {
  background: rgba(37, 99, 235, 0.28);
  border-color: rgba(37, 99, 235, 0.7);
}
.t-toolbar:active {
  cursor: grabbing;
  background: rgba(37, 99, 235, 0.42);
}

.t-drag-bar {
  width: 28px;
  height: 3px;
  border-radius: 2px;
  background: rgba(37, 99, 235, 0.65);
  pointer-events: none;
}

/* 悬停左上角角标显示的删除按钮（直接删除无二次确认） */
.t-float-del {
  position: absolute;
  top: -8px;
  left: -8px;
  width: 16px;
  height: 16px;
  padding: 0;
  border: 1px solid #ffffff;
  border-radius: 50%;
  background: rgba(220, 38, 38, 0.88);
  color: #ffffff;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  z-index: 15;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
  transition: opacity 0.15s, transform 0.15s, background-color 0.15s;
}

.table-overlay:hover .t-float-del {
  opacity: 1;
  pointer-events: auto;
}

.t-float-del:hover {
  transform: scale(1.15);
  background: #dc2626;
}

/* 表格主体 */
.t-body {
  position: relative;
  flex: 1;
  display: flex;
  flex-direction: column;
  border: 1px solid #333;
  background: #ffffff;
  box-sizing: border-box;
}

.t-row {
  display: flex;
  border-bottom: 1px solid #333;
  box-sizing: border-box;
}
.t-row:last-child {
  border-bottom: none;
}

.t-cell {
  border-right: 1px solid #333;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}
.t-cell:last-child {
  border-right: none;
}

.t-cell-input {
  width: 100%;
  height: 100%;
  border: none;
  outline: none;
  resize: none;
  padding: 2px 3px;
  margin: 0;
  background: transparent;
  color: #000;
  font-family: 'SimSun', 'Songti SC', 'STSong', serif;
  line-height: 1.25;
  text-align: center;
  overflow: hidden;
  box-sizing: border-box;
}
.t-cell-input:focus {
  background: rgba(37, 99, 235, 0.08);
}

.t-cell-text {
  width: 100%;
  padding: 2px 3px;
  font-family: 'SimSun', 'Songti SC', 'STSong', serif;
  line-height: 1.25;
  color: #000;
  text-align: center;
  white-space: pre-wrap;
  word-break: break-word;
  overflow: hidden;
}

/* 列宽调整手柄（竖线），贯穿全表 */
.t-col-handle {
  position: absolute;
  top: -14px;
  bottom: 0;
  width: 12px;
  cursor: col-resize;
  z-index: 10;
  touch-action: none;
}
.t-col-handle::after {
  content: '';
  position: absolute;
  top: 14px;
  bottom: 0;
  left: 5px;
  width: 2px;
  background: transparent;
  transition: background 0.15s;
}
.t-col-handle:hover::after,
.t-col-handle.active::after {
  background: #2563eb;
}

/* 列线上方加号按钮（插入多一列） */
.t-insert-col-btn {
  position: absolute;
  top: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 13px;
  height: 13px;
  padding: 0;
  border-radius: 50%;
  background: #ffffff;
  border: 1px solid #2563eb;
  color: #2563eb;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  z-index: 12;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition: all 0.12s ease;
}

.t-col-handle:hover .t-insert-col-btn,
.t-insert-col-btn:hover {
  opacity: 1;
  pointer-events: auto;
  background: #2563eb;
  color: #ffffff;
  transform: translateX(-50%) scale(1.18);
}

/* 行高调整手柄（横线），贯穿全表 */
.t-row-handle {
  position: absolute;
  left: 0;
  right: -14px;
  height: 12px;
  cursor: row-resize;
  z-index: 10;
  touch-action: none;
}
.t-row-handle::after {
  content: '';
  position: absolute;
  left: 0;
  right: 14px;
  top: 5px;
  height: 2px;
  background: transparent;
  transition: background 0.15s;
}
.t-row-handle:hover::after,
.t-row-handle.active::after {
  background: #2563eb;
}

/* 行线右方加号按钮（插入多一行） */
.t-insert-row-btn {
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 13px;
  height: 13px;
  padding: 0;
  border-radius: 50%;
  background: #ffffff;
  border: 1px solid #2563eb;
  color: #2563eb;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  opacity: 0;
  pointer-events: none;
  z-index: 12;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
  transition: all 0.12s ease;
}

.t-row-handle:hover .t-insert-row-btn,
.t-insert-row-btn:hover {
  opacity: 1;
  pointer-events: auto;
  background: #2563eb;
  color: #ffffff;
  transform: translateY(-50%) scale(1.18);
}

/* 右下角拉伸角标 */
.t-corner-handle {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 14px;
  height: 14px;
  cursor: se-resize;
  z-index: 15;
  background: linear-gradient(
    135deg,
    transparent 45%,
    rgba(37, 99, 235, 0.75) 45%
  );
  border-radius: 0 0 3px 0;
  transition: all 0.12s ease;
}
.t-corner-handle:hover {
  background: linear-gradient(
    135deg,
    transparent 45%,
    #2563eb 45%
  );
  transform: scale(1.15);
}
</style>
