<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageEditor from '@/components/PageEditor.vue'
import InsertTableModal from '@/components/InsertTableModal.vue'
import CircuitEditorModal from '@/components/CircuitEditorModal.vue'
import InsertImageModal from '@/components/InsertImageModal.vue'
import PlotEditorModal from '@/components/PlotEditorModal.vue'
import type { PlotDocument } from '@/types/plot'
import { plotDataUrl, styleScaleFor, withScale } from '@/lib/plot'
import { circuitBBox, cloneCircuit } from '@/lib/circuit'
import { formTemplate, CONTENT_REGION } from '@/lib/formTemplate'
import { exportPage } from '@/lib/exporter'
import { cloneImage, readImageFile } from '@/lib/image'
import { useReportsStore } from '@/stores/reports'
import type { CircuitData, CircuitElement, ImageData, ReportData, TableData } from '@/types'

const route = useRoute()
const router = useRouter()
const store = useReportsStore()

const reportId = computed(() => route.params.id as string)
const report = computed(() =>
  store.reports.find((r) => r.id === reportId.value),
)

// 报告不存在时返回列表
watch(
  report,
  (r) => {
    if (!r) router.replace('/')
  },
  { immediate: true },
)

const currentTitle = computed(() => {
  return report.value?.values['topic'] || report.value?.title || ''
})

const exporting = ref(false)
const exportFormat = ref<'png' | 'pdf'>('png')
const exportStatus = ref('')
const isInsertModalOpen = ref(false)
const insertModalDefaultPage = ref(1)

interface HistorySnapshot {
  title: string
  values: Record<string, string>
  tables: TableData[]
  circuits: CircuitData[]
  images: ImageData[]
}

function cloneSnapshot(r: ReportData): HistorySnapshot {
  return {
    title: r.title,
    values: { ...r.values },
    tables: (r.tables || []).map((t) => ({
      ...t,
      colWidths: [...t.colWidths],
      rowHeights: [...t.rowHeights],
      cells: t.cells.map((row) => [...row]),
    })),
    circuits: (r.circuits || []).map(cloneCircuit),
    images: (r.images || []).map(cloneImage),
  }
}

function snapshotsEqual(a: HistorySnapshot, b: HistorySnapshot): boolean {
  if (a.title !== b.title) return false
  const aKeys = Object.keys(a.values)
  const bKeys = Object.keys(b.values)
  if (aKeys.length !== bKeys.length) return false
  for (const k of aKeys) {
    if (a.values[k] !== b.values[k]) return false
  }
  if (JSON.stringify(a.circuits) !== JSON.stringify(b.circuits)) return false
  if (JSON.stringify(a.images) !== JSON.stringify(b.images)) return false
  if (a.tables.length !== b.tables.length) return false
  for (let i = 0; i < a.tables.length; i++) {
    const tA = a.tables[i]
    const tB = b.tables[i]
    if (
      tA.id !== tB.id ||
      tA.page !== tB.page ||
      tA.x !== tB.x ||
      tA.y !== tB.y ||
      tA.cols !== tB.cols ||
      tA.rows !== tB.rows
    ) {
      return false
    }
    if (tA.colWidths.some((w, idx) => w !== tB.colWidths[idx])) return false
    if (tA.rowHeights.some((h, idx) => h !== tB.rowHeights[idx])) return false
    for (let r = 0; r < tA.rows; r++) {
      for (let c = 0; c < tA.cols; c++) {
        if ((tA.cells[r]?.[c] ?? '') !== (tB.cells[r]?.[c] ?? '')) return false
      }
    }
  }
  return true
}

const undoStack = ref<HistorySnapshot[]>([])
const redoStack = ref<HistorySnapshot[]>([])
const historyVersion = ref(0)
let textChangeTimer: ReturnType<typeof setTimeout> | null = null
let textChangeBaseSnapshot: HistorySnapshot | null = null
let gestureBaseSnapshot: HistorySnapshot | null = null
let isGestureActive = false

const canUndo = computed(
  () => undoStack.value.length > 0 || textChangeBaseSnapshot !== null,
)
const canRedo = computed(() => redoStack.value.length > 0)

function pushUndo(snapshot: HistorySnapshot) {
  undoStack.value.push(snapshot)
  if (undoStack.value.length > 60) {
    undoStack.value.shift()
  }
  redoStack.value = []
}

function commitPendingTextChange() {
  if (textChangeTimer) {
    clearTimeout(textChangeTimer)
    textChangeTimer = null
  }
  if (!textChangeBaseSnapshot || !report.value) return
  const current = cloneSnapshot(report.value)
  if (!snapshotsEqual(textChangeBaseSnapshot, current)) {
    pushUndo(textChangeBaseSnapshot)
  }
  textChangeBaseSnapshot = null
}

