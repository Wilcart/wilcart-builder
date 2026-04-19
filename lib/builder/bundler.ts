import JSZip from 'jszip'
import type { BuilderFile } from '@/types/builder'

export async function bundleFilesToZip(files: BuilderFile[]): Promise<Buffer> {
  const zip = new JSZip()
  for (const file of files) {
    zip.file(file.path, file.content)
  }
  const buffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' })
  return buffer
}
