<script setup lang="ts">
import { computed } from 'vue'
import type { FieldDef, FormTemplate, ReportData } from '@/types'
import { PAGE_SIZE_PT } from '@/types'
import { splitExperimentContent } from '@/lib/textLayout'

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
        <textarea
          :value="continuationText"
          class="layer-textarea"
          :placeholder="
            experimentSplit.isOverflow
              ? '实验内容（接续区）'
              : '实验内容接续区（第 1 页实验内容溢出时，自动在此处接续排版）'
          "
          @input="onContinuationInput(($event.target as HTMLTextAreaElement).value)"
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
        @input="emit('update:field', p.field.id, ($event.target as HTMLInputElement).value)"
      />

      <!-- 多行文本域（含第 1 页实验内容及溢出提示） -->
      <div v-else class="field-box">
        <textarea
          :value="data.values[p.field.id] ?? ''"
          class="layer-textarea"
          :placeholder="p.field.label"
          @input="emit('update:field', p.field.id, ($event.target as HTMLTextAreaElement).value)"
        />
        <span
          v-if="p.field.id === 'content' && experimentSplit.isOverflow"
          class="box-badge warning"
        >
          已超出第 1 页（第 23 行起已自动接续至第 2 页顶部）
        </span>
      </div>
    </div>
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
</style>
