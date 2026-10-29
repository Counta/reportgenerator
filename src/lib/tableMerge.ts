import type { TableData, TableMerge } from '@/types'

/** 单元格矩形区域（行列下标均含端点） */
export interface CellRange {
  r1: number
  c1: number
  r2: number
  c2: number
}

/** 表格中一个可见单元格（普通单元格或合并区域的左上角） */
export interface VisibleCell {
  r: number
  c: number
  rowSpan: number
  colSpan: number
}

/** 由两个对角单元格得到规范化区域 */
export function rangeFrom(
  a: { r: number; c: number },
  b: { r: number; c: number },
): CellRange {
  return {
    r1: Math.min(a.r, b.r),
    c1: Math.min(a.c, b.c),
    r2: Math.max(a.r, b.r),
    c2: Math.max(a.c, b.c),
  }
}

function mergeRange(m: TableMerge): CellRange {
  return { r1: m.r, c1: m.c, r2: m.r + m.rowSpan - 1, c2: m.c + m.colSpan - 1 }
}

function intersects(a: CellRange, b: CellRange): boolean {
  return a.r1 <= b.r2 && b.r1 <= a.r2 && a.c1 <= b.c2 && b.c1 <= a.c2
}

/**
 * 返回表格中有效的合并区域：丢弃越界、1×1、与前面区域重叠的条目，
 * 避免本地存储中的异常数据破坏渲染。
 */
export function getMerges(table: TableData): TableMerge[] {
  const out: TableMerge[] = []
  for (const m of table.merges ?? []) {
    if (![m.r, m.c, m.rowSpan, m.colSpan].every(Number.isInteger)) continue
    if (m.r < 0 || m.c < 0 || m.rowSpan < 1 || m.colSpan < 1) continue
    if (m.r + m.rowSpan > table.rows || m.c + m.colSpan > table.cols) continue
    if (m.rowSpan === 1 && m.colSpan === 1) continue
    const range = mergeRange(m)
    if (out.some((o) => intersects(mergeRange(o), range))) continue
    out.push({ r: m.r, c: m.c, rowSpan: m.rowSpan, colSpan: m.colSpan })
  }
  return out
}

/** 查找覆盖 (r, c) 的合并区域 */
export function findMerge(
  merges: TableMerge[],
  r: number,
  c: number,
): TableMerge | undefined {
  return merges.find(
    (m) => r >= m.r && r < m.r + m.rowSpan && c >= m.c && c < m.c + m.colSpan,
  )
}

/** 按行优先顺序列出所有可见单元格（被合并覆盖的单元格不出现） */
export function visibleCells(table: TableData): VisibleCell[] {
  const merges = getMerges(table)
  const list: VisibleCell[] = []
  for (let r = 0; r < table.rows; r++) {
    for (let c = 0; c < table.cols; c++) {
      const m = findMerge(merges, r, c)
      if (!m) {
        list.push({ r, c, rowSpan: 1, colSpan: 1 })
      } else if (m.r === r && m.c === c) {
        list.push({ r, c, rowSpan: m.rowSpan, colSpan: m.colSpan })
      }
    }
  }
  return list
}

/** 扩展区域，使其完整包含所有与之相交的合并区域 */
export function expandRange(merges: TableMerge[], range: CellRange): CellRange {
  const out = { ...range }
  let changed = true
  while (changed) {
    changed = false
    for (const m of merges) {
      const mr = mergeRange(m)
      if (!intersects(mr, out)) continue
      if (mr.r1 < out.r1) { out.r1 = mr.r1; changed = true }
      if (mr.c1 < out.c1) { out.c1 = mr.c1; changed = true }
      if (mr.r2 > out.r2) { out.r2 = mr.r2; changed = true }
      if (mr.c2 > out.c2) { out.c2 = mr.c2; changed = true }
    }
  }
  return out
}

/** 区域是否与任何合并区域相交 */
export function rangeHasMerge(merges: TableMerge[], range: CellRange): boolean {
  return merges.some((m) => intersects(mergeRange(m), range))
}

/**
 * 合并区域内的单元格。区域内所有非空文本按行优先顺序以换行拼接，
 * 放入左上角单元格，其余单元格清空，避免丢失内容。
 */
export function mergeCells(table: TableData, range: CellRange): TableData {
  const merges = getMerges(table)
  const target = expandRange(merges, range)
  if (target.r1 === target.r2 && target.c1 === target.c2) return table

  const cells = Array.from({ length: table.rows }, (_, r) => {
    const row = [...(table.cells[r] || [])]
    while (row.length < table.cols) row.push('')
    return row
  })
  const texts: string[] = []
  for (let r = target.r1; r <= target.r2; r++) {
    for (let c = target.c1; c <= target.c2; c++) {
      if (cells[r][c].trim() !== '') texts.push(cells[r][c])
      cells[r][c] = ''
    }
  }
  cells[target.r1][target.c1] = texts.join('\n')

  return {
    ...table,
    cells,
    merges: [
      ...merges.filter((m) => !intersects(mergeRange(m), target)),
      {
        r: target.r1,
        c: target.c1,
        rowSpan: target.r2 - target.r1 + 1,
        colSpan: target.c2 - target.c1 + 1,
      },
    ],
  }
}

/** 取消与区域相交的所有合并（文本保留在左上角单元格） */
export function unmergeCells(table: TableData, range: CellRange): TableData {
  return {
    ...table,
    merges: getMerges(table).filter((m) => !intersects(mergeRange(m), range)),
  }
}

/**
 * 在下标 idx 处插入一行（axis='row'）或一列（axis='col'）后，调整合并区域：
 * 位于插入点之后的区域整体后移；插入点落在区域内部时区域扩展一格。
 */
export function shiftMergesForInsert(
  table: TableData,
  axis: 'row' | 'col',
  idx: number,
): TableMerge[] {
  return getMerges(table).map((m) => {
    const start = axis === 'row' ? m.r : m.c
    const span = axis === 'row' ? m.rowSpan : m.colSpan
    if (start >= idx) {
      return axis === 'row' ? { ...m, r: m.r + 1 } : { ...m, c: m.c + 1 }
    }
    if (idx < start + span) {
      return axis === 'row'
        ? { ...m, rowSpan: m.rowSpan + 1 }
        : { ...m, colSpan: m.colSpan + 1 }
    }
    return { ...m }
  })
}

/**
 * 删除最后一行（axis='row'）或最后一列（axis='col'）后，调整合并区域：
 * 延伸到被删行/列的区域收缩一格；左上角位于被删行/列的区域随之删除。
 */
export function shrinkMergesForRemoveLast(
  table: TableData,
  axis: 'row' | 'col',
): TableMerge[] {
  const last = (axis === 'row' ? table.rows : table.cols) - 1
  const out: TableMerge[] = []
  for (const m of getMerges(table)) {
    const start = axis === 'row' ? m.r : m.c
    const span = axis === 'row' ? m.rowSpan : m.colSpan
    if (start >= last) continue
    const next =
      start + span - 1 >= last
        ? axis === 'row'
          ? { ...m, rowSpan: m.rowSpan - 1 }
          : { ...m, colSpan: m.colSpan - 1 }
        : { ...m }
    if (next.rowSpan > 1 || next.colSpan > 1) out.push(next)
  }
  return out
}

/**
 * 表格中当前可供合并 / 取消合并的区域，由表格浮层上报给顶栏。
 * action：多选时为 'merge'；未多选且焦点位于合并单元格内时为 'unmerge'。
 */
export interface MergeTarget {
  tableId: string
  range: CellRange
  action: 'merge' | 'unmerge'
}
