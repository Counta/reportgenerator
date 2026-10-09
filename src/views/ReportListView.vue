<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { useReportsStore } from '@/stores/reports'

const router = useRouter()
const store = useReportsStore()

const fileInput = ref<HTMLInputElement | null>(null)
const importMsg = ref('')

function formatDate(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function create() {
  const report = store.create()
  router.push(`/edit/${report.id}`)
}

function edit(id: string) {
  router.push(`/edit/${id}`)
}

function exportAll() {
  const json = store.exportJson()
  const blob = new Blob([json], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `实验报告-备份-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

function triggerImport() {
  fileInput.value?.click()
}

async function onImportFile(e: Event) {
  const input = e.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const data = JSON.parse(text)
    const count = store.importReports(data)
    importMsg.value = `成功导入 ${count} 份报告`
  } catch (err) {
    importMsg.value = '导入失败：文件格式不正确'
    console.error(err)
  }
  input.value = ''
  setTimeout(() => (importMsg.value = ''), 3000)
}
</script>

<template>
  <div class="list-page">
    <header class="header">
      <div>
        <h1>实验报告填写工具</h1>
      </div>
      <div class="actions">
        <button class="secondary" @click="triggerImport">导入 JSON</button>
        <button class="secondary" @click="exportAll">导出 JSON</button>
        <button class="primary" @click="create">新建报告</button>
        <input
          ref="fileInput"
          type="file"
          accept="application/json,.json"
          style="display: none"
          @change="onImportFile"
        />
      </div>
    </header>

    <p v-if="importMsg" class="import-msg">{{ importMsg }}</p>

    <section class="content">
      <div v-if="store.isEmpty" class="empty">
        <p>还没有报告。</p>
        <p class="hint">点击「新建报告」开始填写，或「导入 JSON」载入备份。</p>
      </div>

      <ul v-else class="card-list">
        <li v-for="r in store.reports" :key="r.id" class="card">
          <div class="card-main" @click="edit(r.id)">
            <h3 class="card-title">
              <span>{{ r.values?.topic || r.title || '未命名报告' }}</span>
              <span class="course-badge">{{ r.values['courseType'] || '模拟电路' }}</span>
            </h3>
            <p class="card-meta">
              <span>创建：{{ formatDate(r.createdAt) }}</span>
              <span>更新：{{ formatDate(r.updatedAt) }}</span>
            </p>
          </div>
          <div class="card-actions">
            <button class="link" @click="edit(r.id)">编辑</button>
            <button class="link" @click="store.duplicate(r.id)">复制</button>
            <button class="link danger" @click="store.remove(r.id)">删除</button>
          </div>
        </li>
      </ul>
    </section>
  </div>
</template>

<style scoped>
.list-page {
  max-width: 960px;
  margin: 0 auto;
  padding: 28px 20px 60px;
}

.header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 20px;
}

h1 {
  font-size: 24px;
  margin: 0 0 6px;
}

.subtitle {
  color: var(--muted);
  font-size: 14px;
  margin: 0;
}

.actions {
  display: flex;
  gap: 10px;
  flex-wrap: wrap;
}

button.primary {
  background: var(--primary);
  border: none;
  color: #fff;
  font-weight: 600;
  padding: 9px 18px;
  border-radius: var(--radius);
}
button.primary:hover {
  background: var(--primary-hover);
}

button.secondary {
  background: var(--panel);
  border: 1px solid var(--border);
  color: var(--text);
  padding: 9px 16px;
  border-radius: var(--radius);
}
button.secondary:hover {
  background: var(--bg);
}

.import-msg {
  padding: 8px 12px;
  background: #ecfdf5;
  color: #047857;
  border-radius: 8px;
  border: 1px solid #a7f3d0;
}

.empty {
  text-align: center;
  padding: 80px 20px;
  color: var(--muted);
  background: var(--panel);
  border-radius: var(--radius);
  border: 1px dashed var(--border);
}
.hint {
  font-size: 13px;
}

.card-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.card {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 16px 18px;
  cursor: pointer;
  transition: box-shadow 0.15s, border-color 0.15s;
}
.card:hover {
  border-color: var(--primary);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.card-main {
  flex: 1;
  min-width: 0;
}

.card-title {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 4px;
  font-size: 16px;
}

.course-badge {
  font-size: 11px;
  font-weight: 600;
  color: var(--primary);
  background: rgba(37, 99, 235, 0.08);
  border: 1px solid rgba(37, 99, 235, 0.2);
  padding: 1px 7px;
  border-radius: 10px;
}

.card-meta {
  margin: 0;
  font-size: 12px;
  color: var(--muted);
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
}

.card-actions {
  display: flex;
  gap: 6px;
  flex-shrink: 0;
}

button.link {
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 5px 10px;
  color: var(--text);
  font-size: 13px;
}
button.link:hover {
  background: var(--bg);
}
button.link.danger {
  color: var(--danger);
  border-color: #fecaca;
}
button.link.danger:hover {
  background: #fef2f2;
}
</style>
