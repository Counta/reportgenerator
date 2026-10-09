import type { FieldType, FormTemplate, Rect } from '@/types'

/** 顶部信息表单元格边界（来自 PDF 绘制线条） */
const TD = {
  /** 列分隔（左边界起） */
  col: {
    c1: 93.4,
    c2: 156.8,
    c3: 298.6,
    c4: 376.6,
    c5: 532.4,
    c6: 596.3,
    c7: 766.3,
  },
  /** 行分隔 */
  r1: 121.1,
  r2: 152.8,
  r3: 184.4,
} as const

/** 生成一个字段 */
function field(
  id: string,
  label: string,
  page: number,
  type: FieldType,
  rect: Rect,
) {
  return { id, label, page, type, rect }
}

/** 内容区左边距与右边距（正文区域） */
const BODY_LEFT = 91.7
const BODY_RIGHT = 766.8

export const formTemplate: FormTemplate = {
  id: 'tianjin-normal-lab-report',
  name: '天津师范大学 实验报告',
  pages: 2,
  fields: [
    // ============ 报告前缀：模拟电路 / 数字电路 二选一 ============
    field('courseType', '课程类型', 1, 'radio', {
      x: 340,
      y: 86,
      w: 180,
      h: 28,
    }),

    // ============ 第 1 页 顶部信息表 ============
    // 第一行：班级 | 姓名 | 学号
    field('className', '班级', 1, 'input', {
      x: TD.col.c2 + 4,
      y: TD.r1 + 4,
      w: TD.col.c3 - TD.col.c2 - 8,
      h: TD.r2 - TD.r1 - 8,
    }),
    field('name', '姓名', 1, 'input', {
      x: TD.col.c4 + 4,
      y: TD.r1 + 4,
      w: TD.col.c5 - TD.col.c4 - 8,
      h: TD.r2 - TD.r1 - 8,
    }),
    field('studentId', '学号', 1, 'input', {
      x: TD.col.c6 + 4,
      y: TD.r1 + 4,
      w: TD.col.c7 - TD.col.c6 - 8,
      h: TD.r2 - TD.r1 - 8,
    }),
    // 第二行：日期 | 同组人 | 成绩
    field('date', '日期', 1, 'input', {
      x: TD.col.c2 + 4,
      y: TD.r2 + 4,
      w: TD.col.c3 - TD.col.c2 - 8,
      h: TD.r3 - TD.r2 - 8,
    }),
    field('teammates', '同组人', 1, 'input', {
      x: TD.col.c4 + 4,
      y: TD.r2 + 4,
      w: TD.col.c5 - TD.col.c4 - 8,
      h: TD.r3 - TD.r2 - 8,
    }),
    field('score', '成绩', 1, 'input', {
      x: TD.col.c6 + 4,
      y: TD.r2 + 4,
      w: TD.col.c7 - TD.col.c6 - 8,
      h: TD.r3 - TD.r2 - 8,
    }),

    // ============ 课题（横线上） ============
    field('topic', '课题', 1, 'input', {
      x: 252,
      y: 199,
      w: 358,
      h: 28,
    }),

    // ============ 实验目的 ============
    field('purpose', '实验目的', 1, 'textarea', {
      x: BODY_LEFT,
      y: 278,
      w: BODY_RIGHT - BODY_LEFT,
      h: 112,
    }),

    // ============ 实验器材 ============
    field('equipment', '实验器材', 1, 'textarea', {
      x: BODY_LEFT,
      y: 418,
      w: BODY_RIGHT - BODY_LEFT,
      h: 112,
    }),

    // ============ 实验内容 ============
    field('content', '实验内容', 1, 'textarea', {
      x: BODY_LEFT,
      y: 558,
      w: BODY_RIGHT - BODY_LEFT,
      h: 545,
    }),

    // ============ 第 2 页 实验内容接续区（问题讨论之上） ============
    field('contentContinuation', '实验内容（接续）', 2, 'textarea', {
      x: BODY_LEFT,
      y: 98,
      w: BODY_RIGHT - BODY_LEFT,
      h: 680,
    }),

    // ============ 第 2 页 问题讨论 ============
    field('discussion', '问题讨论', 2, 'textarea', {
      x: BODY_LEFT,
      y: 822,
      w: BODY_RIGHT - BODY_LEFT,
      h: 292,
    }),
  ],
}
