import { jsPDF } from 'jspdf'
import { PAGE_SIZE_PT } from '@/types'
import type { FormTemplate, ReportData } from '@/types'
import { exportPage } from '@/lib/exporter'

/** A4 at 300 dpi; fit the existing template without changing editor coordinates. */
export async function exportReportPdf(
  data: ReportData,
  template: FormTemplate,
  onProgress: (page: number) => void,
): Promise<Blob> {
  await document.fonts.ready
  const pdf = new jsPDF({
    orientation: 'portrait',
    unit: 'pt',
    format: 'a4',
    compress: true,
  })
  const pageWidth = pdf.internal.pageSize.getWidth()
  const pageHeight = pdf.internal.pageSize.getHeight()
  const fit = Math.min(pageWidth / PAGE_SIZE_PT.width, pageHeight / PAGE_SIZE_PT.height)
  const width = PAGE_SIZE_PT.width * fit
  const height = PAGE_SIZE_PT.height * fit
  const x = (pageWidth - width) / 2
  const y = (pageHeight - height) / 2

  // Render sequentially, keeping only one high-resolution source page at a time.
  for (let page = 1; page <= template.pages; page++) {
    onProgress(page)
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const { dataUrl } = await exportPage(
      page,
      page === 1 ? '/bg_page1.png' : '/bg_page2.png',
      data,
      template,
      (300 / 72) * fit,
    )
    if (page > 1) pdf.addPage('a4', 'portrait')
    pdf.addImage(dataUrl, 'PNG', x, y, width, height, undefined, 'FAST')
  }
  return pdf.output('blob')
}
