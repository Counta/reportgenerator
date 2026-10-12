<script setup lang="ts">
import { ref, watch } from 'vue'

const props = defineProps<{
  visible: boolean
  defaultPage: number
}>()

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
  (e: 'confirm', payload: { page: number; rows: number; cols: number }): void
}>()

const rows = ref(3)
const cols = ref(4)
const page = ref(1)

const hoverRows = ref(0)
const hoverCols = ref(0)

const MAX_GRID_ROWS = 6
const MAX_GRID_COLS = 8

watch(
  () => props.visible,
  (val) => {
    if (val) {
      page.value = props.defaultPage || 1
      hoverRows.value = 0
      hoverCols.value = 0
    }
  },
  { immediate: true },
)

function onGridHover(r: number, c: number) {
  hoverRows.value = r
  hoverCols.value = c
}

function onGridLeave() {
  hoverRows.value = 0
  hoverCols.value = 0
}

function onGridSelect(r: number, c: number) {
  rows.value = r
  cols.value = c
}

function adjustRows(delta: number) {
  const next = rows.value + delta
  if (next >= 1 && next <= 15) {
    rows.value = next
  }
}

function adjustCols(delta: number) {
  const next = cols.value + delta
  if (next >= 1 && next <= 10) {
    cols.value = next
  }
}

function close() {
  emit('update:visible', false)
}

function submit() {
  emit('confirm', {
    page: page.value,
    rows: Math.max(1, Math.min(15, rows.value)),
    cols: Math.max(1, Math.min(10, cols.value)),
  })
  close()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    close()
  } else if (e.key === 'Enter') {
    submit()
  }
}
</script>

<template>
  <div
    v-if="visible"
    class="modal-backdrop"
    @click.self="close"
    @keydown="onKeydown"
  >
    <div class="modal-card" role="dialog" aria-modal="true">
      <header class="modal-header">
        <div class="modal-title">
          <svg
            class="modal-icon"
            viewBox="0 0 24 24"
            width="20"
            height="20"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
          >
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <path d="M3 9h18M3 15h18M9 3v18M15 3v18" />
          </svg>
          <span>插入表格</span>
        </div>
        <button
          type="button"
          class="modal-close"
          title="关闭"
          @click="close"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
            <path
              d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
            />
          </svg>
        </button>
      </header>

      <div class="modal-body">
        <div class="form-row">
          <span class="form-label">插入位置</span>
          <div class="page-pills">
            <button
              type="button"
              class="pill-btn"
              :class="{ active: page === 1 }"
              @click="page = 1"
            >
              第 1 页（实验内容）
            </button>
            <button
              type="button"
              class="pill-btn"
              :class="{ active: page === 2 }"
              @click="page = 2"
            >
              第 2 页（实验内容接续区）
            </button>
          </div>
        </div>

        <div class="grid-picker-wrap">
          <div class="grid-picker-header">
            <span class="picker-tip">快捷选择行列</span>
            <span class="picker-current">
              {{ (hoverRows || rows) }} 行 × {{ (hoverCols || cols) }} 列
            </span>
          </div>
          <div
            class="grid-picker"
            @mouseleave="onGridLeave"
          >
            <div
              v-for="r in MAX_GRID_ROWS"
              :key="'gr-' + r"
              class="grid-picker-row"
            >
              <div
                v-for="c in MAX_GRID_COLS"
                :key="'gc-' + r + '-' + c"
                class="grid-picker-cell"
                :class="{
                  highlight:
                    hoverRows > 0 && hoverCols > 0
                      ? r <= hoverRows && c <= hoverCols
                      : r <= rows && c <= cols,
                }"
                @mouseenter="onGridHover(r, c)"
                @click="onGridSelect(r, c)"
              />
            </div>
          </div>
        </div>

        <div class="steppers-wrap">
          <div class="stepper-item">
            <label class="stepper-label">行数</label>
            <div class="stepper-control">
              <button
                type="button"
                class="stepper-btn"
                :disabled="rows <= 1"
                @click="adjustRows(-1)"
              >
                -
              </button>
              <input
                v-model.number="rows"
                type="number"
                min="1"
                max="15"
                class="stepper-input"
              />
              <button
                type="button"
                class="stepper-btn"
                :disabled="rows >= 15"
                @click="adjustRows(1)"
              >
                +
              </button>
            </div>
          </div>

          <div class="stepper-item">
            <label class="stepper-label">列数</label>
            <div class="stepper-control">
              <button
                type="button"
                class="stepper-btn"
                :disabled="cols <= 1"
                @click="adjustCols(-1)"
              >
                -
              </button>
              <input
                v-model.number="cols"
                type="number"
                min="1"
                max="10"
                class="stepper-input"
              />
              <button
                type="button"
                class="stepper-btn"
                :disabled="cols >= 10"
                @click="adjustCols(1)"
              >
                +
              </button>
            </div>
          </div>
        </div>
      </div>

      <footer class="modal-footer">
        <button type="button" class="btn-cancel" @click="close">
          取消
        </button>
        <button type="button" class="btn-submit" @click="submit">
          确定插入
        </button>
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
  /* 阻止原生捏合缩放：弹窗始终保持原尺寸 */
  touch-action: pan-y;
  backdrop-filter: blur(2px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
}

