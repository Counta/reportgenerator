<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import PageEditor from '@/components/PageEditor.vue'
import { formTemplate } from '@/lib/formTemplate'
import { exportPage } from '@/lib/exporter'
import { useReportsStore } from '@/stores/reports'

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

function onUpdateField(fieldId: string, value: string) {
  if (report.value) {
    store.setFieldValue(report.value.id, fieldId, value)
    if (fieldId === 'topic') {
      store.setTitle(report.value.id, value)
    }
  }
}

function onTitle(e: Event) {
  if (report.value) {
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
          placeholder="未命名报告（跟随课题）"
          @input="onTitle"
        />
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
              :page="pageNum"
              :bg-url="pageNum === 1 ? '/bg_page1.png' : '/bg_page2.png'"
              :data="report"
              :template="formTemplate"
              editable
              @update:field="onUpdateField"
            />
          </div>
        </div>
      </main>
    </div>
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
  width: 100%;
  max-width: 480px;
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
