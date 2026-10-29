<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import type { TableData } from '@/types'
import { PAGE_SIZE_PT } from '@/types'
import { calcCellFontSizePt } from '@/lib/textLayout'
import {
  expandRange,
  findMerge,
  getMerges,
  rangeFrom,
  shiftMergesForInsert,
  visibleCells,
} from '@/lib/tableMerge'
import type { CellRange, MergeTarget, VisibleCell } from '@/lib/tableMerge'

const props = defineProps<{
  table: TableData
  editable?: boolean
}>()

const emit = defineEmits<{
  (e: 'update', table: TableData): void
  (e: 'remove', tableId: string): void
  (e: 'gesture-start'): void
  (e: 'gesture-end'): void
  (e: 'merge-target', target: MergeTarget | null, tableId: string): void
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

/** 把 0..n-1 中满足 keep 的下标合并成连续区间 [start, end) */
function runsOf(n: number, keep: (i: number) => boolean): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let start = -1
  for (let i = 0; i <= n; i++) {
    if (i < n && keep(i)) {
      if (start < 0) start = i
    } else if (start >= 0) {
      out.push([start, i])
      start = -1
    }
  }
  return out
}

interface DividerSeg {
  /** 起点（百分比） */
  start: number
  /** 长度（百分比） */
  size: number
}

/**
 * 每条列分隔线上实际绘制边线的分段：跳过被合并单元格横跨的行，
 * 这样在合并单元格内部点击不会误触列宽调整。
 */
const colSegments = computed<DividerSeg[][]>(() => {
  const rowStart = [0, ...rowDividerPcts.value]
  const { cols, rows } = props.table
  return colDividerPcts.value.map((_, k) =>
    runsOf(
      rows,
      (r) =>
        k === cols - 1 ||
        !merges.value.some(
          (m) =>
            m.c <= k &&
            m.c + m.colSpan - 1 >= k + 1 &&
            r >= m.r &&
            r < m.r + m.rowSpan,
        ),
    ).map(([a, b]) => ({ start: rowStart[a], size: rowStart[b] - rowStart[a] })),
  )
})

/** 每条行分隔线上实际绘制边线的分段（跳过被合并单元格纵跨的列） */
const rowSegments = computed<DividerSeg[][]>(() => {
  const colStart = [0, ...colDividerPcts.value]
  const { cols, rows } = props.table
  return rowDividerPcts.value.map((_, k) =>
    runsOf(
      cols,
      (c) =>
        k === rows - 1 ||
        !merges.value.some(
          (m) =>
            m.r <= k &&
            m.r + m.rowSpan - 1 >= k + 1 &&
            c >= m.c &&
            c < m.c + m.colSpan,
        ),
    ).map(([a, b]) => ({ start: colStart[a], size: colStart[b] - colStart[a] })),
  )
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
    ...((patch.merges ?? props.table.merges)
      ? { merges: (patch.merges ?? props.table.merges)!.map((m) => ({ ...m })) }
      : {}),
  })
}

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
    window.removeEventListener('pointercancel', onUp)
    emit('gesture-end')
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

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
    window.removeEventListener('pointercancel', onUp)
    emit('gesture-end')
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

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
    window.removeEventListener('pointercancel', onUp)
    emit('gesture-end')
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

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
    merges: shiftMergesForInsert(props.table, 'col', insertIdx),
  })
}

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
    merges: shiftMergesForInsert(props.table, 'row', insertIdx),
  })
}

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
    window.removeEventListener('pointercancel', onUp)
    emit('gesture-end')
  }

  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onUp)
}

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
  // 输入法组合中也要重新居中，避免候选文字换行时位置跳动
  centerTextarea(e.target as HTMLTextAreaElement)
  if (isComposing) return
  const val = (e.target as HTMLTextAreaElement).value
  onCellInput(r, c, val)
}

/**
 * textarea 不支持垂直居中：先测出文字内容高度，再用上内边距把文字推到中间。
 * 输入框本身仍占满整个单元格，点击单元格任意位置都能进入编辑。
 * 文字超出单元格高度时内边距为 0，从顶部开始显示。
 */
function centerTextarea(el: HTMLTextAreaElement) {
  el.style.paddingTop = '0px'
  el.style.paddingBottom = '0px'
  el.style.height = '0px'
  const contentH = el.scrollHeight
  el.style.height = ''
  const boxH = el.clientHeight
  el.style.paddingTop = `${Math.max(0, (boxH - contentH) / 2)}px`
}

