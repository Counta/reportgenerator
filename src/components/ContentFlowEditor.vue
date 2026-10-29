<script lang="ts">
import type { PositionedLine } from '@/lib/textLayout'

/**
 * 同一 group 内的编辑器共用一份文本与一个光标（「实验内容」两页为一组，
 * 其余多行框各自一组）。编辑后光标可能移到同组的另一页，因此在模块级登记
 * 各编辑器，排版刷新后由持有目标行的编辑器放置光标。
 */
interface FlowEditorHandle {
  page: number
  lines: () => PositionedLine[]
  placeCaret: (line: PositionedLine | null, offset: number) => void
  host: () => HTMLElement | null
  source: () => string
  /** 选区与本编辑器相交部分的文本偏移（端点在编辑器外时截到首 / 末行） */
  rangeOffsets: (r: Range) => [number, number] | null
}

interface FlowGroup {
  handles: Set<FlowEditorHandle>
  pendingCaret: number | null
  resolveScheduled: boolean
}

const groups = new Map<string, FlowGroup>()

function groupOf(name: string): FlowGroup {
  let g = groups.get(name)
  if (!g) {
    g = { handles: new Set(), pendingCaret: null, resolveScheduled: false }
    groups.set(name, g)
  }
  return g
}

function allLines(g: FlowGroup): { handle: FlowEditorHandle; line: PositionedLine }[] {
  return [...g.handles]
    .sort((a, b) => a.page - b.page)
    .flatMap((handle) => handle.lines().map((line) => ({ handle, line })))
}

/** 偏移所在行：软换行处同一偏移同时是上一行末尾和下一行开头，取下一行 */
function locate(g: FlowGroup, offset: number) {
  const all = allLines(g)
  for (let i = all.length - 1; i >= 0; i--) {
    const { line } = all[i]!
    if (line.start <= offset && offset <= line.end) return all[i]!
  }
  // 位于行间被跳过的字符（如换行符）或超出排版范围：落到之前最近的一行
  for (let i = all.length - 1; i >= 0; i--) {
    if (all[i]!.line.start <= offset) return all[i]!
  }
  return all[0] ?? null
}

function resolvePendingCaret(g: FlowGroup) {
  g.resolveScheduled = false
  if (g.pendingCaret === null) return
  const offset = g.pendingCaret
  g.pendingCaret = null
  const hit = locate(g, offset)
  if (hit) hit.handle.placeCaret(hit.line, Math.min(Math.max(offset, hit.line.start), hit.line.end))
}

function scheduleResolve(g: FlowGroup) {
  if (g.resolveScheduled) return
  g.resolveScheduled = true
  queueMicrotask(() => resolvePendingCaret(g))
}

/**
 * 选区对应的纯文本：直接截取原文，不读 DOM。
 * 行是按排版坐标绝对定位的，浏览器默认复制会带上定位样式，并在每个排版行
 * （包括因避让表格 / 图片而折行的位置）插入换行；粘贴后这些折行会固化进正文。
 * 这里只输出原文本身，避让在粘贴后由排版实时重新计算。
 */