function recordTextChange() {
  if (!textChangeBaseSnapshot && report.value) {
    textChangeBaseSnapshot = cloneSnapshot(report.value)
  }
  if (textChangeTimer) {
    clearTimeout(textChangeTimer)
  }
  textChangeTimer = setTimeout(() => {
    commitPendingTextChange()
  }, 400)
}

function recordDiscreteAction() {
  commitPendingTextChange()
  if (report.value) {
    pushUndo(cloneSnapshot(report.value))
  }
}

function onGestureStart() {
  commitPendingTextChange()
  isGestureActive = true
  if (report.value) {
    gestureBaseSnapshot = cloneSnapshot(report.value)
  }
}

function onGestureEnd() {
  isGestureActive = false
  if (gestureBaseSnapshot && report.value) {
    const current = cloneSnapshot(report.value)
    if (!snapshotsEqual(gestureBaseSnapshot, current)) {
      pushUndo(gestureBaseSnapshot)
    }
  }
  gestureBaseSnapshot = null
}

function undo() {
  if (!report.value) return
  if (textChangeTimer) {
    clearTimeout(textChangeTimer)
    textChangeTimer = null
  }
  if (textChangeBaseSnapshot) {
    const target = textChangeBaseSnapshot
    textChangeBaseSnapshot = null
    redoStack.value.push(cloneSnapshot(report.value))
    store.restoreSnapshot(report.value.id, target)
    historyVersion.value++
    return
  }
  if (undoStack.value.length === 0) return
  const prev = undoStack.value.pop()!
  redoStack.value.push(cloneSnapshot(report.value))
  store.restoreSnapshot(report.value.id, prev)
  historyVersion.value++
}

function redo() {
  if (!report.value) return
  commitPendingTextChange()
  if (redoStack.value.length === 0) return
  const next = redoStack.value.pop()!
  undoStack.value.push(cloneSnapshot(report.value))
  store.restoreSnapshot(report.value.id, next)
  historyVersion.value++
}

function onKeydown(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return
  // 电路图弹窗有自己的撤销栈
  if (isCircuitModalOpen.value || isPlotModalOpen.value) return

  const isMod = e.ctrlKey || e.metaKey
  if (!isMod) return

  if (e.key === 'z' || e.key === 'Z') {
    e.preventDefault()
    if (e.shiftKey) {
      redo()
    } else {
      undo()
    }
  } else if (e.key === 'y' || e.key === 'Y') {
    e.preventDefault()
    redo()
  }
}

let isTitleComposing = false

function onTitleCompStart() {
  isTitleComposing = true
}

function onTitleCompEnd(e: Event) {
  isTitleComposing = false
  onTitle(e)
}

function onTitleInput(e: Event) {
  if (isTitleComposing) return
  onTitle(e)
}

// ===== 触摸屏缩放优化：捏合放大页面时，顶栏保持原始物理尺寸 =====
const topbarRef = ref<HTMLElement | null>(null)
const editPageRef = ref<HTMLElement | null>(null)
const baseDpr = window.devicePixelRatio

function syncTopbarScale() {
  const el = topbarRef.value
  const page = editPageRef.value
  if (!el || !page) return
  const vv = window.visualViewport
  // 浏览器缩放（如 Windows 触屏捏合、Ctrl+ +/-）体现在 devicePixelRatio
  const browserZoom = window.devicePixelRatio / baseDpr
  // 移动端捏合缩放（visual viewport）体现在 vv.scale
  const pinchZoom = vv ? vv.scale : 1
  const scale = browserZoom * pinchZoom

  if (scale <= 1.01) {
    el.style.position = ''
    el.style.top = ''
    el.style.left = ''
    el.style.width = ''
    el.style.transform = ''
    el.style.transformOrigin = ''
    page.style.paddingTop = ''
    return
  }

  el.style.position = 'fixed'
  el.style.top = `${vv?.offsetTop ?? 0}px`
  el.style.left = `${vv?.offsetLeft ?? 0}px`
  el.style.width = `${(vv ? vv.width : window.innerWidth) * scale}px`
  el.style.transformOrigin = 'top left'
  // 反向缩放：抵消捏合/浏览器缩放，顶栏在屏幕上不放大
  el.style.transform = `scale(${1 / scale})`
  // 顶栏 fixed 后脱离文档流，用等高占位避免内容上移
  page.style.paddingTop = `${el.offsetHeight / scale}px`
}

const hasTouch = navigator.maxTouchPoints > 0
let topbarResizeObserver: ResizeObserver | null = null

// ===== 自定义捏合缩放：只缩放页面画布，顶栏与弹窗不受影响 =====
const workspaceRef = ref<HTMLElement | null>(null)
const canvasAreaRef = ref<HTMLElement | null>(null)
const pageZoom = ref(1)