function centerAllTextareas() {
  bodyRef.value
    ?.querySelectorAll<HTMLTextAreaElement>('.t-cell-input')
    .forEach(centerTextarea)
}

// 内容、行列尺寸、合并变化后（字号也会随之变化），在 DOM 更新后重新居中
watch(
  () => [
    props.table.cells,
    props.table.colWidths,
    props.table.rowHeights,
    props.table.merges,
    props.editable,
  ],
  () => nextTick(centerAllTextareas),
  { deep: true, flush: 'post' },
)

// 页面缩放、窗口尺寸变化会改变单元格像素大小和字号
let cellResizeObserver: ResizeObserver | null = null
onMounted(() => {
  centerAllTextareas()
  if (bodyRef.value && typeof ResizeObserver !== 'undefined') {
    cellResizeObserver = new ResizeObserver(() => centerAllTextareas())
    cellResizeObserver.observe(bodyRef.value)
  }
  // 网页字体加载完成后行高可能变化
  document.fonts?.ready.then(() => centerAllTextareas())
})
onUnmounted(() => cellResizeObserver?.disconnect())

function onCellInput(r: number, c: number, val: string) {
  const cells = props.table.cells.map((row) => [...row])
  while (cells.length <= r) {
    cells.push([])
  }
  cells[r][c] = val
  commit({ cells })
}

const bodyRef = ref<HTMLElement | null>(null)

// ===== 合并单元格：可见单元格与网格布局 =====
const merges = computed(() => getMerges(props.table))
const cellList = computed(() => visibleCells(props.table))

const gridStyle = computed(() => ({
  gridTemplateColumns: props.table.colWidths
    .map((w) => `minmax(0, ${w}fr)`)
    .join(' '),
  gridTemplateRows: props.table.rowHeights
    .map((h) => `minmax(0, ${h}fr)`)
    .join(' '),
}))

function cellStyle(cell: VisibleCell) {
  return {
    gridRow: `${cell.r + 1} / span ${cell.rowSpan}`,
    gridColumn: `${cell.c + 1} / span ${cell.colSpan}`,
  }
}

function getTextarea(r: number, c: number): HTMLTextAreaElement | null {
  return (
    bodyRef.value?.querySelector<HTMLTextAreaElement>(
      `.t-cell[data-r="${r}"][data-c="${c}"] textarea`,
    ) ?? null
  )
}

/**
 * 方向键切换单元格焦点。仅当光标已位于当前单元格文本的边界时才跳转，
 * 否则保留方向键在单元格内移动光标的默认行为：
 * ←：光标在开头；→：光标在末尾；↑：光标在第一行；↓：光标在最后一行。
 * 合并单元格按其整体范围计算相邻单元格。
 */
function onCellKeydown(e: KeyboardEvent, cell: VisibleCell) {
  if (e.isComposing || isComposing || e.keyCode === 229) return
  if (e.shiftKey || e.ctrlKey || e.altKey || e.metaKey) return

  const el = e.target as HTMLTextAreaElement
  const { selectionStart: start, selectionEnd: end, value } = el
  if (start !== end) return

  let nr = cell.r
  let nc = cell.c
  switch (e.key) {
    case 'ArrowLeft':
      if (start !== 0) return
      nc = cell.c - 1
      break
    case 'ArrowRight':
      if (end !== value.length) return
      nc = cell.c + cell.colSpan
      break
    case 'ArrowUp':
      if (value.lastIndexOf('\n', start - 1) !== -1) return
      nr = cell.r - 1
      break
    case 'ArrowDown':
      if (value.indexOf('\n', end) !== -1) return
      nr = cell.r + cell.rowSpan
      break
    default:
      return
  }
  if (nr < 0 || nr >= props.table.rows || nc < 0 || nc >= props.table.cols) return

  // 目标落在合并区域内时，跳到该区域的左上角单元格
  const m = findMerge(merges.value, nr, nc)
  const target = m ? getTextarea(m.r, m.c) : getTextarea(nr, nc)
  if (!target) return
  e.preventDefault()
  target.focus()
  // 向右进入时光标置于开头，其余方向置于末尾
  const pos = e.key === 'ArrowRight' ? 0 : target.value.length
  target.setSelectionRange(pos, pos)
}

