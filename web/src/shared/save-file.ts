import { accountBridge } from './account.js'

/**
 * 保存一个二进制文件到用户可访问的位置。
 *
 * WebView 与 ArkWeb 都不会响应带 blob: 的下载链接：原生壳里点导出没有任何反应。
 * 因此原生桥提供写入能力时交给壳；纯浏览器环境才走链接下载。
 * 有桥但没有写入能力时明确报错——按“已开始下载”报告会让用户以为文件已保存。
 */
export type SaveResult = { viaNative: boolean; filename: string }

/** 平台或壳不支持保存文件；调用方据此给出可读的失败提示。 */
export class SaveUnsupportedError extends Error {
  constructor() {
    super('saving files is not supported by this shell')
    this.name = 'SaveUnsupportedError'
  }
}

const blobToBase64 = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = typeof reader.result === 'string' ? reader.result : ''
      const comma = result.indexOf(',')
      resolve(comma >= 0 ? result.slice(comma + 1) : '')
    }
    reader.onerror = () => reject(reader.error ?? new Error('cannot read the export'))
    reader.readAsDataURL(blob)
  })

const downloadInBrowser = (filename: string, blob: Blob): void => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

export const saveFile = async (filename: string, blob: Blob): Promise<SaveResult> => {
  const bridge = accountBridge()
  if (bridge) {
    if (!bridge.saveFile) {
      // 壳没有实现写入：浏览器式下载在这里不会落地，必须报错而不是假装成功。
      throw new SaveUnsupportedError()
    }
    const base64 = await blobToBase64(blob)
    await bridge.saveFile({
      filename,
      base64,
      mimeType: blob.type || 'application/octet-stream',
    })
    return { viaNative: true, filename }
  }
  downloadInBrowser(filename, blob)
  return { viaNative: false, filename }
}
