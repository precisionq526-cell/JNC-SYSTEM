interface ImageDesign {
  shownImageDimensions?: { width: number; height: number }
  adjustments?: { crop?: { width?: number; height?: number; noEffect?: boolean }; rotation?: number }
  resize?: { width?: number; height?: number }
}

export function getEditedImageSize(originalWidth: number, originalHeight: number, design: ImageDesign) {
  const crop = design.adjustments?.crop
  const shown = design.shownImageDimensions
  const width = crop?.width && shown?.width && !crop.noEffect ? originalWidth * crop.width / shown.width : originalWidth
  const height = crop?.height && shown?.height && !crop.noEffect ? originalHeight * crop.height / shown.height : originalHeight
  const angle = (design.adjustments?.rotation ?? 0) * Math.PI / 180
  const rotatedWidth = Math.abs(width * Math.cos(angle)) + Math.abs(height * Math.sin(angle))
  const rotatedHeight = Math.abs(width * Math.sin(angle)) + Math.abs(height * Math.cos(angle))
  const resize = design.resize
  return {
    width: Math.max(1, Math.round(resize?.width || (resize?.height ? resize.height * rotatedWidth / rotatedHeight : rotatedWidth))),
    height: Math.max(1, Math.round(resize?.height || (resize?.width ? resize.width * rotatedHeight / rotatedWidth : rotatedHeight))),
  }
}
