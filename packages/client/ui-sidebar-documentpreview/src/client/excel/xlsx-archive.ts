/** XLSX preview copies without DrawingML parts; worksheet XML and source bytes remain untouched. */
import { strFromU8, unzipSync, zipSync, type Unzipped } from 'fflate'
import { XMLParser } from 'fast-xml-parser'
import type { ExcelUnsupportedFeature } from './model.ts'

/** Owns the unpacked preview copy and its detected unsupported content. */
export class XlsxPreviewArchive {
  /** Detected workbook content that the preview does not display. */
  readonly unsupportedFeatures = new Set<ExcelUnsupportedFeature>()
  private readonly files: Unzipped

  /**
   * Read an archive without modifying the borrowed source buffer.
   * @param bytes - Complete XLSX source bytes.
   */
  constructor(private readonly bytes: Uint8Array<ArrayBuffer>) {
    this.files = unzipSync(bytes)
  }

  /**
   * Omit DrawingML parts before ExcelJS parses them; callers must also ignore worksheet drawing references.
   * @returns Source bytes when no parts were omitted, otherwise an uncompressed temporary ZIP.
   */
  withoutDrawings(): Uint8Array<ArrayBuffer> {
    const entries = Object.entries(this.files)
    const retained = entries.filter(([path, bytes]) => {
      if (/^xl\/worksheets\/[^/]+\.xml$/.test(path)) {
        this.inspectContent(bytes)
        return true
      }
      if (/^xl\/drawings\/[^/]+\.xml$/.test(path)) {
        this.inspectContent(bytes)
      } else if (!/^xl\/drawings\/_rels\/[^/]+\.xml\.rels$/.test(path)) {
        return true
      }
      return false
    })
    return retained.length === entries.length ? this.bytes : new Uint8Array(zipSync(Object.fromEntries(retained), { level: 0 }))
  }

  private inspectContent(bytes: Uint8Array): void {
    new XMLParser({
      removeNSPrefix: true,
      processEntities: false,
      parseTagValue: false,
      stopNodes: ['*.sheetData'],
      updateTag: (tag: string) => {
        if (tag === 'chart') this.unsupportedFeatures.add('charts')
        if (tag === 'pic' || tag === 'picture') this.unsupportedFeatures.add('images')
        if (tag === 'sp' || tag === 'grpSp' || tag === 'cxnSp') this.unsupportedFeatures.add('shapes')
        if (tag === 'conditionalFormatting') this.unsupportedFeatures.add('conditionalFormatting')
        if (tag === 'sheetData') return false
        return tag
      },
    }).parse(strFromU8(bytes))
  }
}