// ===== 拖动多选单元格 =====
/** 当前选区（已扩展为完整包含合并区域）；null 表示无多选 */
const selection = ref<CellRange | null>(null)
/** 当前获得焦点的单元格坐标（用于对单个合并单元格「取消合并」） */
const focusedPos = ref<{ r: number; c: number } | null>(null)
const focusedCell = computed<VisibleCell | null>(() => {
  const p = focusedPos.value
  if (!p) return null
  return cellList.value.find((cell) => cell.r === p.r && cell.c === p.c) ?? null
})
const isCellSelecting = ref(false)
/** 正在拖动选区拖柄 */
const isHandleDragging = ref(false)
/** 选区起点（拖动拖柄、Shift+点击扩展选区时使用） */
const anchorPos = ref<{ r: number; c: number } | null>(null)

function setSelection(a: { r: number; c: number }, b: { r: number; c: number }) {
  const range = expandRange(merges.value, rangeFrom(a, b))
  // 选区只覆盖一个可见单元格时不算多选
  const single = cellList.value.some(
    (cell) =>
      cell.r === range.r1 &&
      cell.c === range.c1 &&
      cell.r + cell.rowSpan - 1 === range.r2 &&
      cell.c + cell.colSpan - 1 === range.c2,
  )
  selection.value = single ? null : range
}

function clearSelection() {
  selection.value = null
  anchorPos.value = null
}

function cellFromPoint(x: number, y: number): { r: number; c: number } | null {
  const el = document.elementFromPoint(x, y)
  const cellEl = el instanceof Element ? el.closest<HTMLElement>('.t-cell') : null
  if (!cellEl || !bodyRef.value?.contains(cellEl)) return null
  return { r: Number(cellEl.dataset.r), c: Number(cellEl.dataset.c) }
}

function preventSelectStart(e: Event) {
  e.preventDefault()
}

function enterSelectingMode() {
  isCellSelecting.value = true
  // 取消文本选择；触屏上同时收起软键盘
  ;(document.activeElement as HTMLElement | null)?.blur()
  window.getSelection()?.removeAllRanges()
  document.addEventListener('selectstart', preventSelectStart)
}

/**
 * 从 start 单元格开始拖选。immediate=false（鼠标在单元格内按下）时，
 * 指针离开起始单元格才进入多选，以保留单元格内的文本选择。
 * 收到 pointercancel（如第二根手指落下开始缩放）时放弃本次多选。
 */