export function flowSelectionText(sel: Selection | null): string | null {
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null
  const r = sel.getRangeAt(0)
  const parts: { host: HTMLElement; text: string }[] = []
  for (const g of groups.values()) {
    let a = Infinity
    let b = -Infinity
    let first: HTMLElement | null = null
    let source = ''
    for (const h of g.handles) {
      const host = h.host()
      if (!host || !r.intersectsNode(host)) continue
      const o = h.rangeOffsets(r)
      if (!o) continue
      a = Math.min(a, o[0])
      b = Math.max(b, o[1])
      source = h.source()
      if (!first || first.compareDocumentPosition(host) & Node.DOCUMENT_POSITION_PRECEDING) first = host
    }
    if (first && a < b) parts.push({ host: first, text: source.slice(a, b) })
  }
  if (parts.length === 0) return null
  parts.sort((x, y) => (x.host.compareDocumentPosition(y.host) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1))
  return parts.map((p) => p.text).join('\n')
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

/** 写入剪贴板：纯文本 + 无样式 HTML（避免富文本目标拿到定位样式） */
export function writeFlowClipboard(e: ClipboardEvent, text: string) {
  e.preventDefault()
  e.clipboardData?.setData('text/plain', text)
  e.clipboardData?.setData('text/html', text.split('\n').map(escapeHtml).join('<br>'))
}

let copyListenerInstalled = false

/** 文档级复制：选区从编辑器外开始或跨越多个框时也走原文 */
function installCopyListener() {
  if (copyListenerInstalled) return
  copyListenerInstalled = true
  document.addEventListener(
    'copy',
    (e) => {
      if (e.defaultPrevented) return
      const text = flowSelectionText(window.getSelection())
      if (text !== null) writeFlowClipboard(e, text)
    },
    true,
  )
}
</script>

<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { PAGE_SIZE_PT } from '@/types'
import { CONTENT_FONT_FAMILY, graphemeStarts, normalizeContentText } from '@/lib/textLayout'
import { clipboardImages } from '@/lib/image'

const props = defineProps<{
  /** 共用文本与光标的编辑器分组 */
  group: string
  page: number
  /** 编辑器左上角（PDF 点），行坐标相对它定位 */
  origin: { x: number; y: number }
  /** 本编辑器的排版行（来自 lib/textLayout，与导出相同） */
  lines: PositionedLine[]
  /** 完整文本（规范化后），行的 start/end 以此为准 */
  source: string
  editable?: boolean
  /** 文本为空时显示的提示 */
  placeholder?: string
  /** 显示可填写区域的浅色底与悬停边框 */
  framed?: boolean
}>()

const emit = defineEmits<{
  (e: 'change', text: string): void
  (e: 'paste-images', files: File[]): void
}>()

const PW = PAGE_SIZE_PT.width
const hostRef = ref<HTMLDivElement | null>(null)
const group = groupOf(props.group)
let composing = false
let compositionRange: [number, number] | null = null
let renderDirty = false

/** PDF 点 -> 页面相对长度（.page-editor 是 inline-size 容器） */
function pt(n: number): string {
  return `calc(${n} * 100cqw / ${PW})`
}

// ================= 渲染 =================
function render() {
  const host = hostRef.value
  if (!host) return
  if (composing) {
    renderDirty = true
    return
  }
  renderDirty = false
  const saved = document.activeElement === host && group.pendingCaret === null ? currentRange() : null
  const frag = document.createDocumentFragment()
  for (const line of props.lines) {
    const span = document.createElement('span')
    span.className = 'flow-line'
    span.dataset.start = String(line.start)
    span.dataset.end = String(line.end)
    span.style.left = pt(line.x - props.origin.x)
    span.style.top = pt(line.y - props.origin.y)
    span.style.fontSize = pt(line.fontSize)
    span.style.height = pt(line.fontSize)
    span.textContent = props.source.slice(line.start, line.end)
    frag.appendChild(span)
  }
  host.replaceChildren(frag)
  if (saved) setSelection(saved[0], saved[1])
}

// ================= DOM 位置 <-> 正文偏移 =================
function lineSpans(): HTMLElement[] {
  const host = hostRef.value
  return host ? [...host.querySelectorAll<HTMLElement>(':scope > .flow-line')] : []
}

function spanRange(span: HTMLElement): [number, number] {
  return [Number(span.dataset.start), Number(span.dataset.end)]
}

function pointToOffset(node: Node, off: number): number {
  const host = hostRef.value!
  if (node === host) {
    const spans = lineSpans()
    if (spans.length === 0) return props.source.length
    if (off < spans.length) return spanRange(spans[off]!)[0]
    return spanRange(spans[spans.length - 1]!)[1]
  }
  const el = node instanceof Element ? node : node.parentElement
  const span = el?.closest<HTMLElement>('.flow-line')
  if (!span || span.parentNode !== host) return props.source.length
  const [start, end] = spanRange(span)
  if (node.nodeType === Node.TEXT_NODE) return Math.min(start + off, end)
  return off > 0 ? end : start
}

function currentRange(): [number, number] | null {
  const host = hostRef.value
  const sel = window.getSelection()
  if (!host || !sel || sel.rangeCount === 0) return null
  const r = sel.getRangeAt(0)
  if (!host.contains(r.startContainer) || !host.contains(r.endContainer)) return null
  const a = pointToOffset(r.startContainer, r.startOffset)
  const b = pointToOffset(r.endContainer, r.endOffset)
  return a <= b ? [a, b] : [b, a]
}

function rangeOffsets(r: Range): [number, number] | null {
  const host = hostRef.value
  const spans = lineSpans()
  if (!host || spans.length === 0) return null
  const first = spanRange(spans[0]!)[0]
  const last = spanRange(spans[spans.length - 1]!)[1]
  const a = host.contains(r.startContainer) ? pointToOffset(r.startContainer, r.startOffset) : first
  const b = host.contains(r.endContainer) ? pointToOffset(r.endContainer, r.endOffset) : last
  return a <= b ? [a, b] : [b, a]
}

/** 在本页行中查找偏移对应的 DOM 位置 */
function offsetToPoint(offset: number, line: PositionedLine | null = null): [Node, number] | null {
  const spans = lineSpans()
  let span: HTMLElement | undefined
  if (line) {
    span = spans.find((s) => Number(s.dataset.start) === line.start && Number(s.dataset.end) === line.end)
  }
  if (!span) {
    for (let i = spans.length - 1; i >= 0; i--) {
      const [s, e] = spanRange(spans[i]!)
      if (s <= offset && offset <= e) {
        span = spans[i]
        break
      }
    }
  }
  if (!span) return null
  const [start, end] = spanRange(span)
  const text = span.firstChild
  if (!text) return [span, 0]
  return [text, Math.min(Math.max(offset, start), end) - start]
}

function setSelection(a: number, b: number) {
  const pa = offsetToPoint(a)
  const pb = a === b ? pa : offsetToPoint(b)
  const sel = window.getSelection()
  if (!pa || !pb || !sel) return
  const r = document.createRange()
  r.setStart(pa[0], pa[1])
  r.setEnd(pb[0], pb[1])
  sel.removeAllRanges()
  sel.addRange(r)
}

function placeCaret(line: PositionedLine | null, offset: number) {
  const host = hostRef.value
  if (!host) return
  const wasActive = document.activeElement === host
  if (!wasActive) host.focus({ preventScroll: true })
  const p = offsetToPoint(offset, line)
  const sel = window.getSelection()
  if (!sel) return
  const r = document.createRange()
  if (p) r.setStart(p[0], p[1])
  else r.setStart(host, 0)
  r.collapse(true)
  sel.removeAllRanges()
  sel.addRange(r)
  if (!wasActive) {
    const target = p ? (p[0] instanceof Element ? p[0] : p[0].parentElement) : host
    target?.scrollIntoView({ block: 'nearest' })
  }
}

// ================= 编辑：所有修改都作用于正文字符串，然后重新排版 =================
function apply(a: number, b: number, text: string, inputType: string) {
  const src = props.source
  const ins = normalizeContentText(text)
  const next = src.slice(0, a) + ins + src.slice(b)
  group.pendingCaret = a + ins.length
  if (next === src) {
    render()
    scheduleResolve(group)
    return
  }
  emit('change', next)
  // 通知外部监听者（如测试脚本）发生了一次输入；本组件自身不处理 input 事件
  hostRef.value?.dispatchEvent(new InputEvent('input', { bubbles: true, inputType }))
}

function prevGraphemeOffset(o: number): number {
  if (o <= 0) return 0
  const from = Math.max(0, o - 16)
  const g = graphemeStarts(props.source.slice(from, o))
  return from + (g.length ? g[g.length - 1]! : 0)
}

function nextGraphemeOffset(o: number): number {
  const src = props.source
  if (o >= src.length) return src.length
  const g = graphemeStarts(src.slice(o, Math.min(src.length, o + 16)))
  return o + (g.length > 1 ? g[1]! : Math.min(16, src.length - o))
}

function targetOffsets(e: InputEvent): [number, number] | null {
  const host = hostRef.value
  const r = e.getTargetRanges?.()[0]
  if (!host || !r || !host.contains(r.startContainer) || !host.contains(r.endContainer)) return null
  const a = pointToOffset(r.startContainer, r.startOffset)
  const b = pointToOffset(r.endContainer, r.endOffset)
  return a <= b ? [a, b] : [b, a]
}

function onBeforeInput(e: InputEvent) {
  if (!props.editable) {
    e.preventDefault()
    return
  }
  // 输入法组字过程不可取消，交给浏览器显示，结束时再统一写回正文
  if (composing || e.inputType === 'insertCompositionText') return
  e.preventDefault()
  const range = currentRange()
  if (!range) return
  let [a, b] = range
  const t = e.inputType

  if (t === 'insertText' || t === 'insertReplacementText' || t === 'insertFromYank') {
    const text = e.data ?? e.dataTransfer?.getData('text/plain') ?? ''
    if (t === 'insertReplacementText') {
      const tr = targetOffsets(e)
      if (tr) [a, b] = tr
    }
    apply(a, b, text, t)
    return
  }
  if (t === 'insertParagraph' || t === 'insertLineBreak') {
    apply(a, b, '\n', t)
    return
  }
  if (t.startsWith('delete') && t !== 'deleteByDrag') {
    if (a === b) {
      const tr = targetOffsets(e)
      if (tr && tr[0] < tr[1]) [a, b] = tr
      else if (t.includes('Backward')) a = prevGraphemeOffset(a)
      else b = nextGraphemeOffset(b)
    }
    if (a < b) apply(a, b, '', t)
  }
  // 其余类型（格式化、拖放、浏览器撤销等）一律忽略；撤销由应用自身处理
}

function onCompositionStart() {
  composing = true
  compositionRange = currentRange()
}

function onCompositionEnd(e: CompositionEvent) {
  composing = false
  const r = compositionRange
  compositionRange = null
  if (!r || !props.editable) {
    render()
    return
  }
  apply(r[0], r[1], e.data || '', 'insertFromComposition')
  if (renderDirty) render()
}

function onPaste(e: ClipboardEvent) {
  e.preventDefault()
  if (!props.editable) return
  const files = clipboardImages(e.clipboardData)
  if (files.length) {
    emit('paste-images', files)
    return
  }
  const text = e.clipboardData?.getData('text/plain') || ''
  const range = currentRange()
  if (!text || !range) return
  apply(range[0], range[1], text, 'insertFromPaste')
}

/** 剪切：剪贴板写入原文，再从正文删除（复制由文档级监听统一处理） */
function onCut(e: ClipboardEvent) {
  const range = currentRange()
  if (!range || range[0] === range[1]) return
  writeFlowClipboard(e, props.source.slice(range[0], range[1]))
  if (props.editable) apply(range[0], range[1], '', 'deleteByCut')
}

// ================= 光标移动 =================
let measureCtx: CanvasRenderingContext2D | null = null

/** 与排版相同字体下，行首到偏移处的宽度（PDF 点） */
function advance(line: PositionedLine, offset: number): number {
  measureCtx ??= document.createElement('canvas').getContext('2d')
  if (!measureCtx) return 0
  measureCtx.font = `${line.fontSize}px ${CONTENT_FONT_FAMILY}`
  return measureCtx.measureText(props.source.slice(line.start, offset)).width
}

/** 行内最接近横坐标 x（PDF 点）的字素边界 */
function offsetAtX(line: PositionedLine, x: number): number {
  const text = props.source.slice(line.start, line.end)
  const bounds = [...graphemeStarts(text), text.length]
  let best = line.start
  let bestDist = Infinity
  for (const b of bounds) {
    const d = Math.abs(line.x + advance(line, line.start + b) - x)
    if (d < bestDist) {
      bestDist = d
      best = line.start + b
    }
  }
  return best
}

function sameBand(a: PositionedLine, b: PositionedLine) {
  return a.page === b.page && Math.abs(a.y - b.y) < 0.01
}

function moveVertical(dir: -1 | 1, offset: number) {
  const all = allLines(group)
  const hit = locate(group, offset)
  if (!hit) return
  const cur = hit.line
  const x = cur.x + advance(cur, offset)
  const idx = all.findIndex((l) => l.line === cur)
  // 相邻行带：向上找前一个不同行带，向下找后一个
  let j = idx + dir
  while (j >= 0 && j < all.length && sameBand(all[j]!.line, cur)) j += dir
  if (j < 0 || j >= all.length) {
    const edge = dir < 0 ? all[0]! : all[all.length - 1]!
    edge.handle.placeCaret(edge.line, dir < 0 ? edge.line.start : edge.line.end)
    return
  }
  const band = all.filter((l) => sameBand(l.line, all[j]!.line))
  let target = band[0]!
  let bestDist = Infinity
  for (const c of band) {
    const left = c.line.x
    const right = c.line.x + c.line.width
    const d = x < left ? left - x : x > right ? x - right : 0
    if (d < bestDist) {
      bestDist = d
      target = c
    }
  }
  target.handle.placeCaret(target.line, offsetAtX(target.line, x))
}

function onKeyDown(e: KeyboardEvent) {
  if (e.isComposing || e.keyCode === 229) return
  if (e.shiftKey || e.altKey || e.ctrlKey || e.metaKey) return
  const range = currentRange()
  if (!range) return
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    e.preventDefault()
    moveVertical(e.key === 'ArrowUp' ? -1 : 1, e.key === 'ArrowUp' ? range[0] : range[1])
    return
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    e.preventDefault()
    const left = e.key === 'ArrowLeft'
    let o: number
    if (range[0] !== range[1]) o = left ? range[0] : range[1]
    else o = left ? prevGraphemeOffset(range[0]) : nextGraphemeOffset(range[1])
    group.pendingCaret = o
    resolvePendingCaret(group)
  }
}

