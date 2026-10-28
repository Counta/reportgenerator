<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { clipboardImages, readImageFile } from '@/lib/image'

const props = defineProps<{
  visible: boolean
  defaultPage: number
  /** 更换已有图片时为 true：位置/页面保持不变 */
  editing?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:visible', val: boolean): void
  (e: 'confirm', payload: { page: number; src: string; naturalW: number; naturalH: number }): void
}>()

const modalRef = ref<HTMLDivElement | null>(null)
const loading = ref(false)
let readVersion = 0
const page = ref(1)
const fileInput = ref<HTMLInputElement | null>(null)
const src = ref('')
const naturalW = ref(0)
const naturalH = ref(0)
const error = ref('')

watch(
  () => props.visible,
  async (val) => {
    readVersion++
    loading.value = false
    if (val) {
      page.value = props.defaultPage || 1
      src.value = ''
      naturalW.value = 0
      naturalH.value = 0
      error.value = ''
      await nextTick()
      modalRef.value?.focus()
    }
  },
  { immediate: true },
)

async function readFile(file: File | undefined | null) {
  if (!file) return
  const version = ++readVersion
  loading.value = true
  error.value = ''
  try {
    const image = await readImageFile(file)
    if (version !== readVersion) return
    src.value = image.src
    naturalW.value = image.naturalW
    naturalH.value = image.naturalH
  } catch (cause) {
    if (version === readVersion) error.value = (cause as Error).message
  } finally {
    if (version === readVersion) loading.value = false
  }
}

function onPaste(e: ClipboardEvent) {
  const file = clipboardImages(e.clipboardData)[0]
  if (!file) return
  e.preventDefault()
  void readFile(file)
}

function onPickClick() {
  fileInput.value?.click()
}

function close() {
  emit('update:visible', false)
}

function submit() {
  if (loading.value || error.value || !src.value || !naturalW.value || !naturalH.value) return
  emit('confirm', {
    page: page.value,
    src: src.value,
    naturalW: naturalW.value,
    naturalH: naturalH.value,
  })
  close()
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.preventDefault()
    close()
  } else if (e.key === 'Enter') {
    submit()
  }
}
</script>

<template>
  <div
    v-if="visible"
    ref="modalRef"
    tabindex="-1"
    class="modal-backdrop"
    @paste="onPaste"
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
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="m21 15-5-5L5 21" />
          </svg>
          <span>{{ editing ? '更换图片' : '插入图片' }}</span>
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
              :disabled="editing"
              @click="page = 1"
            >
              第 1 页（实验内容）
            </button>
            <button
              type="button"
              class="pill-btn"
              :class="{ active: page === 2 }"
              :disabled="editing"
              @click="page = 2"
            >
              第 2 页（实验内容接续区）
            </button>
          </div>
        </div>

        <div class="file-picker" :class="{ 'has-image': !!src }" @click="onPickClick">
          <input
            ref="fileInput"
            type="file"
            accept="image/*"
            class="hidden-input"
            @change="readFile(($event.target as HTMLInputElement).files?.[0])"
          />
          <svg
            v-if="!src"
            class="upload-icon"
            viewBox="0 0 24 24"
            width="34"
            height="34"
            fill="none"
            stroke="currentColor"
            stroke-width="1.6"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <path d="m17 8-5-5-5 5" />
            <path d="M12 3v12" />
          </svg>
          <span v-if="!src" class="pick-tip">点击选择图片，或按 Ctrl+V 粘贴</span>
          <img v-else :src="src" class="preview-image" alt="预览" />
        </div>
        <span v-if="loading" class="pick-dims" role="status">正在读取图片…</span>
        <span v-if="error" class="pick-error">{{ error }}</span>
        <span v-if="src && !error" class="pick-dims">
          {{ naturalW }} × {{ naturalH }} px
        </span>
      </div>

      <footer class="modal-footer">
        <button type="button" class="btn-cancel" @click="close">
          取消
        </button>
        <button type="button" class="btn-submit" :disabled="!src || loading || !!error" @click="submit">
          {{ editing ? '确定更换' : '确定插入' }}
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
  gap: 12px;
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
.pill-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}
.pill-btn.active {
  background: #eff6ff;
  border-color: var(--primary);
  color: var(--primary);
  font-weight: 600;
}
.file-picker {
  min-height: 160px;
  border: 1.5px dashed #cbd5e1;
  border-radius: 10px;
  background: #fafafa;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  padding: 12px;
}
.file-picker:hover {
  border-color: var(--primary);
  background: #f5f8ff;
}
.file-picker.has-image {
  border-style: solid;
  border-color: var(--border);
  background: #fff;
  cursor: pointer;
}
.hidden-input {
  display: none;
}
.upload-icon {
  color: #94a3b8;
}
.pick-tip {
  font-size: 14px;
  color: var(--muted);
}
.preview-image {
  max-width: 100%;
  max-height: 260px;
  border-radius: 6px;
  object-fit: contain;
}
.pick-dims {
  font-size: 12px;
  color: var(--muted);
}
.pick-error {
  font-size: 12px;
  color: #dc2626;
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
.btn-submit:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>