function startRangeDrag(start: { r: number; c: number }, immediate: boolean) {
  if (immediate) enterSelectingMode()
  const onMove = (ev: PointerEvent) => {
    const hit = cellFromPoint(ev.clientX, ev.clientY)
    if (!hit) return
    if (!isCellSelecting.value) {
      if (hit.r === start.r && hit.c === start.c) return
      enterSelectingMode()
    }
    setSelection(start, hit)
  }
  const finish = () => {
    isCellSelecting.value = false
    isHandleDragging.value = false
    document.removeEventListener('selectstart', preventSelectStart)
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    window.removeEventListener('pointercancel', onCancel)
  }
  const onUp = () => finish()
  const onCancel = () => {
    finish()
    clearSelection()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
  window.addEventListener('pointercancel', onCancel)
}

function onCellPointerDown(e: PointerEvent, cell: VisibleCell) {
  // 阻止冒泡：避免触发外层拖动等手势
  e.stopPropagation()
  if (!props.editable || e.button !== 0) return

  const anchor = anchorPos.value ?? focusedCell.value
  if (e.shiftKey && anchor) {
    // Shift+点击：从起点扩展选区
    e.preventDefault()
    anchorPos.value = { r: anchor.r, c: anchor.c }
    setSelection(anchor, cell)
    if (selection.value) (document.activeElement as HTMLElement | null)?.blur()
    return
  }

  selection.value = null
  anchorPos.value = { r: cell.r, c: cell.c }
  // 触屏在单元格上拖动保留给页面滚动 / 缩放，多选改用拖柄
  if (e.pointerType === 'touch') return
  startRangeDrag(anchorPos.value, false)
}

/** 拖柄所依附的区域：已有选区，或当前单元格（拖动中焦点已移除时用起点） */
const handleRange = computed<CellRange | null>(() => {
  if (selection.value) return selection.value
  const p = focusedCell.value ?? (isHandleDragging.value ? anchorPos.value : null)
  if (!p) return null
  const m = findMerge(merges.value, p.r, p.c)
  return m
    ? { r1: m.r, c1: m.c, r2: m.r + m.rowSpan - 1, c2: m.c + m.colSpan - 1 }
    : { r1: p.r, c1: p.c, r2: p.r, c2: p.c }
})

const handleStyle = computed(() => {
  const s = handleRange.value
  if (!s) return null
  return {
    gridRow: `${s.r1 + 1} / ${s.r2 + 2}`,
    gridColumn: `${s.c1 + 1} / ${s.c2 + 2}`,
  }
})

/** 拖柄区域位于表格右下角时，拖柄改放左下角，避开表格缩放手柄 */
const handleAtCorner = computed(
  () =>
    handleRange.value !== null &&
    handleRange.value.r2 === props.table.rows - 1 &&
    handleRange.value.c2 === props.table.cols - 1,
)

function onHandlePointerDown(e: PointerEvent) {
  e.stopPropagation()
  e.preventDefault()
  if (!props.editable || e.button !== 0) return
  const start = anchorPos.value ?? focusedCell.value
  if (!start) return
  anchorPos.value = { r: start.r, c: start.c }
  isHandleDragging.value = true
  startRangeDrag(anchorPos.value, true)
}

/** 在表格以外按下指针时清除选区（顶栏的合并按钮除外） */
function onWindowPointerDown(e: PointerEvent) {
  const t = e.target
  if (t instanceof Node && bodyRef.value?.parentElement?.contains(t)) return
  if (isKeepSelectionEl(t)) return
  clearSelection()
}

function onWindowKeydown(e: KeyboardEvent) {
  if (selection.value && e.key === 'Escape') {
    selection.value = null
  }
}

onMounted(() => {
  window.addEventListener('pointerdown', onWindowPointerDown, { capture: true })
  window.addEventListener('keydown', onWindowKeydown)
})

onUnmounted(() => {
  window.removeEventListener('pointerdown', onWindowPointerDown, { capture: true })
  window.removeEventListener('keydown', onWindowKeydown)
  document.removeEventListener('selectstart', preventSelectStart)
})

// 行列数或合并状态变化后旧选区可能失效
watch(
  () => [props.table.rows, props.table.cols, JSON.stringify(merges.value)],
  () => clearSelection(),
)

const selectionStyle = computed(() => {
  const s = selection.value
  if (!s) return null
  return {
    gridRow: `${s.r1 + 1} / ${s.r2 + 2}`,
    gridColumn: `${s.c1 + 1} / ${s.c2 + 2}`,
  }
})

/** 焦点所在的合并单元格（无多选时用于「取消合并」） */
const focusedMergeRange = computed<CellRange | null>(() => {
  const f = focusedCell.value
  if (!f || (f.rowSpan === 1 && f.colSpan === 1)) return null
  return { r1: f.r, c1: f.c, r2: f.r + f.rowSpan - 1, c2: f.c + f.colSpan - 1 }
})

/**
 * 上报给顶栏的可操作区域；无可操作区域时为 null。
 * 多选时合并（选区内已有的合并区域会并入新区域）；
 * 未多选而焦点在合并单元格内时取消合并。
 */
const mergeTarget = computed<MergeTarget | null>(() => {
  if (!props.editable) return null
  if (selection.value) {
    return { tableId: props.table.id, range: selection.value, action: 'merge' }
  }
  if (focusedMergeRange.value) {
    return {
      tableId: props.table.id,
      range: focusedMergeRange.value,
      action: 'unmerge',
    }
  }
  return null
})

watch(
  mergeTarget,
  (next, prev) => {
    if (next || prev) emit('merge-target', next, props.table.id)
  },
  { deep: true },
)

onUnmounted(() => {
  if (mergeTarget.value) emit('merge-target', null, props.table.id)
})

function onCellFocus(cell: VisibleCell) {
  focusedPos.value = { r: cell.r, c: cell.c }
  // 方向键 / Tab 切换焦点时同步选区起点；已有多选时保留原起点
  if (!selection.value) anchorPos.value = { r: cell.r, c: cell.c }
}

/** Shift+点击扩展选区时，阻止鼠标按下让输入框重新获得焦点 */
function onCellMouseDown(e: MouseEvent) {
  if (e.shiftKey && selection.value) e.preventDefault()
}

/** 顶栏中标记了 data-keep-table-selection 的按钮，点击时不清除选区 / 焦点状态 */
function isKeepSelectionEl(el: unknown): boolean {
  return el instanceof Element && el.closest('[data-keep-table-selection]') !== null
}

function onCellBlur(e: FocusEvent, cell: VisibleCell) {
  if (isKeepSelectionEl(e.relatedTarget)) return
  if (focusedPos.value?.r === cell.r && focusedPos.value?.c === cell.c) {
    focusedPos.value = null
  }
}

function onRemove() {
  emit('remove', props.table.id)
}

function sumSpan(sizes: number[], start: number, span: number): number {
  let total = 0
  for (let i = start; i < start + span; i++) total += sizes[i] ?? 0
  return total
}

function getCellFontSize(cell: VisibleCell): string {
  const colW = sumSpan(props.table.colWidths, cell.c, cell.colSpan) || 80
  const rowH = sumSpan(props.table.rowHeights, cell.r, cell.rowSpan) || 24
  const baseRowH = props.table.rowHeights[cell.r] || 24
  const text = props.table.cells[cell.r]?.[cell.c] ?? ''
  const sizePt = calcCellFontSizePt(text, colW, rowH, baseRowH)
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
    :data-table-id="table.id"
  >
    <div
      v-if="editable"
      class="t-toolbar"
      @pointerdown="onMoveStart"
    >
      <span class="t-drag-bar" />
    </div>

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

    <div
      ref="bodyRef"
      class="t-body"
      :class="{ 'is-cell-selecting': isCellSelecting }"
      :style="gridStyle"
    >
      <div
        v-for="cell in cellList"
        :key="'cell-' + cell.r + '-' + cell.c"
        class="t-cell"
        :class="{
          'last-col': cell.c + cell.colSpan >= table.cols,
          'last-row': cell.r + cell.rowSpan >= table.rows,
        }"
        :style="cellStyle(cell)"
        :data-r="cell.r"
        :data-c="cell.c"
      >
        <textarea
          v-if="editable"
          class="t-cell-input"
          :style="{ fontSize: getCellFontSize(cell) }"
          :value="table.cells[cell.r]?.[cell.c] ?? ''"
          rows="1"
          spellcheck="false"
          @keydown="onCellKeydown($event, cell)"
          @pointerdown="onCellPointerDown($event, cell)"
          @mousedown="onCellMouseDown"
          @focus="onCellFocus(cell)"
          @blur="onCellBlur($event, cell)"
          @compositionstart="onCompStart"
          @compositionend="onCompEnd($event, cell.r, cell.c)"
          @input="onCellInputEvent($event, cell.r, cell.c)"
        />
        <div
          v-else
          class="t-cell-text"
          :style="{ fontSize: getCellFontSize(cell) }"
        >
          {{ table.cells[cell.r]?.[cell.c] ?? '' }}
        </div>
      </div>

      <div
        v-if="editable && selectionStyle"
        class="t-selection"
        :style="selectionStyle"
      />

      <div
        v-if="editable && handleStyle"
        class="t-select-handle-area"
        :style="handleStyle"
      >
        <div
          class="t-select-handle"
          :class="{ 'at-left': handleAtCorner, dragging: isHandleDragging }"
          title="拖动以选择多个单元格"
          @pointerdown="onHandlePointerDown"
          @mousedown.prevent
        />
      </div>

      <template v-if="editable">
        <template
          v-for="(pctPos, cIdx) in colDividerPcts"
          :key="'col-handle-' + cIdx"
        >
          <!-- 表格上方的手柄：插入列按钮 + 调整列宽（触屏主要入口） -->
          <div
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
          <!-- 表格内部的列边线分段（不穿过合并单元格） -->
          <div
            v-for="(seg, sIdx) in colSegments[cIdx]"
            :key="'col-seg-' + cIdx + '-' + sIdx"
            class="t-col-seg"
            :class="{ active: activeResizeCol === cIdx }"
            :style="{
              left: `calc(${pctPos}% - 6px)`,
              top: `${seg.start}%`,
              height: `${seg.size}%`,
            }"
            @pointerdown="onColResizeStart($event, cIdx)"
          />
        </template>
      </template>

      <template v-if="editable">
        <template
          v-for="(pctPos, rIdx) in rowDividerPcts"
          :key="'row-handle-' + rIdx"
        >
          <!-- 表格右侧的手柄：插入行按钮 + 调整行高（触屏主要入口） -->
          <div
            class="t-row-handle"
            :class="{ active: activeResizeRow === rIdx }"
            :style="{ top: `calc(${pctPos}% - 6px)` }"
            @pointerdown="onRowResizeStart($event, rIdx)"
          >
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
          <!-- 表格内部的行边线分段（不穿过合并单元格） -->
          <div
            v-for="(seg, sIdx) in rowSegments[rIdx]"
            :key="'row-seg-' + rIdx + '-' + sIdx"
            class="t-row-seg"
            :class="{ active: activeResizeRow === rIdx }"
            :style="{
              top: `calc(${pctPos}% - 6px)`,
              left: `${seg.start}%`,
              width: `${seg.size}%`,
            }"
            @pointerdown="onRowResizeStart($event, rIdx)"
          />
        </template>
      </template>

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