/** 点击行外空白处：把光标放到最近一行的最近位置 */
function onMouseDown(e: MouseEvent) {
  const host = hostRef.value
  if (!props.editable || e.button !== 0 || !host || e.target !== host) return
  e.preventDefault()
  const pageEl = host.closest('.page-editor')
  if (!pageEl) return
  const rect = pageEl.getBoundingClientRect()
  const scale = rect.width / PW
  const x = (e.clientX - rect.left) / scale
  const y = (e.clientY - rect.top) / scale
  if (props.lines.length === 0) {
    // 本页没有正文：光标放到正文末尾（可能在另一页）
    group.pendingCaret = props.source.length
    resolvePendingCaret(group)
    return
  }
  let best = props.lines[0]!
  let bestDist = Infinity
  for (const line of props.lines) {
    const dy = Math.abs(y - (line.y + line.lineHeight / 2))
    const dx = x < line.x ? line.x - x : x > line.x + line.width ? x - line.x - line.width : 0
    const d = dy * 1000 + dx
    if (d < bestDist) {
      bestDist = d
      best = line
    }
  }
  placeCaret(best, offsetAtX(best, x))
}

const handle: FlowEditorHandle = {
  page: props.page,
  lines: () => props.lines,
  placeCaret,
  host: () => hostRef.value,
  source: () => props.source,
  rangeOffsets,
}

