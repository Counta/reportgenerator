<script setup lang="ts">
import { computed } from 'vue'
import type { CircuitData, FieldDef, FormTemplate, ImageData, ReportData, TableData } from '@/types'
import { PAGE_SIZE_PT } from '@/types'
import type { MergeTarget } from '@/lib/tableMerge'
import { isFlowField, layoutFieldText, splitExperimentContent, type FieldTextLayout } from '@/lib/textLayout'
import TableOverlay from '@/components/TableOverlay.vue'
import CircuitOverlay from '@/components/CircuitOverlay.vue'
import ImageOverlay from '@/components/ImageOverlay.vue'
import ContentFlowEditor from '@/components/ContentFlowEditor.vue'
import { circuitObstacles } from '@/lib/circuit'
import { imageObstacles } from '@/lib/image'

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
  (e: 'update:circuit', circuit: CircuitData): void
  (e: 'remove:circuit', circuitId: string): void
  (e: 'edit:circuit', circuitId: string): void
  (e: 'update:image', image: ImageData): void
  (e: 'remove:image', imageId: string): void
  (e: 'edit:image', imageId: string): void
  (e: 'open:insert-image', page: number): void
  (e: 'paste:images', page: number, files: File[]): void
  (e: 'gesture-start'): void
  (e: 'gesture-end'): void
  (e: 'merge-target', target: MergeTarget | null, tableId: string): void
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

// 与导出共用同一份排版结果（见 lib/textLayout.ts）
const experimentSplit = computed(() => {
  return splitExperimentContent(
    props.data.values['content'] || '',
    props.data.tables || [],
    [...circuitObstacles(props.data.circuits), ...imageObstacles(props.data.images)],
  )
})

/** 本页多行文本框（实验目的 / 实验器材 / 问题讨论）的排版，与导出共用 */
const fieldLayouts = computed<Record<string, FieldTextLayout>>(() => {
  const out: Record<string, FieldTextLayout> = {}
  for (const f of props.template.fields) {
    if (f.page !== props.page || !isFlowField(f)) continue
    out[f.id] = layoutFieldText(props.data.values[f.id] || '', f.page, f.rect)
  }
  return out
})

const pageTables = computed<TableData[]>(() =>
  (props.data.tables || []).filter((t) => t.page === props.page),
)

const pageCircuits = computed<CircuitData[]>(() =>
  (props.data.circuits || []).filter((c) => c.page === props.page),
)

const pageImages = computed<ImageData[]>(() =>
  (props.data.images || []).filter((i) => i.page === props.page),
)

function onUpdateTable(table: TableData) {
  emit('update:table', table)
}

function onRemoveTable(tableId: string) {
  emit('remove:table', tableId)
}

// 单行输入 / 普通多行框的输入法组字状态
let isComposing = false

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

function onContentChange(text: string) {
  emit('update:field', 'content', text)
}

function onContentPasteImages(files: File[]) {
  emit('paste:images', props.page, files)
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

        <button
          v-if="editable"
          type="button"
          class="insert-table-side-btn"
          title="插入图片"
          @click.stop="emit('open:insert-image', page)"
        >
          <svg
            class="side-btn-icon"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
        </button>

        <ContentFlowEditor
          group="content"
          :page="2"
          :origin="p.field.rect"
          :lines="experimentSplit.layout.page2Lines"
          :source="experimentSplit.layout.source"
          :editable="editable"
          @change="onContentChange"
          @paste-images="onContentPasteImages"
        />

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

        <button
          v-if="editable"
          type="button"
          class="insert-table-side-btn"
          title="插入图片"
          @click.stop="emit('open:insert-image', page)"
        >
          <svg
            class="side-btn-icon"
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="none"
            stroke="currentColor"
            stroke-width="1.8"
            stroke-linecap="round"
            stroke-linejoin="round"
            aria-hidden="true"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
        </button>

        <ContentFlowEditor
          group="content"
          :page="1"
          :origin="p.field.rect"
          :lines="experimentSplit.layout.page1Lines"
          :source="experimentSplit.layout.source"
          :editable="editable"
          @change="onContentChange"
          @paste-images="onContentPasteImages"
        />

        <span
          v-if="experimentSplit.isOverflow"
          class="box-badge warning"
        >
          已超出第 1 页容量（超出行自动接续至第 2 页顶部）
        </span>
      </div>

      <!-- 其他通用 textarea (如 purpose, equipment, discussion) -->
      <div v-else-if="fieldLayouts[p.field.id]" class="field-box">
        <ContentFlowEditor
          :group="'field:' + p.field.id"
          :page="page"
          :origin="p.field.rect"
          :lines="fieldLayouts[p.field.id]!.lines"
          :source="fieldLayouts[p.field.id]!.source"
          :editable="editable"
          :placeholder="p.field.label"
          framed
          @change="(text: string) => emit('update:field', p.field.id, text)"
        />
        <span v-if="fieldLayouts[p.field.id]!.isOverflow" class="box-badge warning">
          内容过多：已缩至最小字号仍放不下，超出部分不会导出
        </span>
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
      @merge-target="(target, tableId) => emit('merge-target', target, tableId)"
    />

    <!-- 浮动电路图 -->
    <CircuitOverlay
      v-for="c in pageCircuits"
      :key="'circuit-' + c.id"
      :circuit="c"
      :editable="editable"
      @update="emit('update:circuit', $event)"
      @remove="emit('remove:circuit', $event)"
      @edit="emit('edit:circuit', $event)"
      @gesture-start="emit('gesture-start')"
      @gesture-end="emit('gesture-end')"
    />

    <!-- 浮动图片 -->
    <ImageOverlay
      v-for="img in pageImages"
      :key="'image-' + img.id"
      :image="img"
      :editable="editable"
      @update="emit('update:image', $event)"
      @remove="emit('remove:image', $event)"
      @edit="emit('edit:image', $event)"
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

.layer-input {
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
.layer-input:focus {
  background: rgba(37, 99, 235, 0.08);
  border-color: rgba(37, 99, 235, 0.45);
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

/* 同框内第二个侧边按钮（图片）下移到首按钮下方 */
.insert-table-side-btn + .insert-table-side-btn {
  top: 44px;
}
</style>
