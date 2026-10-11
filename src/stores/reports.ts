import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { CircuitData, ReportData, TableData } from '@/types'
import { cloneCircuit } from '@/lib/circuit'
import {
  getUserProfile,
  saveUserProfile,
  getTodayDateString,
} from '@/lib/cookie'

const STORAGE_KEY = 'report-drawer:reports:v1'

function loadFromStorage(): ReportData[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map((r: ReportData) => {
      if (r && r.values && r.values.topic) {
        r.title = r.values.topic
      }
      // 兼容旧数据：没有 tables 字段时补空数组
      if (r && !Array.isArray(r.tables)) {
        r.tables = []
      }
      if (r && !Array.isArray(r.circuits)) {
        r.circuits = []
      }
      return r
    })
  } catch {
    return []
  }
}

function persist(reports: ReportData[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports))
  } catch {
    // 存储空间不足等情况忽略，数据仍在内存中
  }
}

function uid(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  )
}

/** 深拷贝一张表格（避免与原报告共享引用） */
function cloneTable(t: TableData): TableData {
  return {
    ...t,
    colWidths: [...t.colWidths],
    rowHeights: [...t.rowHeights],
    cells: t.cells.map((row) => [...row]),
  }
}

export const useReportsStore = defineStore('reports', () => {
  const reports = ref<ReportData[]>(loadFromStorage())

  const isEmpty = computed(() => reports.value.length === 0)

  function save() {
    persist(reports.value)
  }

  /** 新建报告 */
  function create(title = ''): ReportData {
    const now = new Date().toISOString()
    const profile = getUserProfile()
    const today = getTodayDateString()

    const report: ReportData = {
      id: uid(),
      title,
      createdAt: now,
      updatedAt: now,
      values: {
        courseType: '模拟电路', // 默认模拟电路
        className: profile.className || '',
        name: profile.name || '',
        studentId: profile.studentId || '',
        teammates: profile.teammates || '',
        date: today, // 日期默认填入创建报告时之日期
      },
      tables: [],
      circuits: [],
    }
    reports.value.unshift(report)
    save()
    return report
  }

  /** 克隆一份（用于复制模板） */
  function duplicate(id: string): ReportData | null {
    const src = reports.value.find((r) => r.id === id)
    if (!src) return null
    const now = new Date().toISOString()
    const copy: ReportData = {
      ...src,
      id: uid(),
      title: src.title ? `${src.title}（副本）` : '未命名报告（副本）',
      createdAt: now,
      updatedAt: now,
      values: { ...src.values },
      tables: (src.tables || []).map(cloneTable),
      circuits: (src.circuits || []).map(cloneCircuit),
    }
    reports.value.unshift(copy)
    save()
    return copy
  }

  /** 删除报告 */
  function remove(id: string) {
    const idx = reports.value.findIndex((r) => r.id === id)
    if (idx >= 0) {
      reports.value.splice(idx, 1)
      save()
    }
  }

  /** 更新字段值 */
  function setFieldValue(reportId: string, fieldId: string, value: string) {
    const report = reports.value.find((r) => r.id === reportId)
    if (!report) return
    report.values[fieldId] = value
    report.updatedAt = new Date().toISOString()

    // 标题报告名应跟随课题之名称变化
    if (fieldId === 'topic') {
      report.title = value
    }

    // 班级、姓名、学号、同组人以 Cookie 持久化保存
    if (['className', 'name', 'studentId', 'teammates'].includes(fieldId)) {
      saveUserProfile({ [fieldId]: value })
    }

    reports.value = [...reports.value]
    save()
  }

  /** 更新报告标题 */
  function setTitle(reportId: string, title: string) {
    const report = reports.value.find((r) => r.id === reportId)
    if (!report) return
    report.title = title
    // 同步课题字段
    report.values['topic'] = title
    report.updatedAt = new Date().toISOString()
    reports.value = [...reports.value]
    save()
  }

  /** 插入一张表格 */
  function addTable(reportId: string, table: TableData) {
    const report = reports.value.find((r) => r.id === reportId)
    if (!report) return
    if (!Array.isArray(report.tables)) report.tables = []
    report.tables.push(cloneTable(table))
    report.updatedAt = new Date().toISOString()
    reports.value = [...reports.value]
    save()
  }

  /** 更新某张表格（整体替换） */
  function updateTable(reportId: string, table: TableData) {
    const report = reports.value.find((r) => r.id === reportId)
    if (!report || !Array.isArray(report.tables)) return
    const idx = report.tables.findIndex((t) => t.id === table.id)
    if (idx < 0) return
    report.tables[idx] = cloneTable(table)
    report.updatedAt = new Date().toISOString()
    reports.value = [...reports.value]
    save()
  }

  /** 删除某张表格 */
  function removeTable(reportId: string, tableId: string) {
    const report = reports.value.find((r) => r.id === reportId)
    if (!report || !Array.isArray(report.tables)) return
    const idx = report.tables.findIndex((t) => t.id === tableId)
    if (idx < 0) return
    report.tables.splice(idx, 1)
    report.updatedAt = new Date().toISOString()
    reports.value = [...reports.value]
    save()
  }

  /** 插入 / 更新电路图（按 id 覆盖） */
  function upsertCircuit(reportId: string, circuit: CircuitData) {
    const report = reports.value.find((r) => r.id === reportId)
    if (!report) return
    if (!Array.isArray(report.circuits)) report.circuits = []
    const idx = report.circuits.findIndex((c) => c.id === circuit.id)
    if (idx < 0) report.circuits.push(cloneCircuit(circuit))
    else report.circuits[idx] = cloneCircuit(circuit)
    report.updatedAt = new Date().toISOString()
    reports.value = [...reports.value]
    save()
  }

  /** 删除电路图 */
  function removeCircuit(reportId: string, circuitId: string) {
    const report = reports.value.find((r) => r.id === reportId)
    if (!report || !Array.isArray(report.circuits)) return
    const idx = report.circuits.findIndex((c) => c.id === circuitId)
    if (idx < 0) return
    report.circuits.splice(idx, 1)
    report.updatedAt = new Date().toISOString()
    reports.value = [...reports.value]
    save()
  }

  /** 从快照完整恢复报告数据（撤销/重做） */
  function restoreSnapshot(
    reportId: string,
    snapshot: {
      title: string
      values: Record<string, string>
      tables: TableData[]
      circuits?: CircuitData[]
    },
  ) {
    const report = reports.value.find((r) => r.id === reportId)
    if (!report) return
    report.title = snapshot.title
    report.values = { ...snapshot.values }
    report.tables = (snapshot.tables || []).map(cloneTable)
    report.circuits = (snapshot.circuits || []).map(cloneCircuit)
    report.updatedAt = new Date().toISOString()
    reports.value = [...reports.value]
    save()
  }

  /** 导入报告（JSON 数组或单个对象），返回导入数量 */
  function importReports(data: unknown): number {
    const list = Array.isArray(data) ? (data as unknown[]) : [data]
    let count = 0
    for (const item of list) {
      if (!item || typeof item !== 'object') continue
      const obj = item as Record<string, unknown>
      if (typeof obj.id !== 'string') continue
      const now = new Date().toISOString()
      const report: ReportData = {
        id: obj.id as string,
        title: typeof obj.title === 'string' ? obj.title : '导入报告',
        createdAt: typeof obj.createdAt === 'string' ? obj.createdAt : now,
        updatedAt: typeof obj.updatedAt === 'string' ? obj.updatedAt : now,
        values:
          obj.values && typeof obj.values === 'object'
            ? (obj.values as Record<string, string>)
            : {},
        tables: Array.isArray(obj.tables)
          ? (obj.tables as TableData[]).map(cloneTable)
          : [],
        circuits: Array.isArray(obj.circuits)
          ? (obj.circuits as CircuitData[])
              .filter((c) => c && Array.isArray(c.elements))
              .map(cloneCircuit)
          : [],
      }
      reports.value.unshift(report)
      count++
    }
    if (count > 0) save()
    return count
  }

  /** 导出全部报告为 JSON 字符串 */
  function exportJson(): string {
    return JSON.stringify(reports.value, null, 2)
  }

  return {
    reports,
    isEmpty,
    create,
    duplicate,
    remove,
    setFieldValue,
    setTitle,
    addTable,
    updateTable,
    removeTable,
    upsertCircuit,
    removeCircuit,
    restoreSnapshot,
    importReports,
    exportJson,
  }
})
