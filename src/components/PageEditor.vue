<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import type { FieldDef, FormTemplate, ReportData, TableData } from '@/types'
import { PAGE_SIZE_PT } from '@/types'
import { splitExperimentContent } from '@/lib/textLayout'
import TableOverlay from '@/components/TableOverlay.vue'

const props = defineProps<{
  page: number
  bgUrl: string
  data: ReportData
  template: FormTemplate
  /** 编辑模式：显示可编辑输入 */
  editable?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:field', fieldId: string, value: string): void
  (e: 'update:table', table: TableData): void
  (e: 'remove:table', tableId: string): void
  (e: 'open:insert-table', page: number): void
  (e: 'gesture-start'): void
  (e: 'gesture-end'): void
}>()

const PW = PAGE_SIZE_PT.width
const PH = PAGE_SIZE_PT.height

function pct(value: number, total: number): string {
  return `${(value / total) * 100}%`
}

interface Pos {
  field: FieldDef
  left: string
  top: string
  width: string
  height: string
}

const positions = computed<Pos[]>(() =>
  props.template.fields
    .filter((f) => f.page === props.page)
    .map((f) => ({
      field: f,
      left: pct(f.rect.x, PW),
      top: pct(f.rect.y, PH),
      width: pct(f.rect.w, PW),
      height: pct(f.rect.h, PH),
    })),
)

const experimentSplit = computed(() => {
  return splitExperimentContent(
    props.data.values['content'] || '',
    675.1,
    16,
    props.data.tables || [],
  )
})

const continuationText = computed(() => {
  return experimentSplit.value.isOverflow
    ? experimentSplit.value.page2Lines.join('\n')
    : ''
})

const pageTables = computed<TableData[]>(() =>
  (props.data.tables || []).filter((t) => t.page === props.page),
)

function onUpdateTable(table: TableData) {
  emit('update:table', table)
}

function onRemoveTable(tableId: string) {
  emit('remove:table', tableId)
}

// ================= 单一整体输入框与浮动避让 =================
interface TableSpacer {
  id: string
  style: Record<string, string>
}

// PDF 点 -> 页面相对单位（.page-editor 是 inline-size 容器）
function pt(n: number): string {
  return `calc(${n} * 100cqw / ${PW})`
}

const pageSpacers = computed<TableSpacer[]>(() => {
  const contentTop = props.page === 1 ? 558 : 98
  const contentWidth = 675.1
  const contentLeft = 91.7
  const gap = 6
  const out: TableSpacer[] = []
  // 每侧记录已占用到的底部（相对内容区顶部），用零宽“推块”把浮动推到表格的 y
  const bottom: Record<'left' | 'right', number> = { left: 0, right: 0 }

  for (const t of [...pageTables.value].sort((a, b) => a.y - b.y)) {
    const tW = t.colWidths.reduce((a, b) => a + b, 0)
    const tH = t.rowHeights.reduce((a, b) => a + b, 0)
    const relLeft = Math.max(0, t.x - contentLeft)
    const relRight = Math.max(0, contentWidth - relLeft - tW)
    const side: 'left' | 'right' = relLeft <= relRight ? 'left' : 'right'
    const top = Math.max(0, t.y - contentTop - gap)
    const push = Math.max(0, top - bottom[side])
    const width = (side === 'left' ? relLeft : relRight) + tW + gap
    const height = tH + gap * 2
    // 零宽推块：不占水平空间，只把后续同侧浮动推到正确高度
    out.push({
      id: `push-${t.id}`,
      style: { float: side, clear: side, width: '0', height: pt(push) },
    })
    out.push({
      id: `spacer-${t.id}`,
      style: { float: side, clear: side, width: pt(width), height: pt(height) },
    })
    bottom[side] = Math.max(bottom[side], top) + height
  }
  return out
})

const contentEditorRef = ref<HTMLDivElement | null>(null)
const continuationEditorRef = ref<HTMLDivElement | null>(null)
let isComposing = false