let workspacePinch: { dist: number; zoom: number; cx: number; cy: number } | null = null

function onWorkspaceTouchStart(e: TouchEvent) {
  if (e.touches.length !== 2) return
  const ca = canvasAreaRef.value
  if (!ca) return
  const a = e.touches[0]
  const b = e.touches[1]
  const midX = (a.clientX + b.clientX) / 2
  const midY = (a.clientY + b.clientY) / 2
  const rect = ca.getBoundingClientRect()
  workspacePinch = {
    dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1,
    zoom: pageZoom.value,
    cx: (midX - rect.left) / pageZoom.value,
    cy: (midY - rect.top) / pageZoom.value,
  }
  // 双指落下：终止进行中的单指拖拽（表格/电路图），避免误移动
  window.dispatchEvent(new PointerEvent('pointercancel'))
  e.preventDefault()
}

function onWorkspaceTouchMove(e: TouchEvent) {
  if (!workspacePinch || e.touches.length < 2) return
  const ws = workspaceRef.value
  const ca = canvasAreaRef.value
  if (!ws || !ca) return
  const a = e.touches[0]
  const b = e.touches[1]
  const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY)
  const zoom = Math.min(4, Math.max(1, workspacePinch.zoom * (dist / workspacePinch.dist)))
  const midX = (a.clientX + b.clientX) / 2
  const midY = (a.clientY + b.clientY) / 2
  ca.style.zoom = String(zoom)
  // 以双指中点为锚点，缩放的同时跟随平移
  const rect = ca.getBoundingClientRect()
  ws.scrollLeft += rect.left - (midX - workspacePinch.cx * zoom)
  ws.scrollTop += rect.top - (midY - workspacePinch.cy * zoom)
  pageZoom.value = zoom
  e.preventDefault()
}

function onWorkspaceTouchEnd(e: TouchEvent) {
  if (e.touches.length < 2) workspacePinch = null
}

onMounted(() => {
  window.addEventListener('keydown', onKeydown, { capture: true })
  if (hasTouch) {
    topbarResizeObserver = new ResizeObserver(syncTopbarScale)
    if (topbarRef.value) topbarResizeObserver.observe(topbarRef.value)
    window.visualViewport?.addEventListener('resize', syncTopbarScale)
    window.visualViewport?.addEventListener('scroll', syncTopbarScale)
    window.addEventListener('resize', syncTopbarScale)
    syncTopbarScale()
  }
})

onUnmounted(() => {
  topbarResizeObserver?.disconnect()
  window.removeEventListener('keydown', onKeydown, { capture: true })
  if (textChangeTimer) clearTimeout(textChangeTimer)
  if (hasTouch) {
    window.visualViewport?.removeEventListener('resize', syncTopbarScale)
    window.visualViewport?.removeEventListener('scroll', syncTopbarScale)
    window.removeEventListener('resize', syncTopbarScale)
  }
})

const activeTableId = ref<string | null>(null)

const activeTable = computed<TableData | null>(() => {
  if (
    !report.value ||
    !report.value.tables ||
    report.value.tables.length === 0
  ) {
    return null
  }
  if (activeTableId.value) {
    const found = report.value.tables.find(
      (t) => t.id === activeTableId.value,
    )
    if (found) return found
  }
  return report.value.tables[0] || null
})

function onAddRow() {
  if (!report.value || !activeTable.value) return
  if (activeTable.value.rows >= 25) return
  recordDiscreteAction()
  const target = activeTable.value
  const refH = target.rowHeights[target.rows - 1] || 24
  const newRowHeights = [
    ...target.rowHeights,
    Math.max(14, Math.min(refH, 26)),
  ]
  const newCells = target.cells.map((row) => [...row])
  newCells.push(Array(target.cols).fill(''))

  store.updateTable(report.value.id, {
    ...target,
    rows: target.rows + 1,
    rowHeights: newRowHeights,
    cells: newCells,
  })
}

function onRemoveRow() {
  if (!report.value || !activeTable.value || activeTable.value.rows <= 1)
    return
  recordDiscreteAction()
  const target = activeTable.value
  const newRowHeights = target.rowHeights.slice(0, -1)
  const newCells = target.cells.slice(0, -1)

  store.updateTable(report.value.id, {
    ...target,
    rows: target.rows - 1,
    rowHeights: newRowHeights,
    cells: newCells,
  })
}

