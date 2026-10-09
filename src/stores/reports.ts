import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import type { ReportData } from '@/types'
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
    importReports,
    exportJson,
  }
})
