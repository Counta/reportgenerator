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
  /** 「实验内容」区域插入的表格（浮动层） */
  tables?: TableData[]
  /** 「实验内容」区域插入的电路图（浮动层，可再次编辑） */
  circuits?: CircuitData[]
  /** 「实验内容」区域插入的图片（浮动层，可缩放） */
  images?: ImageData[]
}

/** 电路图中的一个元件 / 导线（坐标为电路图内部单位，网格 10） */
export interface CircuitElement {
  id: string
  /** 元件类型，见 lib/circuit.ts COMPONENTS */
  kind: string
  /** 双端元件：起点；单点元件：锚点 */
  x1: number
  y1: number
  /** 双端元件：终点（单点元件与起点相同） */
  x2: number
  y2: number
  /** 单点元件旋转角度：0/90/180/270 */
  rot?: number
  /** 标签，如 R1、10kΩ */
  label?: string
}

/** 插入到报告中的电路图 */
export interface CircuitData {
  id: string
  page: number
  /** 左上角（PDF 点） */
  x: number
  y: number
  /** 显示宽度（PDF 点）；高度按内容宽高比计算，保持形状不变 */
  w: number
  elements: CircuitElement[]
}

/** 插入到报告中的图片 */
export interface ImageData {
  id: string
  page: number
  /** 左上角（PDF 点） */
  x: number
  y: number
  /** 显示宽度（PDF 点）；高度按 naturalH/naturalW 宽高比计算 */
  w: number
  /** 图片 dataURL */
  src: string
  /** 原始宽度（像素） */
  naturalW: number
  /** 原始高度（像素） */
  naturalH: number
}

/** 实验内容中插入的表格 */
export interface TableData {
  /** 唯一标识 */
  id: string
  /** 所在页（1 或 2） */
  page: number
  /** 左上角横坐标（PDF 点，相对页面左上角） */
  x: number
  /** 左上角纵坐标（PDF 点） */
  y: number
  /** 列数 */
  cols: number
  /** 行数 */
  rows: number
  /** 各列宽度（PDF 点），长度为 cols */
  colWidths: number[]
  /** 各行高度（PDF 点），长度为 rows */
  rowHeights: number[]
  /** 单元格文本：cells[行][列] */
  cells: string[][]
}

/** 表单模板：页面信息 + 字段列表 */
export interface FormTemplate {
  id: string
  name: string
  pages: number
  fields: FieldDef[]
}
