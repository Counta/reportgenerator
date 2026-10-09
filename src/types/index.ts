/**
 * 核心数据模型
 *
 * 坐标均使用 PDF 点（points，1/72 英寸）表示。
 * 页面大小为 A3：841.92 × 1190.52 pt。
 * 前端渲染时根据实际背景图尺寸换算比例。
 */

/** 页面尺寸（PDF 点） */
export const PAGE_SIZE_PT = { width: 841.92, height: 1190.52 } as const

/** 可填写字段的类型 */
export type FieldType = 'input' | 'textarea' | 'radio'

/** 矩形区域（PDF 点，左上角为原点） */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

/** 表单字段定义 —— 描述背景上的一个可填写区域 */
export interface FieldDef {
  /** 唯一标识，用于存取数据 */
  id: string
  /** 显示标签 */
  label: string
  /** 所在页（1 或 2） */
  page: number
  /** 输入类型：input 单行 / textarea 多行 */
  type: FieldType
  /** 可填写区域的矩形边界（含内边距前的单元格边界） */
  rect: Rect
}

/** 一个实验报告的数据（按字段 id 存储用户填写内容） */
export interface ReportData {
  id: string
  /** 报告名称 / 标题 */
  title: string
  /** 创建时间（ISO） */
  createdAt: string
  /** 最后修改时间（ISO） */
  updatedAt: string
  /** 字段值：fieldId -> 文本 */
  values: Record<string, string>
}

/** 表单模板：页面信息 + 字段列表 */
export interface FormTemplate {
  id: string
  name: string
  pages: number
  fields: FieldDef[]
}
