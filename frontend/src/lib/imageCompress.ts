'use client'

/**
 * Compressão de imagem client-side via Canvas.
 *
 * Por que existe: o sistema de envio de mídia roda sobre WebSocket, e payloads
 * de 12 MB (foto crua de câmera) matavam a conexão / deixavam o envio lento.
 * Redimensionar para no máx. 1280px e recomprimir como JPEG reduz o tamanho
 * ~10x sem perda perceptível no chat.
 *
 * Funcionamento:
 * 1. Decodifica a imagem num <img> (off-DOM).
 * 2. Redimensiona mantendo proporção, respeitando maxDim.
 * 3. Re-codifica via canvas.toBlob('image/jpeg', quality).
 * 4. Se o resultado for maior que o original (já comprimido), usa o original.
 */

export interface CompressOptions {
  /** Dimensão máxima (largura OU altura) em pixels. Default 1280. */
  maxDim?: number
  /** Qualidade JPEG 0–1. Default 0.8. */
  quality?: number
  /** MIME de saída. Default 'image/jpeg'. */
  mimeType?: string
}

export interface CompressedImage {
  blob: Blob
  file: File
  /** data URL pronto para envio (data:image/jpeg;base64,...) */
  dataUrl: string
  /** Largura final em px */
  width: number
  /** Altura final em px */
  height: number
  /** Tamanho original em bytes */
  originalSize: number
  /** Tamanho final em bytes */
  compressedSize: number
}

/**
 * Comprime uma imagem. Rejeita se não for imagem ou se o canvas não for suportado.
 */
export async function compressImage(
  file: File,
  options: CompressOptions = {}
): Promise<CompressedImage> {
  const { maxDim = 1280, quality = 0.8, mimeType = 'image/jpeg' } = options

  if (!file.type.startsWith('image/')) {
    throw new Error('not_an_image')
  }

  // SVG não comprime bem como JPEG; passa direto.
  if (file.type === 'image/svg+xml') {
    const dataUrl = await readAsDataURL(file)
    return {
      blob: file,
      file,
      dataUrl,
      width: 0,
      height: 0,
      originalSize: file.size,
      compressedSize: file.size,
    }
  }

  // Decodifica a imagem
  const img = await loadImage(file)

  // Calcula dimensões finais mantendo proporção
  let { width, height } = fitInto(img.naturalWidth, img.naturalHeight, maxDim)

  // Desenha no canvas
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas_unsupported')

  // Fundo branco (JPEG não suporta transparência; evita fundo preto em PNGs c/ alpha)
  if (mimeType === 'image/jpeg') {
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, width, height)
  }
  ctx.drawImage(img, 0, 0, width, height)

  // Re-codifica
  const blob = await canvasToBlob(canvas, mimeType, quality)

  // Se a "compressão" ficou maior que o original, prefere o original
  const useOriginal = blob.size >= file.size
  const finalBlob = useOriginal ? file : blob
  const finalFile = new File(
    [finalBlob],
    replaceExtension(file.name, mimeType),
    { type: finalBlob.type || mimeType, lastModified: Date.now() }
  )
  const dataUrl = await readAsDataURL(finalFile)

  return {
    blob: finalBlob,
    file: finalFile,
    dataUrl,
    width,
    height,
    originalSize: file.size,
    compressedSize: finalBlob.size,
  }
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function loadImage(file: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('image_decode_failed'))
    }
    img.src = url
  })
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('canvas_encode_failed'))),
      mimeType,
      quality
    )
  })
}

function readAsDataURL(file: File | Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('read_failed'))
    reader.readAsDataURL(file)
  })
}

function fitInto(w: number, h: number, maxDim: number) {
  if (!w || !h) return { width: maxDim, height: maxDim }
  if (w <= maxDim && h <= maxDim) return { width: w, height: h }
  const ratio = w / h
  if (w >= h) {
    return { width: maxDim, height: Math.round(maxDim / ratio) }
  }
  return { width: Math.round(maxDim * ratio), height: maxDim }
}

function replaceExtension(name: string, mimeType: string): string {
  const ext = mimeType === 'image/jpeg' ? 'jpg' : mimeType.split('/')[1] || 'img'
  const base = name.replace(/\.[^.]+$/, '')
  return `${base}.${ext}`
}

/**
 * Formata bytes para exibição amigável.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