function onAddCol() {
  if (!report.value || !activeTable.value) return
  if (activeTable.value.cols >= 15) return
  recordDiscreteAction()
  const target = activeTable.value
  const refW = target.colWidths[target.cols - 1] || 80
  const newColWidths = [
    ...target.colWidths,
    Math.max(14, Math.min(refW, 80)),
  ]
  const newCells = target.cells.map((row) => {
    const copy = [...row]
    while (copy.length < target.cols) copy.push('')
    copy.push('')
    return copy
  })

  store.updateTable(report.value.id, {
    ...target,
    cols: target.cols + 1,
    colWidths: newColWidths,
    cells: newCells,
  })
}

function onRemoveCol() {
  if (!report.value || !activeTable.value || activeTable.value.cols <= 1)
    return
  recordDiscreteAction()
  const target = activeTable.value
  const newColWidths = target.colWidths.slice(0, -1)
  const newCells = target.cells.map((row) => row.slice(0, -1))

  store.updateTable(report.value.id, {
    ...target,
    cols: target.cols - 1,
    colWidths: newColWidths,
    cells: newCells,
  })
}

function onOpenInsertTable(page: number) {
  insertModalDefaultPage.value = page
  isInsertModalOpen.value = true
}

function onUpdateTable(table: TableData) {
  if (report.value) {
    activeTableId.value = table.id
    if (!isGestureActive) {
      const oldTable = report.value.tables?.find((t) => t.id === table.id)
      if (
        oldTable &&
        (oldTable.cols !== table.cols || oldTable.rows !== table.rows)
      ) {
        recordDiscreteAction()
      } else {
        recordTextChange()
      }
    }
    store.updateTable(report.value.id, table)
  }
}

function onRemoveTable(tableId: string) {
  if (report.value) {
    recordDiscreteAction()
    if (activeTableId.value === tableId) {
      activeTableId.value = null
    }
    store.removeTable(report.value.id, tableId)
  }
}

function onConfirmInsertTable(payload: {
  page: number
  rows: number
  cols: number
}) {
  if (!report.value) return
  recordDiscreteAction()
  const { page, rows, cols } = payload
  const region = page === 1 ? CONTENT_REGION.page1 : CONTENT_REGION.page2
  const totalW = Math.min(region.w - 40, Math.max(240, cols * 90))
  const colW = Math.round((totalW / cols) * 10) / 10
  const rowH = 26
  const x = Math.round(region.x + (region.w - totalW) / 2)
  const existingCount = (report.value.tables || []).filter(
    (t) => t.page === page,
  ).length
  const y = Math.round(region.y + 24 + ((existingCount * 44) % 240))

  const newTable: TableData = {
    id:
      Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    page,
    x,
    y,
    cols,
    rows,
    colWidths: Array(cols).fill(colW),
    rowHeights: Array(rows).fill(rowH),
    cells: Array.from({ length: rows }, () => Array(cols).fill('')),
  }

  activeTableId.value = newTable.id
  store.addTable(report.value.id, newTable)
}

// ================= 电路图 =================
const isCircuitModalOpen = ref(false)
const editingCircuitId = ref<string | null>(null)
const circuitModalElements = ref<CircuitElement[]>([])
const circuitModalPage = ref(1)

function onOpenCircuitEditor(page = 1) {
  editingCircuitId.value = null
  circuitModalElements.value = []
  circuitModalPage.value = page
  isCircuitModalOpen.value = true
}

function onEditCircuit(circuitId: string) {
  const c = report.value?.circuits?.find((x) => x.id === circuitId)
  if (!c) return
  editingCircuitId.value = c.id
  circuitModalElements.value = c.elements.map((e) => ({ ...e }))
  circuitModalPage.value = c.page
  isCircuitModalOpen.value = true
}

/** 电路图内部单位 -> PDF 点 的默认比例（新插入时） */
const CIRCUIT_PT_PER_UNIT = 0.6

function onConfirmCircuit(payload: { elements: CircuitElement[]; page: number }) {
  if (!report.value) return
  recordDiscreteAction()
  const b = circuitBBox(payload.elements)
  const existing = editingCircuitId.value
    ? report.value.circuits?.find((c) => c.id === editingCircuitId.value)
    : undefined

  if (existing) {
    // 再次编辑：保持原有缩放比例（每单位的点数），位置不变
    const oldScale = existing.w / circuitBBox(existing.elements).w
    const region = existing.page === 1 ? CONTENT_REGION.page1 : CONTENT_REGION.page2
    const w = Math.min(b.w * oldScale, region.x + region.w - existing.x)
    store.upsertCircuit(report.value.id, { ...existing, w, elements: payload.elements })
    return
  }

  const page = payload.page
  const region = page === 1 ? CONTENT_REGION.page1 : CONTENT_REGION.page2
  const scale = Math.min(CIRCUIT_PT_PER_UNIT, (region.w - 40) / b.w, (region.h - 40) / b.h)
  const w = Math.round(b.w * scale)
  const circuit: CircuitData = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    page,
    x: Math.round(region.x + (region.w - w) / 2),
    y: Math.round(region.y + 24),
    w,
    elements: payload.elements,
  }
  store.upsertCircuit(report.value.id, circuit)
}

