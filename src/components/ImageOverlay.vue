<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ImageData } from '@/types'
import { PAGE_SIZE_PT } from '@/types'
import { imageDisplayHeight } from '@/lib/image'

const props = defineProps<{
  image: ImageData
  editable?: boolean
}>()

const emit = defineEmits<{
  (e: 'update', image: ImageData): void
  (e: 'remove', id: string): void
  (e: 'edit', id: string): void
  (e: 'gesture-start'): void
  (e: 'gesture-end'): void
}>()

const PW = PAGE_SIZE_PT.width
const PH = PAGE_SIZE_PT.height
const MIN_W = 40

const isMoving = ref(false)
const height = computed(() => imageDisplayHeight(props.image))

const style = computed(() => ({
  left: `${(props.image.x / PW) * 100}%`,
  top: `${(props.image.y / PH) * 100}%`,
  width: `${(props.image.w / PW) * 100}%`,
  height: `${(height.value / PH) * 100}%`,
}))

function scaleOf(el: EventTarget | null): number {
  const page = el instanceof HTMLElement ? el.closest('.page-editor') : null
  return page ? page.getBoundingClientRect().width / PW : 1
}

function commit(patch: Partial<ImageData>) {
  emit('update', { ...props.image, ...patch })
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
    window.removeEventListener('pointercancel', up)
    emit('gesture-end')
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('pointercancel', up)
}

function onMoveStart(e: PointerEvent) {
  if (!props.editable || e.button !== 0) return
  isMoving.value = true
  const ox = props.image.x
  const oy = props.image.y
  const w = props.image.w
  const h = height.value
  track(e, (dx, dy) =>
    commit({
      x: Math.min(Math.max(ox + dx, 0), Math.max(PW - w, 0)),
      y: Math.min(Math.max(oy + dy, 0), Math.max(PH - h, 0)),
    }),
  )
}

/** 角点缩放：只改宽度，高度随宽高比变化，图片不会变形 */
function onResizeStart(e: PointerEvent) {
  if (!props.editable || e.button !== 0) return
  const ow = props.image.w
  const ratio = height.value / props.image.w
  const maxW = Math.min(PW - props.image.x, (PH - props.image.y) / ratio)
  track(e, (dx, dy) => {
    // 取沿对角线的投影，使拖动手感自然
    const d = (dx + dy * ratio) / (1 + ratio * ratio)
    commit({ w: Math.min(Math.max(ow + d, MIN_W), maxW) })
  })
}
</script>

<template>
  <div
    class="image-overlay"
    :class="{ editable, 'is-moving': isMoving }"
    :style="style"
    :title="editable ? (image.plot ? '拖动移动 · 双击编辑图表' : '拖动移动 · 双击更换图片') : undefined"
    @pointerdown="onMoveStart"
    @dblclick.stop="editable && emit('edit', image.id)"
  >
    <img :src="image.src" :alt="image.plot ? image.plot.title || '图表' : '插入图片'" draggable="false" />
    <template v-if="editable">
      <div class="i-actions" @pointerdown.stop>
        <button type="button" :title="image.plot ? '编辑图表' : '更换图片'" @click.stop="emit('edit', image.id)">{{ image.plot ? '编辑图表' : '更换' }}</button>
        <button type="button" class="del" title="删除图片" @click.stop="emit('remove', image.id)">删除</button>
      </div>
      <div class="i-resize" title="等比缩放" @pointerdown="onResizeStart" />
    </template>
  </div>
</template>

<style scoped>
.image-overlay {
  position: absolute;
  z-index: 6;
  box-sizing: border-box;
  background: #fff;
  user-select: none;
  touch-action: none;
}
.image-overlay img {
  display: block;
  width: 100%;
  height: 100%;
  pointer-events: none;
}
.image-overlay.editable {
  cursor: move;
  outline: 1px dashed transparent;
}
.image-overlay.editable:hover,
.image-overlay.is-moving {
  outline-color: rgba(37, 99, 235, 0.6);
}
.i-actions {
  position: absolute;
  /* Bottom padding reaches the image edge, so moving up to the buttons never leaves :hover. */
  top: -28px;
  right: 0;
  padding: 4px 0 6px 12px;
  display: flex;
  gap: 4px;
  opacity: 0;
  visibility: hidden;
  /* Hide after a short delay; visibility flips last so buttons stay clickable while fading. */
  transition: opacity 0.15s ease 0.35s, visibility 0s linear 0.5s;
}
.image-overlay:hover .i-actions,
.image-overlay:focus-within .i-actions,
.image-overlay.is-moving .i-actions {
  opacity: 1;
  visibility: visible;
  transition-delay: 0s;
}
.i-actions button {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  border: 1px solid #2563eb;
  background: #fff;
  color: #2563eb;
}
.i-actions button.del {
  border-color: #dc2626;
  color: #dc2626;
}
.i-resize {
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
  visibility: hidden;
  transition: opacity 0.15s ease 0.35s, visibility 0s linear 0.5s;
}
.image-overlay:hover .i-resize,
.image-overlay.is-moving .i-resize {
  opacity: 1;
  visibility: visible;
  transition-delay: 0s;
}
</style>