// 编辑器位于 v-for 内，字符串 ref 会变成数组，因此用函数 ref 并在挂载时初始化内容
function bindContentEditor(el: unknown) {
  const node = el instanceof HTMLDivElement ? el : null
  if (node && node !== contentEditorRef.value) {
    contentEditorRef.value = node
    setEditorText(node, props.data.values['content'] || '', true)
  } else if (!node) contentEditorRef.value = null
}

function bindContinuationEditor(el: unknown) {
  const node = el instanceof HTMLDivElement ? el : null
  if (node && node !== continuationEditorRef.value) {
    continuationEditorRef.value = node
    setEditorText(node, continuationText.value || '', true)
  } else if (!node) continuationEditorRef.value = null
}

// 编辑器 DOM 完全手动管理（不让 Vue 渲染子节点，避免与输入冲突）
function getTextFromEditor(el: HTMLElement | null): string {
  if (!el) return ''
  let text = ''
  el.childNodes.forEach((n) => {
    if (n instanceof HTMLElement && n.classList.contains('table-float-spacer')) return
    if (n.nodeName === 'BR') text += '\n'
    else if (n instanceof HTMLElement) {
      if (text && !text.endsWith('\n')) text += '\n'
      text += n.innerText
    } else text += n.textContent ?? ''
  })
  return text.replace(/\r/g, '')
}

function renderSpacers(el: HTMLElement | null) {
  if (!el) return
  el.querySelectorAll(':scope > .table-float-spacer').forEach((n) => n.remove())
  const first = el.firstChild
  for (const s of pageSpacers.value) {
    const d = document.createElement('div')
    d.className = 'table-float-spacer'
    d.contentEditable = 'false'
    Object.assign(d.style, s.style)
    el.insertBefore(d, first)
  }
}

function setEditorText(el: HTMLElement | null, text: string, force = false) {
  if (!el) return
  if (!force && document.activeElement === el) return
  if (!force && getTextFromEditor(el) === text) return
  el.textContent = ''
  if (text) el.appendChild(document.createTextNode(text))
  renderSpacers(el)
}

function activeEditor(): HTMLElement | null {
  return props.page === 1 ? contentEditorRef.value : continuationEditorRef.value
}

watch(pageSpacers, () => renderSpacers(activeEditor()), { deep: true })

watch(
  () => props.data.values['content'],
  (newVal) => {
    if (props.page === 1) {
      setEditorText(contentEditorRef.value, newVal || '')
    }
  },
)

watch(
  continuationText,
  (newVal) => {
    if (props.page === 2) {
      setEditorText(continuationEditorRef.value, newVal || '')
    }
  },
)

function onCompStart() {
  isComposing = true
}

function onCompEndField(e: Event, fieldId: string) {
  isComposing = false
  const val = (e.target as HTMLInputElement | HTMLTextAreaElement).value
  emit('update:field', fieldId, val)
}

function onInputField(e: Event, fieldId: string) {
  if (isComposing) return
  const val = (e.target as HTMLInputElement | HTMLTextAreaElement).value
  emit('update:field', fieldId, val)
}

function onEditorCompEnd(e: Event) {
  isComposing = false
  const el = e.target as HTMLElement
  const val = getTextFromEditor(el)
  emit('update:field', 'content', val)
}

function onEditorInput(e: Event) {
  if (isComposing) return
  const el = e.target as HTMLElement
  const val = getTextFromEditor(el)
  emit('update:field', 'content', val)
}

function onContinuationCompEnd(e: Event) {
  isComposing = false
  const el = e.target as HTMLElement
  const val = getTextFromEditor(el)
  const p1Text = experimentSplit.value.page1Lines.join('\n')
  const combined = p1Text + (val ? '\n' + val : '')
  emit('update:field', 'content', combined)
}

