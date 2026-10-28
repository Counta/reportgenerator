/**
 * 插入图片的尺寸与避让辅助
 *
 * 与电路图一致：只存显示宽度 w，高度按原始宽高比 naturalH/naturalW 计算，
 * 缩放时图形不会变形。
 */
import type { ImageData } from '@/types'
import type { ObstacleRect } from '@/lib/textLayout'
import { clonePlot } from '@/lib/plot'

export type ImageSource = Pick<ImageData, 'src' | 'naturalW' | 'naturalH'>

/** 只读取剪贴板中的本地图片，不解析 HTML 或远程图片地址。 */
export function clipboardImages(data: DataTransfer | null): File[] {
  if (!data) return []
  const files = Array.from(data.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null)
  return files.length ? files : Array.from(data.files).filter((file) => file.type.startsWith('image/'))
}

export function readImageFile(file: File): Promise<ImageSource> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('请选择图片文件'))
      return
    }
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('文件读取失败'))
    reader.onload = () => {
      const src = reader.result as string
      const img = new Image()
      img.onerror = () => reject(new Error('图片读取失败'))
      img.onload = () => {
        if (!img.naturalWidth || !img.naturalHeight) {
          reject(new Error('图片尺寸无效'))
          return
        }
        resolve({ src, naturalW: img.naturalWidth, naturalH: img.naturalHeight })
      }
      img.src = src
    }
    reader.readAsDataURL(file)
  })
}

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
  return img.plot ? { ...img, plot: clonePlot(img.plot) } : { ...img }
}
