/**
 * 插入图片的尺寸与避让辅助
 *
 * 与电路图一致：只存显示宽度 w，高度按原始宽高比 naturalH/naturalW 计算，
 * 缩放时图形不会变形。
 */
import type { ImageData } from '@/types'
import type { ObstacleRect } from '@/lib/textLayout'

/** 图片在页面上的显示高度（PDF 点），按原始宽高比保持形状 */
export function imageDisplayHeight(img: ImageData): number {
  if (!img.naturalW || !img.naturalH) return img.w
  return (img.w * img.naturalH) / img.naturalW
}

/** 用于文字避让的矩形 */
export function imageObstacles(images: ImageData[] = []): ObstacleRect[] {
  return images.map((img) => ({
    page: img.page,
    x: img.x,
    y: img.y,
    w: img.w,
    h: imageDisplayHeight(img),
  }))
}

export function cloneImage(img: ImageData): ImageData {
  return { ...img }
}