function onUpdateCircuit(circuit: CircuitData) {
  if (!report.value) return
  if (!isGestureActive) recordDiscreteAction()
  store.upsertCircuit(report.value.id, circuit)
}

function onRemoveCircuit(circuitId: string) {
  if (!report.value) return
  recordDiscreteAction()
  store.removeCircuit(report.value.id, circuitId)
}

// ================= 图片 =================
const isImageModalOpen = ref(false)
const imageModalDefaultPage = ref(1)
const editingImage = ref<ImageData | null>(null)
const pasteStatus = ref('')

// XY plots reuse the existing movable image container, with editable source attached.
// Persistence, report duplication, text avoidance and export retain the image contract.
const isPlotModalOpen = ref(false)
const plotSource = ref<PlotDocument | null>(null)
const plotDefaultPage = ref(1)
const editingPlot = ref<ImageData | null>(null)
function onOpenPlotEditor() {
  editingPlot.value = null
  plotSource.value = null
  plotDefaultPage.value = 1
  isPlotModalOpen.value = true
}
function onConfirmPlot(payload: { plot: PlotDocument; page: number; src: string; naturalW: number; naturalH: number }) {
  insertImage(payload, editingPlot.value)
}

async function onPasteImages(page: number, files: File[]) {
  const targetReportId = reportId.value
  pasteStatus.value = '正在读取剪贴板图片…'
  try {
    for (const file of files) {
      const source = await readImageFile(file)
      if (reportId.value !== targetReportId) return
      insertImage({ page, ...source })
    }
    pasteStatus.value = ''
  } catch (error) {
    pasteStatus.value = '粘贴失败：' + (error as Error).message
  }
}

function onOpenInsertImage(page: number) {
  editingImage.value = null
  imageModalDefaultPage.value = page
  isImageModalOpen.value = true
}

function onConfirmInsertImage(payload: {
  page: number
  src: string
  naturalW: number
  naturalH: number
}) {
  insertImage(payload, editingImage.value)
}

function insertImage(payload: {
  plot?: PlotDocument
  page: number
  src: string
  naturalW: number
  naturalH: number
}, existing: ImageData | null = null) {
  if (!report.value) return
  recordDiscreteAction()
  const { page, src, naturalW, naturalH } = payload
  const region = page === 1 ? CONTENT_REGION.page1 : CONTENT_REGION.page2

  if (existing) {
    // 更换图片：位置与宽度保持不变，只替换图片内容与原始尺寸
    const plot = payload.plot ? withScale(payload.plot, existing.w) : undefined
    store.updateImage(report.value.id, {
      ...existing,
      src: plot ? plotDataUrl(plot) : src,
      naturalW,
      naturalH,
      ...(plot ? { plot } : {}),
    })
    return
  }

  // 默认宽度：在内容区内等比铺开，宽高中取更紧的一侧
  const w = Math.min(region.w - 40, (region.h - 40) * (naturalW / naturalH))
  // 图表按显示宽度重新生成，使文字与线宽适合该尺寸
  const plot = payload.plot ? withScale(payload.plot, Math.round(w)) : undefined
  const image: ImageData = {
    ...(plot ? { plot } : {}),
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
    page,
    x: Math.round(region.x + (region.w - w) / 2),
    y: Math.round(region.y + 24),
    w: Math.round(w),
    src: plot ? plotDataUrl(plot) : src,
    naturalW,
    naturalH,
  }
  store.addImage(report.value.id, image)
}

function onUpdateImage(image: ImageData) {
  if (!report.value) return
  if (!isGestureActive) recordDiscreteAction()
  // 缩放图表时按新宽度重新生成，文字与线宽随之调整（只在比例实际变化时重绘）
  if (image.plot && styleScaleFor(image.w) !== (image.plot.scale ?? 1)) {
    const plot = withScale(image.plot, image.w)
    image = { ...image, plot, src: plotDataUrl(plot) }
  }
  store.updateImage(report.value.id, image)
}

function onEditImage(imageId: string) {
  if (!report.value) return
  const img = report.value.images?.find((x) => x.id === imageId)
  if (!img) return
  if (img.plot) {
    editingPlot.value = img
    plotSource.value = withScale(img.plot, img.w)
    plotDefaultPage.value = img.page
    isPlotModalOpen.value = true
    return
  }
  imageModalDefaultPage.value = img.page
  editingImage.value = img
  isImageModalOpen.value = true
}

