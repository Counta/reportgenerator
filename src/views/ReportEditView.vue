<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageEditor from '@/components/PageEditor.vue'
import InsertTableModal from '@/components/InsertTableModal.vue'
import { formTemplate, CONTENT_REGION } from '@/lib/formTemplate'
import { exportPage } from '@/lib/exporter'
import { useReportsStore } from '@/stores/reports'
import type { ReportData, TableData } from '@/types'

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
const exportStatus = ref('')
const isInsertModalOpen = ref(false)
const insertModalDefaultPage = ref(1)

// ================= 撤销 / 重做 历史管理器 =================
interface HistorySnapshot {
  title: string
  values: Record<string, string>
  tables: TableData[]
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
  // 如果输入法正在打字合成中（如拼音选词），直接放行
  if (e.isComposing || e.keyCode === 229) return

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

onMounted(() => {
  window.addEventListener('keydown', onKeydown, { capture: true })
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeydown, { capture: true })
  if (textChangeTimer) clearTimeout(textChangeTimer)
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

function exportAll() {
  if (!report.value) return
  exporting.value = true
  exportStatus.value = '正在生成图片…'
  // 逐页串行导出，避免同时生成多张占用内存
  ;(async () => {
    try {
      const reportTitle = currentTitle.value || '实验报告'
      for (let page = 1; page <= formTemplate.pages; page++) {
        const bgUrl = page === 1 ? '/bg_page1.png' : '/bg_page2.png'
        const { dataUrl } = await exportPage(
          page,
          bgUrl,
          report.value!,
          formTemplate,
          2,
        )
        download(
          dataUrl,
          `${reportTitle}-第${page}页.png`,
        )
      }
      exportStatus.value = '导出完成 ✓'
    } catch (e) {
      console.error(e)
      exportStatus.value = '导出失败：' + (e as Error).message
    } finally {
      setTimeout(() => (exporting.value = false), 600)
    }
  })()
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
  <div class="edit-page">
    <header class="topbar">
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
        <!-- 撤销 / 重做 按钮组 -->
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

        <!-- 撤销重做按钮右侧：+行 / -行 / +列 / -列 快捷调节组（附直观图标） -->
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
          模拟电路
        </button>
        <button
          type="button"
          class="switch-btn"
          :class="{ active: report?.values['courseType'] === '数字电路' }"
          @click="onUpdateField('courseType', '数字电路')"
        >
          数字电路
        </button>
      </div>
      <div class="actions">
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
        <button class="primary" :disabled="exporting" @click="exportAll">
          {{ exporting ? '导出中…' : '导出图片' }}
        </button>
      </div>
    </header>

    <div class="workspace">
      <main class="canvas-area">
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
              @gesture-start="onGestureStart"
              @gesture-end="onGestureEnd"
            />
          </div>
        </div>
      </main>
    </div>

    <!-- 插入表格弹窗 -->
    <InsertTableModal
      v-model:visible="isInsertModalOpen"
      :default-page="insertModalDefaultPage"
      @confirm="onConfirmInsertTable"
    />
  </div>
</template>

<style scoped>
.edit-page {
  display: flex;
  flex-direction: column;
  height: 100%;
}

.topbar {
  display: flex;
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
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
}

.history-btns {
  display: flex;
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
  width: auto;
  max-width: 380px;
  min-width: 140px;
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
  align-items: center;
  gap: 10px;
}

.status {
  color: var(--muted);
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
