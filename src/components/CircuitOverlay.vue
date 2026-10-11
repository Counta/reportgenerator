<script setup lang="ts">
import { computed, ref } from 'vue'
import type { CircuitData } from '@/types'
import { PAGE_SIZE_PT } from '@/types'
import { circuitBBox, circuitDataUrl, circuitDisplayHeight } from '@/lib/circuit'

const props = defineProps<{
  circuit: CircuitData
  editable?: boolean
}>()

const emit = defineEmits<{
  (e: 'update', circuit: CircuitData): void
  (e: 'remove', id: string): void
  (e: 'edit', id: string): void
  (e: 'gesture-start'): void
  (e: 'gesture-end'): void
}>()

const PW = PAGE_SIZE_PT.width
const PH = PAGE_SIZE_PT.height
const MIN_W = 40

const isMoving = ref(false)
const height = computed(() => circuitDisplayHeight(props.circuit))
const src = computed(() => circuitDataUrl(props.circuit.elements))

const style = computed(() => ({
  left: `${(props.circuit.x / PW) * 100}%`,
  top: `${(props.circuit.y / PH) * 100}%`,
  width: `${(props.circuit.w / PW) * 100}%`,
  height: `${(height.value / PH) * 100}%`,
}))

function scaleOf(el: EventTarget | null): number {
  const page = el instanceof HTMLElement ? el.closest('.page-editor') : null
  return page ? page.getBoundingClientRect().width / PW : 1
}

function commit(patch: Partial<CircuitData>) {
  emit('update', {
    ...props.circuit,
    ...patch,
    elements: props.circuit.elements.map((e) => ({ ...e })),
  })
}

function track(e: PointerEvent, onMove: (dx: number, dy: number) => void) {
  e.preventDefault()
  e.stopPropagation()
  const scale = scaleOf(e.currentTarget)
  const sx = e.clientX
  const sy = e.clientY
  emit('gesture-start')
  const move = (ev: PointerEvent) => onMove((ev.clientX - sx) / scale, (ev.clientY - sy) / scale)
  const up = () => {
    isMoving.value = false
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    emit('gesture-end')
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
}

function onMoveStart(e: PointerEvent) {
  if (!props.editable || e.button !== 0) return
  isMoving.value = true
  const ox = props.circuit.x
  const oy = props.circuit.y
  const w = props.circuit.w
  const h = height.value
  track(e, (dx, dy) =>
    commit({
      x: Math.min(Math.max(ox + dx, 0), Math.max(PW - w, 0)),
      y: Math.min(Math.max(oy + dy, 0), Math.max(PH - h, 0)),
    }),
  )
}

/** 角点缩放：只改宽度，高度随宽高比变化，图形不会变形 */
function onResizeStart(e: PointerEvent) {
  if (!props.editable || e.button !== 0) return
  const ow = props.circuit.w
  const b = circuitBBox(props.circuit.elements)
  const ratio = b.h / b.w
  const maxW = Math.min(PW - props.circuit.x, (PH - props.circuit.y) / ratio)
  track(e, (dx, dy) => {
    // 取沿对角线的投影，使拖动手感自然
    const d = (dx + dy * ratio) / (1 + ratio * ratio)
    commit({ w: Math.min(Math.max(ow + d, MIN_W), maxW) })
  })
}
</script>

<template>
  <div
    class="circuit-overlay"
    :class="{ editable, 'is-moving': isMoving }"
    :style="style"
    :title="editable ? '拖动移动 · 双击编辑电路图' : undefined"
    @pointerdown="onMoveStart"
    @dblclick.stop="editable && emit('edit', circuit.id)"
  >
    <img :src="src" alt="电路图" draggable="false" />
    <template v-if="editable">
      <div class="c-actions" @pointerdown.stop>
        <button type="button" title="编辑电路图" @click.stop="emit('edit', circuit.id)">编辑</button>
        <button type="button" class="del" title="删除电路图" @click.stop="emit('remove', circuit.id)">删除</button>
      </div>
      <div class="c-resize" title="等比缩放" @pointerdown="onResizeStart" />
    </template>
  </div>
</template>

<style scoped>
.circuit-overlay {
  position: absolute;
  z-index: 6;
  box-sizing: border-box;
  background: #fff;
  user-select: none;
  touch-action: none;
}
.circuit-overlay img {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.circuit-overlay.editable {
  cursor: move;
  outline: 1px dashed transparent;
}
.circuit-overlay.editable:hover,
.circuit-overlay.is-moving {
  outline-color: rgba(37, 99, 235, 0.6);
}
.c-actions {
  position: absolute;
  top: -24px;
  right: 0;
  display: flex;
  gap: 4px;
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.15s;
}
.circuit-overlay:hover .c-actions,
.circuit-overlay:focus-within .c-actions {
  opacity: 1;
  pointer-events: auto;
}
.c-actions button {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #2563eb;
  background: #fff;
  color: #2563eb;
}
.c-actions button.del {
  border-color: #dc2626;
  color: #dc2626;
}
.c-resize {
  position: absolute;
  right: -5px;
  bottom: -5px;
  width: 10px;
  height: 10px;
  background: #2563eb;
  border: 1px solid #fff;
  border-radius: 2px;
  cursor: nwse-resize;
  opacity: 0;
}
.circuit-overlay:hover .c-resize {
  opacity: 1;
}
</style>