function onRemoveImage(imageId: string) {
  if (!report.value) return
  recordDiscreteAction()
  store.removeImage(report.value.id, imageId)
}

function onUpdateField(fieldId: string, value: string) {
  if (report.value) {
    if (fieldId === 'courseType') {
      recordDiscreteAction()
    } else {
      recordTextChange()
    }
    store.setFieldValue(report.value.id, fieldId, value)
    if (fieldId === 'topic') {
      store.setTitle(report.value.id, value)
    }
  }
}

function onTitle(e: Event) {
  if (report.value) {
    recordTextChange()
    const val = (e.target as HTMLInputElement).value
    store.setTitle(report.value.id, val)
    store.setFieldValue(report.value.id, 'topic', val)
  }
}

async function exportAll() {
  if (!report.value || exporting.value) return
  const format = exportFormat.value
  const reportTitle = currentTitle.value || '实验报告'
  const data: ReportData = JSON.parse(JSON.stringify(report.value))
  exporting.value = true
  exportStatus.value = format === 'pdf' ? '正在生成 PDF…' : '正在生成图片…'
  try {
    if (format === 'pdf') {
      const { exportReportPdf } = await import('@/lib/pdfExporter')
      const blob = await exportReportPdf(data, formTemplate, (page) => {
        exportStatus.value = `正在生成 PDF：第 ${page}/${formTemplate.pages} 页…`
      })
      const url = URL.createObjectURL(blob)
      download(url, `${reportTitle}.pdf`)
      // Give the browser time to start the download before releasing the URL.
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } else {
      for (let page = 1; page <= formTemplate.pages; page++) {
        const bgUrl = page === 1 ? '/bg_page1.png' : '/bg_page2.png'
        const { dataUrl } = await exportPage(
          page,
          bgUrl,
          data,
          formTemplate,
          2,
        )
        download(
          dataUrl,
          `${reportTitle}-第${page}页.png`,
        )
      }
    }
    exportStatus.value = '导出完成 ✓'
  } catch (e) {
    console.error(e)
    exportStatus.value = '导出失败：' + (e as Error).message
  } finally {
    exporting.value = false
  }
}

function download(dataUrl: string, filename: string) {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
}

function goBack() {
  router.push('/')
}
</script>

