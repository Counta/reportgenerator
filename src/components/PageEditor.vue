<script setup lang="ts">
import { computed } from 'vue'
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

/** 页面尺寸（点）换算为百分比定位 */
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

/** 该页需要渲染的字段及其定位 */
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

/** 实验内容分页拆分状态 */
const experimentSplit = computed(() => {
  return splitExperimentContent(props.data.values['content'] || '')
})

/** 第 2 页接续区显示文本 */
const continuationText = computed(() => {
  return experimentSplit.value.isOverflow
    ? experimentSplit.value.page2Lines.join('\n')
    : ''
})

function onContinuationInput(val: string) {
  const p1Text = experimentSplit.value.page1Lines.join('\n')
  const combined = p1Text + (val ? '\n' + val : '')
  emit('update:field', 'content', combined)
}

/** 本页的表格 */
const pageTables = computed<TableData[]>(() =>
  (props.data.tables || []).filter((t) => t.page === props.page),
)

function onUpdateTable(table: TableData) {
  emit('update:table', table)
}

function onRemoveTable(tableId: string) {
  emit('remove:table', tableId)
}

/* ================= 中文输入法 IME 合成保护 ================= */
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

function onCompEndContinuation(e: Event) {
  isComposing = false
  const val = (e.target as HTMLTextAreaElement).value
  onContinuationInput(val)
}

function onInputContinuation(e: Event) {
  if (isComposing) return
  const val = (e.target as HTMLTextAreaElement).value
  onContinuationInput(val)
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
      <!-- 课程名称：纸面上仅作为静态文字展示，选项只在 topbar 中切换 -->
      <div v-if="p.field.id === 'courseType'" class="course-text-preview">
        {{ data.values['courseType'] || '模拟电路' }}
      </div>

      <!-- 第 2 页实验内容接续区 -->
      <div
        v-else-if="p.field.id === 'contentContinuation'"
        class="field-box"
      >
        <!-- 左侧边表格图标按钮（第 2 页接续区） -->
        <button
          v-if="editable"
          type="button"
          class="insert-table-side-btn"
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

        <textarea
          :value="continuationText"
          class="layer-textarea"
          :placeholder="
            experimentSplit.isOverflow
              ? '实验内容'
              : ''
          "
          @compositionstart="onCompStart"
          @compositionend="onCompEndContinuation"
          @input="onInputContinuation"
        />
        <span v-if="experimentSplit.isOverflow" class="box-badge">
          已自动接续自第 1 页（第 23+ 行）
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

      <!-- 多行文本域（含第 1 页实验内容及溢出提示） -->
      <div v-else class="field-box">
        <!-- 在第 1 页“实验内容”左侧边显示插入表格图标按钮 -->
        <button
          v-if="p.field.id === 'content' && editable"
          type="button"
          class="insert-table-side-btn"
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

        <textarea
          :value="data.values[p.field.id] ?? ''"
          class="layer-textarea"
          :placeholder="p.field.label"
          @compositionstart="onCompStart"
          @compositionend="onCompEndField($event, p.field.id)"
          @input="onInputField($event, p.field.id)"
        />
        <span
          v-if="p.field.id === 'content' && experimentSplit.isOverflow"
          class="box-badge warning"
        >
          已超出第 1 页（第 23 行起已自动接续至第 2 页顶部）
        </span>
      </div>
    </div>

    <!-- 「实验内容」插入的表格 -->
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
  /* 保持 A3 比例 */
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

/* 左侧边表格插入按钮 */
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