function onContinuationEditorInput(e: Event) {
  if (isComposing) return
  const el = e.target as HTMLElement
  const val = getTextFromEditor(el)
  const p1Text = experimentSplit.value.page1Lines.join('\n')
  const combined = p1Text + (val ? '\n' + val : '')
  emit('update:field', 'content', combined)
}

function onEditorPaste(e: ClipboardEvent) {
  const text = e.clipboardData?.getData('text/plain') || ''
  if (!text) return
  document.execCommand('insertText', false, text)
}
</script>

<template>
  <div class="page-editor">
    <img :src="bgUrl" alt="背景" class="bg" draggable="false" />
    <div
      v-for="p in positions"
      :key="p.field.id"
      class="field-layer"
      :class="p.field.type"
      :style="{
        left: p.left,
        top: p.top,
        width: p.width,
        height: p.height,
      }"
    >
      <div v-if="p.field.id === 'courseType'" class="course-text-preview">
        {{ data.values['courseType'] || '模拟电路' }}
      </div>

      <!-- 第 2 页实验内容接续区：单一整体输入框，连续书写无分界线 -->
      <div
        v-else-if="p.field.id === 'contentContinuation'"
        class="field-box"
      >
        <button
          v-if="editable"
          type="button"
          class="insert-table-side-btn"
          title="插入表格"
          @click.stop="emit('open:insert-table', page)"
        >
          <svg
            class="side-btn-icon"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
        </button>

        <div
          :ref="bindContinuationEditor"
          class="unified-content-editor"
          :contenteditable="editable ? 'plaintext-only' : 'false'"
          spellcheck="false"
          @compositionstart="onCompStart"
          @compositionend="onContinuationCompEnd"
          @input="onContinuationEditorInput"
          @paste.prevent="onEditorPaste"
        >
        </div>

        <span v-if="experimentSplit.isOverflow" class="box-badge">
          已自动接续自第 1 页
        </span>
      </div>

      <!-- 单行输入框 -->
      <input
        v-else-if="p.field.type === 'input'"
        :value="data.values[p.field.id] ?? ''"
        class="layer-input"
        :placeholder="p.field.label"
        @compositionstart="onCompStart"
        @compositionend="onCompEndField($event, p.field.id)"
        @input="onInputField($event, p.field.id)"
      />

      <!-- 第 1 页实验内容：单一整体输入框，连续书写无分界线 -->
      <div v-else-if="p.field.id === 'content'" class="field-box">
        <button
          v-if="editable"
          type="button"
          class="insert-table-side-btn"
          title="插入表格"
          @click.stop="emit('open:insert-table', page)"
        >
          <svg
            class="side-btn-icon"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
        </button>

        <div
          :ref="bindContentEditor"
          class="unified-content-editor"
          :contenteditable="editable ? 'plaintext-only' : 'false'"
          spellcheck="false"
          @compositionstart="onCompStart"
          @compositionend="onEditorCompEnd"
          @input="onEditorInput"
          @paste.prevent="onEditorPaste"
        >
        </div>

        <span
          v-if="experimentSplit.isOverflow"
          class="box-badge warning"
        >
          已超出第 1 页容量（超出行自动接续至第 2 页顶部）
        </span>
      </div>

      <!-- 其他通用 textarea (如 purpose, equipment, discussion) -->
      <div v-else class="field-box">
        <textarea
          :value="data.values[p.field.id] ?? ''"
          class="layer-textarea"
          :placeholder="p.field.label"
          @compositionstart="onCompStart"
          @compositionend="onCompEndField($event, p.field.id)"
          @input="onInputField($event, p.field.id)"
        />
      </div>
    </div>

    <!-- 浮动表格 -->
    <TableOverlay
      v-for="t in pageTables"
      :key="'table-' + t.id"
      :table="t"
      :editable="editable"
      @update="onUpdateTable"
      @remove="onRemoveTable"
      @gesture-start="emit('gesture-start')"
      @gesture-end="emit('gesture-end')"
    />
  </div>