<template>
  <div class="edit-page" ref="editPageRef">
    <header class="topbar" ref="topbarRef">
      <button class="ghost" @click="goBack">← 返回列表</button>
      <div class="title-wrap">
        <input
          class="title-input"
          :value="currentTitle"
          placeholder="未命名报告"
          @compositionstart="onTitleCompStart"
          @compositionend="onTitleCompEnd"
          @input="onTitleInput"
        />
        <div class="history-btns">
          <button
            type="button"
            class="history-btn"
            :disabled="!canUndo"
            title="撤销 (Ctrl+Z)"
            @click="undo"
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3 7v6h6" />
              <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
            </svg>
          </button>
          <button
            type="button"
            class="history-btn"
            :disabled="!canRedo"
            title="重做 (Ctrl+Y)"
            @click="redo"
          >
            <svg
              viewBox="0 0 24 24"
              width="15"
              height="15"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M21 7v6h-6" />
              <path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13" />
            </svg>
          </button>
        </div>

        <div class="table-adjust-btns">
          <button
            type="button"
            class="adjust-btn"
            :disabled="!activeTable"
            title="增加一行"
            @click="onAddRow"
          >
            <svg
              class="adjust-icon"
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="4" width="18" height="5" rx="1" />
              <rect x="3" y="12" width="11" height="5" rx="1" />
              <path d="M19 12v6M16 15h6" />
            </svg>
            <span>+行</span>
          </button>
          <button
            type="button"
            class="adjust-btn"
            :disabled="!activeTable || activeTable.rows <= 1"
            title="减少一行"
            @click="onRemoveRow"
          >
            <svg
              class="adjust-icon"
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="3" y="4" width="18" height="5" rx="1" />
              <rect x="3" y="12" width="11" height="5" rx="1" />
              <path d="M16 15h6" />
            </svg>
            <span>-行</span>
          </button>
          <button
            type="button"
            class="adjust-btn"
            :disabled="!activeTable"
            title="增加一列"
            @click="onAddCol"
          >
            <svg
              class="adjust-icon"
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="4" y="3" width="5" height="18" rx="1" />
              <rect x="12" y="3" width="5" height="11" rx="1" />
              <path d="M15 19h6M18 16v6" />
            </svg>
            <span>+列</span>
          </button>
          <button
            type="button"
            class="adjust-btn"
            :disabled="!activeTable || activeTable.cols <= 1"
            title="减少一列"
            @click="onRemoveCol"
          >
            <svg
              class="adjust-icon"
              viewBox="0 0 24 24"
              width="13"
              height="13"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <rect x="4" y="3" width="5" height="18" rx="1" />
              <rect x="12" y="3" width="5" height="11" rx="1" />
              <path d="M15 19h6" />
            </svg>
            <span>-列</span>
          </button>
        </div>
      </div>
      <div class="course-switch">
        <span class="switch-label">课程：</span>
        <button
          type="button"
          class="switch-btn"
          :class="{ active: (report?.values['courseType'] || '模拟电路') === '模拟电路' }"
          @click="onUpdateField('courseType', '模拟电路')"
        >
          模电
        </button>
        <button
          type="button"
          class="switch-btn"
          :class="{ active: report?.values['courseType'] === '数字电路' }"
          @click="onUpdateField('courseType', '数字电路')"
        >
          数电
        </button>
      </div>
      <div class="actions">
        <span v-if="pasteStatus" class="status" role="status">{{ pasteStatus }}</span>
        <span v-if="exportStatus" class="status">{{ exportStatus }}</span>
        <button
          type="button"
          class="ghost table-shortcut-btn"
          title="在实验内容中插入表格"
          @click="onOpenInsertTable(1)"
        >
          <svg
            class="action-svg"
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
          <span>插入表格</span>
        </button>
        <button
          type="button"
          class="ghost table-shortcut-btn"
          title="绘制电路图并插入实验内容"
          @click="onOpenCircuitEditor(1)"
        >
          <svg
            class="action-svg"
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
          >
            <path d="M2 12h4l2-4 3 8 3-8 2 4h6" />
          </svg>
          <span>插入电路图</span>
        </button>
        <button
          type="button"
          class="ghost table-shortcut-btn"
          title="选择图片并插入实验内容"
          @click="onOpenInsertImage(1)"
        >
          <svg
            class="action-svg"
            viewBox="0 0 24 24"
            width="15"
            height="15"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
          <span>插入图片</span>
        </button>
        <button type="button" class="ghost table-shortcut-btn" @click="onOpenPlotEditor">
          <svg class="action-svg" viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18M5 15h4V7h5v8h5V7h3" /></svg>
          <span>插入图表</span>
        </button>
        <div class="export-controls">
          <select v-model="exportFormat" aria-label="导出格式" :disabled="exporting">
            <option value="png">PNG 图片</option>
            <option value="pdf">PDF（A4 · 300 dpi）</option>
          </select>
          <button class="primary" :disabled="exporting" @click="exportAll">
            {{ exporting ? '导出中…' : exportFormat === 'pdf' ? '导出 PDF' : '导出图片' }}
          </button>
        </div>
      </div>
    </header>

    <div
      class="workspace"
      ref="workspaceRef"
      @touchstart="onWorkspaceTouchStart"
      @touchmove="onWorkspaceTouchMove"
      @touchend="onWorkspaceTouchEnd"
      @touchcancel="onWorkspaceTouchEnd"
    >
      <main class="canvas-area" ref="canvasAreaRef">
        <div
          v-for="pageNum in formTemplate.pages"
          :key="pageNum"
          class="page-section"
        >
          <div class="page-divider-label">第 {{ pageNum }} 页</div>
          <div class="page-wrap">
            <PageEditor
              v-if="report"
              :key="'page-' + pageNum + '-v' + historyVersion"
              :page="pageNum"
              :bg-url="pageNum === 1 ? '/bg_page1.png' : '/bg_page2.png'"
              :data="report"
              :template="formTemplate"
              editable
              @update:field="onUpdateField"
              @update:table="onUpdateTable"
              @remove:table="onRemoveTable"
              @open:insert-table="onOpenInsertTable"
              @update:circuit="onUpdateCircuit"
              @remove:circuit="onRemoveCircuit"
              @edit:circuit="onEditCircuit"
              @update:image="onUpdateImage"
              @remove:image="onRemoveImage"
              @edit:image="onEditImage"
              @open:insert-image="onOpenInsertImage"
              @paste:images="onPasteImages"
              @gesture-start="onGestureStart"
              @gesture-end="onGestureEnd"
            />
          </div>
        </div>
      </main>
    </div>

    <InsertTableModal
      v-model:visible="isInsertModalOpen"
      :default-page="insertModalDefaultPage"
      @confirm="onConfirmInsertTable"
    />

    <CircuitEditorModal
      v-model:visible="isCircuitModalOpen"
      :elements="circuitModalElements"
      :editing="editingCircuitId !== null"
      :default-page="circuitModalPage"
      @confirm="onConfirmCircuit"
    />

    <PlotEditorModal
      v-model:visible="isPlotModalOpen"
      :source="plotSource"
      :default-page="plotDefaultPage"
      :editing="editingPlot !== null"
      @confirm="onConfirmPlot"
    />

    <InsertImageModal
      v-model:visible="isImageModalOpen"
      :default-page="imageModalDefaultPage"
      :editing="editingImage !== null"
      @confirm="onConfirmInsertImage"
    />
  </div>