.t-body {
  position: relative;
  flex: 1;
  display: grid;
  border: 1px solid #333;
  background: #ffffff;
  box-sizing: border-box;
}
.t-body.is-cell-selecting,
.t-body.is-cell-selecting .t-cell-input {
  user-select: none;
  cursor: cell;
}

.t-cell {
  min-width: 0;
  min-height: 0;
  border-right: 1px solid #333;
  border-bottom: 1px solid #333;
  box-sizing: border-box;
  display: flex;
  align-items: center;
  justify-content: center;
}
.t-cell.last-col {
  border-right: none;
}
.t-cell.last-row {
  border-bottom: none;
}

.t-selection {
  position: relative;
  z-index: 5;
  pointer-events: none;
  background: rgba(37, 99, 235, 0.14);
  outline: 2px solid #2563eb;
  outline-offset: -1px;
}

.t-select-handle-area {
  position: relative;
  z-index: 16;
  pointer-events: none;
}

/* 可见圆点 10px，触摸区域通过 ::before 扩大到 28px */
.t-select-handle {
  position: absolute;
  right: -5px;
  bottom: -5px;
  width: 10px;
  height: 10px;
  border: 2px solid #ffffff;
  border-radius: 50%;
  background: #2563eb;
  box-sizing: border-box;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.3);
  cursor: crosshair;
  pointer-events: auto;
  touch-action: none;
  user-select: none;
  -webkit-user-select: none;
  -webkit-touch-callout: none;
}
.t-select-handle::before {
  content: '';
  position: absolute;
  inset: -9px;
  border-radius: 50%;
}
.t-select-handle.at-left {
  right: auto;
  left: -5px;
}
.t-select-handle.dragging {
  transform: scale(1.3);
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

.t-col-handle {
  position: absolute;
  top: -14px;
  height: 14px;
  width: 12px;
  cursor: col-resize;
  z-index: 10;
  touch-action: none;
}

/* 表格内部的列边线分段：鼠标可直接拖动边线调整列宽 */
.t-col-seg {
  position: absolute;
  width: 12px;
  cursor: col-resize;
  z-index: 10;
  touch-action: none;
}
.t-col-seg::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 5px;
  width: 2px;
  background: transparent;
  transition: background 0.15s;
}
.t-col-seg:hover::after,
.t-col-seg.active::after {
  background: #2563eb;
}

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

.t-row-handle {
  position: absolute;
  left: 100%;
  width: 14px;
  height: 12px;
  cursor: row-resize;
  z-index: 10;
  touch-action: none;
}

/* 表格内部的行边线分段：鼠标可直接拖动边线调整行高 */
.t-row-seg {
  position: absolute;
  height: 12px;
  cursor: row-resize;
  z-index: 10;
  touch-action: none;
}
.t-row-seg::after {
  content: '';
  position: absolute;
  left: 0;
  right: 0;
  top: 5px;
  height: 2px;
  background: transparent;
  transition: background 0.15s;
}
.t-row-seg:hover::after,
.t-row-seg.active::after {
  background: #2563eb;
}

/*
 * 触屏：表格内部的边线不响应触摸，点击边线附近一律落到单元格上；
 * 调整列宽 / 行高改用表格上方 / 右侧的手柄，并加大其触摸区域。
 */
@media (pointer: coarse) {
  .t-col-seg,
  .t-row-seg {
    pointer-events: none;
  }
  .t-col-handle {
    top: -20px;
    height: 20px;
    width: 20px;
    margin-left: -4px;
  }
  .t-row-handle {
    width: 20px;
    height: 20px;
    margin-top: -4px;
  }
}

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