.modal-card {
  width: 100%;
  max-width: 440px;
  background: #ffffff;
  border-radius: 12px;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.18);
  overflow: hidden;
  animation: modal-in 0.18s cubic-bezier(0.16, 1, 0.3, 1);
}

@keyframes modal-in {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(6px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border);
}

.modal-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 16px;
  font-weight: 600;
  color: var(--text);
}

.modal-icon {
  color: var(--primary);
}

.modal-close {
  background: transparent;
  border: none;
  padding: 4px;
  border-radius: 6px;
  color: var(--muted);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.15s;
}
.modal-close:hover {
  background: var(--bg);
  color: var(--text);
}

.modal-body {
  padding: 18px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
}

.page-pills {
  display: flex;
  gap: 8px;
}

.pill-btn {
  flex: 1;
  padding: 7px 10px;
  border: 1px solid var(--border);
  background: #fff;
  color: var(--text);
  border-radius: 8px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}
.pill-btn:hover {
  border-color: #93c5fd;
}
.pill-btn.active {
  background: #eff6ff;
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 600;
}

.grid-picker-wrap {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 12px;
  background: #fafafa;
}

.grid-picker-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
  font-size: 12px;
}

.picker-tip {
  color: var(--muted);
}

.picker-current {
  font-weight: 600;
  color: var(--primary);
}

.grid-picker {
  display: inline-flex;
  flex-direction: column;
  gap: 4px;
  padding: 4px;
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  cursor: pointer;
}

.grid-picker-row {
  display: flex;
  gap: 4px;
}

.grid-picker-cell {
  width: 22px;
  height: 22px;
  border: 1px solid #d1d5db;
  border-radius: 3px;
  background: #ffffff;
  transition: all 0.08s;
}

.grid-picker-cell.highlight {
  background: #3b82f6;
  border-color: #2563eb;
}

.steppers-wrap {
  display: flex;
  gap: 16px;
}

.stepper-item {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.stepper-label {
  font-size: 13px;
  font-weight: 500;
  color: var(--muted);
}

.stepper-control {
  display: flex;
  align-items: center;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
}

.stepper-btn {
  width: 36px;
  height: 36px;
  background: var(--bg);
  border: none;
  font-size: 18px;
  font-weight: 600;
  color: var(--text);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  user-select: none;
  transition: background 0.12s;
}
.stepper-btn:hover:not(:disabled) {
  background: #e5e7eb;
}
.stepper-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.stepper-input {
  flex: 1;
  height: 36px;
  border: none;
  text-align: center;
  font-size: 15px;
  font-weight: 600;
  color: var(--text);
  outline: none;
}
.stepper-input::-webkit-outer-spin-button,
.stepper-input::-webkit-inner-spin-button {
  -webkit-appearance: none;
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
  background: #ffffff;
  border: 1px solid var(--border);
  border-radius: var(--radius);
  color: var(--text);
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.12s;
}
.btn-cancel:hover {
  background: var(--bg);
}

.btn-submit {
  padding: 8px 20px;
  background: var(--primary);
  border: none;
  border-radius: var(--radius);
  color: #ffffff;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.12s;
}
.btn-submit:hover {
  background: var(--primary-hover);
}
</style>
