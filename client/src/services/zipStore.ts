interface ZipFile {
  path: string
  content: string
}

interface EncodedZipFile {
  nameBytes: Uint8Array
  contentBytes: Uint8Array
  crc: number
  localOffset: number
}

const textEncoder = new TextEncoder()
const ZIP_UTF8_FLAG = 0x0800
const ZIP_STORE_METHOD = 0
const DOS_TIME = 0
const DOS_DATE = 33
const CRC_TABLE = createCrcTable()

export function createStoreZip(files: ZipFile[]): Blob {
  const localChunks: Uint8Array[] = []
  const encodedFiles: EncodedZipFile[] = []
  let offset = 0

  for (const file of files) {
    const nameBytes = textEncoder.encode(file.path)
    const contentBytes = textEncoder.encode(file.content)
    const crc = crc32(contentBytes)
    const localOffset = offset
    const localHeader = createLocalHeader(nameBytes.length, contentBytes.length, crc)

    localChunks.push(localHeader, nameBytes, contentBytes)
    offset += localHeader.byteLength + nameBytes.byteLength + contentBytes.byteLength
    encodedFiles.push({ nameBytes, contentBytes, crc, localOffset })
  }

  const centralChunks: Uint8Array[] = []
  const centralDirectoryOffset = offset
  let centralDirectorySize = 0

  for (const file of encodedFiles) {
    const centralHeader = createCentralHeader(
      file.nameBytes.length,
      file.contentBytes.length,
      file.crc,
      file.localOffset,
    )
    centralChunks.push(centralHeader, file.nameBytes)
    centralDirectorySize += centralHeader.byteLength + file.nameBytes.byteLength
  }

  const endRecord = createEndRecord(encodedFiles.length, centralDirectorySize, centralDirectoryOffset)
  const buffer = combineChunks([...localChunks, ...centralChunks, endRecord])
  return new Blob([buffer], { type: 'application/zip' })
}

function createLocalHeader(nameLength: number, size: number, crc: number): Uint8Array {
  const header = new Uint8Array(30)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x04034b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, ZIP_UTF8_FLAG, true)
  view.setUint16(8, ZIP_STORE_METHOD, true)
  view.setUint16(10, DOS_TIME, true)
  view.setUint16(12, DOS_DATE, true)
  view.setUint32(14, crc, true)
  view.setUint32(18, size, true)
  view.setUint32(22, size, true)
  view.setUint16(26, nameLength, true)
  view.setUint16(28, 0, true)
  return header
}

function createCentralHeader(nameLength: number, size: number, crc: number, localOffset: number): Uint8Array {
  const header = new Uint8Array(46)
  const view = new DataView(header.buffer)
  view.setUint32(0, 0x02014b50, true)
  view.setUint16(4, 20, true)
  view.setUint16(6, 20, true)
  view.setUint16(8, ZIP_UTF8_FLAG, true)
  view.setUint16(10, ZIP_STORE_METHOD, true)
  view.setUint16(12, DOS_TIME, true)
  view.setUint16(14, DOS_DATE, true)
  view.setUint32(16, crc, true)
  view.setUint32(20, size, true)
  view.setUint32(24, size, true)
  view.setUint16(28, nameLength, true)
  view.setUint16(30, 0, true)
  view.setUint16(32, 0, true)
  view.setUint16(34, 0, true)
  view.setUint16(36, 0, true)
  view.setUint32(38, 0, true)
  view.setUint32(42, localOffset, true)
  return header
}

function createEndRecord(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number): Uint8Array {
  const record = new Uint8Array(22)
  const view = new DataView(record.buffer)
  view.setUint32(0, 0x06054b50, true)
  view.setUint16(4, 0, true)
  view.setUint16(6, 0, true)
  view.setUint16(8, entryCount, true)
  view.setUint16(10, entryCount, true)
  view.setUint32(12, centralDirectorySize, true)
  view.setUint32(16, centralDirectoryOffset, true)
  view.setUint16(20, 0, true)
  return record
}

function combineChunks(chunks: Uint8Array[]): ArrayBuffer {
  const byteLength = chunks.reduce((total, chunk) => total + chunk.byteLength, 0)
  const buffer = new ArrayBuffer(byteLength)
  const output = new Uint8Array(buffer)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return buffer
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff]
  }
  return (crc ^ 0xffffffff) >>> 0
}

function createCrcTable(): Uint32Array {
  const table = new Uint32Array(256)
  for (let index = 0; index < table.length; index += 1) {
    let crc = index
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) ? (0xedb88320 ^ (crc >>> 1)) : (crc >>> 1)
    }
    table[index] = crc >>> 0
  }
  return table
}