</template>

<style scoped>
.edit-page {
  display: flex;
  flex-direction: column;
  height: 100%;
  /* 阻止原生捏合缩放：工作区用自定义缩放，顶栏/弹窗保持原尺寸 */
  touch-action: pan-x pan-y;
}

.topbar {
  display: flex;
  flex-wrap: wrap;
  flex-shrink: 0;
  align-items: center;
  gap: 12px;
  padding: 10px 16px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  position: sticky;
  top: 0;
  z-index: 10;
}

.title-wrap {
  flex: 1 1 420px;
  min-width: 0;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

/* Keep each control intact; wrap groups instead of squeezing Chinese labels. */
.topbar button {
  flex-shrink: 0;
  white-space: nowrap;
}

.history-btns {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
  background: var(--bg);
  padding: 2px;
  border-radius: 8px;
  border: 1px solid var(--border);
}

.history-btn {
  width: 28px;
  height: 28px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--text);
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.12s ease;
}
.history-btn:hover:not(:disabled) {
  background: #ffffff;
  color: var(--primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.history-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.table-adjust-btns {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 2px;
  background: var(--bg);
  padding: 2px;
  border-radius: 8px;
  border: 1px solid var(--border);
}

.adjust-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  background: transparent;
  color: var(--text);
  border-radius: 6px;
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  line-height: 1;
  transition: all 0.12s ease;
  user-select: none;
}
.adjust-btn .adjust-icon {
  flex-shrink: 0;
  opacity: 0.75;
  transition: opacity 0.12s, color 0.12s;
}
.adjust-btn:hover:not(:disabled) .adjust-icon {
  opacity: 1;
  color: var(--primary);
}
.adjust-btn:hover:not(:disabled) {
  background: #ffffff;
  color: var(--primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}
.adjust-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.course-switch {
  display: flex;
  flex-shrink: 0;
  white-space: nowrap;
  align-items: center;
  background: var(--bg);
  padding: 3px 6px;
  border-radius: 8px;
  gap: 4px;
}
.switch-label {
  font-size: 13px;
  color: var(--muted);
  font-weight: 500;
  margin-right: 2px;
}
.switch-btn {
  padding: 4px 10px;
  border: none;
  background: transparent;
  color: var(--muted);
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  transition: all 0.15s;
}
.switch-btn:hover {
  color: var(--text);
}
.switch-btn.active {
  background: #fff;
  color: var(--primary);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.title-input {
  flex: 1 1 160px;
  width: auto;
  max-width: 380px;
  min-width: 0;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
  border: none;
  background: transparent;
  padding: 6px 10px;
  border-radius: 6px;
  outline: none;
}
.title-input:focus {
  background: var(--bg);
}

.actions {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  max-width: 100%;
  margin-left: auto;
  align-items: center;
  gap: 10px;
}

.status {
  overflow-wrap: anywhere;
  color: var(--muted);
  font-size: 13px;
}

.export-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
  max-width: 100%;
}

.export-controls select {
  min-width: 0;
  max-width: 100%;
  padding: 7px 10px;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  background: var(--panel);
  color: var(--text);
  font: inherit;
  font-size: 13px;
}

button.ghost {
  background: transparent;
  border: 1px solid var(--border);
  color: var(--muted);
  padding: 6px 12px;
  border-radius: var(--radius);
}
button.ghost:hover {
  background: var(--bg);
  color: var(--text);
}

.table-shortcut-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  color: var(--primary);
  border-color: rgba(37, 99, 235, 0.3);
}
.table-shortcut-btn:hover {
  background: #eff6ff;
  border-color: var(--primary);
  color: var(--primary);
}
.action-svg {
  flex-shrink: 0;
  color: currentColor;
}

button.primary {
  background: var(--primary);
  border: none;
  color: #fff;
  font-weight: 600;
  padding: 8px 18px;
  border-radius: var(--radius);
  transition: background 0.15s;
}
button.primary:hover {
  background: var(--primary-hover);
}
button.primary:disabled {
  opacity: 0.6;
}

.workspace {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding: 20px;
}

.canvas-area {
  max-width: 900px;
  margin: 0 auto;
  display: flex;
  flex-direction: column;
  gap: 32px;
}

.page-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.page-divider-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--muted);
  user-select: none;
  display: flex;
  align-items: center;
  gap: 8px;
}

.page-divider-label::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--border);
}

.page-wrap {
  background: #fff;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08);
}
</style>