onMounted(() => {
  installCopyListener()
  group.handles.add(handle)
  render()
})

onBeforeUnmount(() => {
  group.handles.delete(handle)
})

watch(
  () => [props.lines, props.source] as const,
  () => {
    render()
    scheduleResolve(group)
  },
  { flush: 'post' },
)
</script>

<template>
  <div
    ref="hostRef"
    class="unified-content-editor"
    :class="{ framed, 'is-empty': !source }"
    :data-placeholder="editable ? placeholder : undefined"
    :contenteditable="editable ? 'true' : 'false'"
    spellcheck="false"
    :style="{ fontFamily: CONTENT_FONT_FAMILY }"
    @beforeinput="onBeforeInput"
    @compositionstart="onCompositionStart"
    @compositionend="onCompositionEnd"
    @paste="onPaste"
    @cut="onCut"
    @keydown="onKeyDown"
    @mousedown="onMouseDown"
    @dragstart.prevent
    @drop.prevent
  />
</template>

<style scoped>
.unified-content-editor {
  position: absolute;
  inset: 0;
  outline: none;
  color: #000;
  caret-color: #000;
  cursor: text;
  user-select: text;
  white-space: pre;
}

/* 每一行按共享排版结果绝对定位：行框顶端 = 排版 y，与导出的 textBaseline: top 一致；
   字号与高度由 render() 按行写入 */
.unified-content-editor :deep(.flow-line) {
  position: absolute;
  display: block;
  min-width: 1px;
  line-height: 1;
  white-space: pre;
}

.unified-content-editor.framed {
  border-radius: 4px;
  background: rgba(37, 99, 235, 0.04);
  box-shadow: inset 0 0 0 1px transparent;
  transition: background 0.15s, box-shadow 0.15s;
}
.unified-content-editor.framed:hover,
.unified-content-editor.framed:focus {
  background: rgba(37, 99, 235, 0.08);
  box-shadow: inset 0 0 0 1px rgba(37, 99, 235, 0.45);
}
.unified-content-editor.is-empty[data-placeholder]::before {
  content: attr(data-placeholder);
  position: absolute;
  left: 0;
  top: 0;
  font-size: calc(16 * 100cqw / 841.92);
  line-height: 1;
  color: #9ca3af;
  pointer-events: none;
}
</style>