</template>

<style scoped>
.page-editor {
  position: relative;
  width: 100%;
  aspect-ratio: 841.92 / 1190.52;
  background: #fff;
  overflow: hidden;
  user-select: none;
  container-type: inline-size;
}

.bg {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  object-fit: fill;
  pointer-events: none;
}

.field-layer {
  position: absolute;
  box-sizing: border-box;
}

.field-box {
  position: relative;
  width: 100%;
  height: 100%;
}

.box-badge {
  position: absolute;
  bottom: 4px;
  right: 6px;
  font-size: 11px;
  background: rgba(37, 99, 235, 0.88);
  color: #fff;
  padding: 2px 7px;
  border-radius: 4px;
  pointer-events: none;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.15);
}

.box-badge.warning {
  background: rgba(217, 119, 6, 0.9);
}

.course-text-preview {
  width: 100%;
  height: 100%;
  font-family: 'SimSun', 'Songti SC', 'STSong', serif;
  font-size: clamp(14px, 1.8vw, 22px);
  color: #000;
  display: flex;
  align-items: flex-end;
  justify-content: flex-end;
  padding-right: 12px;
  padding-bottom: 2px;
  pointer-events: none;
  user-select: none;
}

.layer-input,
.layer-textarea {
  width: 100%;
  height: 100%;
  font-family: 'SimSun', 'Songti SC', 'STSong', 'SimSun-ExtB', -apple-system, BlinkMacSystemFont, 'Segoe UI',
    'Microsoft YaHei', sans-serif;
  border: 1px dashed rgba(37, 99, 235, 0);
  border-radius: 4px;
  background: rgba(37, 99, 235, 0.04);
  color: #000;
  font-size: clamp(10px, 1.6vw, 20px);
  text-align: left;
  padding: 2px 4px;
  resize: none;
  transition: background 0.15s, border-color 0.15s;
  outline: none;
  box-sizing: border-box;
}

.field-layer:hover .layer-input,
.field-layer:hover .layer-textarea,
.layer-input:focus,
.layer-textarea:focus {
  background: rgba(37, 99, 235, 0.08);
  border-color: rgba(37, 99, 235, 0.45);
}

.layer-textarea {
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
}

/* 单一整体输入框：无任何切割分界线，文字自然流淌于横线上 */
.unified-content-editor {
  width: 100%;
  height: 100%;
  border: none !important;
  background: transparent !important;
  outline: none !important;
  box-shadow: none !important;
  font-family: 'SimSun', 'Songti SC', 'STSong', 'SimSun-ExtB', -apple-system, BlinkMacSystemFont, 'Segoe UI',
    'Microsoft YaHei', sans-serif;
  font-size: calc(16 * 100cqw / 841.92);
  line-height: calc(545 / 22 * 100cqw / 841.92);
  color: #000000;
  padding: 0;
  overflow: hidden;
  box-sizing: border-box;
  white-space: pre-wrap;
  word-break: break-word;
  user-select: text;
  cursor: text;
}
.unified-content-editor:focus {
  background: transparent !important;
}

.table-float-spacer {
  background: transparent !important;
  border: none !important;
  pointer-events: none;
  user-select: none;
}

/* 左侧边动作按钮 */
.insert-table-side-btn {
  position: absolute;
  left: -46px;
  top: 4px;
  width: 36px;
  height: 36px;
  padding: 0;
  border-radius: 8px;
  background: #ffffff;
  border: 1px solid #d1d5db;
  color: #2563eb;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  transition: all 0.18s cubic-bezier(0.16, 1, 0.3, 1);
  z-index: 8;
  user-select: none;
}

.insert-table-side-btn:hover {
  background: #2563eb;
  color: #ffffff;
  border-color: #2563eb;
  transform: scale(1.06);
  box-shadow: 0 4px 14px rgba(37, 99, 235, 0.35);
}
</style>
