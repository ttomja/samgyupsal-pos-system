const XLSX_MIME_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

function normalizeFilename(filename, extension) {
  const baseName =
    String(filename || 'export')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'export'

  return baseName.toLowerCase().endsWith(`.${extension}`)
    ? baseName
    : `${baseName}.${extension}`
}

function normalizeCellValue(value) {
  if (value == null) {
    return ''
  }

  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? '' : value.toISOString()
  }

  if (Array.isArray(value)) {
    return value.map((item) => normalizeCellValue(item)).join('; ')
  }

  if (typeof value === 'object') {
    return JSON.stringify(value)
  }

  return value
}

function getColumnValue(column, row) {
  if (typeof column.value === 'function') {
    return normalizeCellValue(column.value(row))
  }

  return normalizeCellValue(row?.[column.key])
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

function escapeCsvValue(value) {
  const normalizedValue = String(normalizeCellValue(value))
  const safeValue = /^[=+\-@]/.test(normalizedValue)
    ? `'${normalizedValue}`
    : normalizedValue

  if (/[",\r\n]/.test(safeValue)) {
    return `"${safeValue.replace(/"/g, '""')}"`
  }

  return safeValue
}

export function downloadRowsAsCsv(filename, columns = [], rows = []) {
  const headerRow = columns.map((column) => escapeCsvValue(column.header || column.label || column.key))
  const bodyRows = rows.map((row) =>
    columns.map((column) => escapeCsvValue(getColumnValue(column, row))),
  )
  const csvContent = [headerRow, ...bodyRows]
    .map((row) => row.join(','))
    .join('\r\n')
  const blob = new Blob([`\uFEFF${csvContent}`], {
    type: 'text/csv;charset=utf-8',
  })

  downloadBlob(normalizeFilename(filename, 'csv'), blob)
}

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function columnNameFromIndex(index) {
  let columnName = ''
  let currentIndex = Number(index) + 1

  while (currentIndex > 0) {
    const remainder = (currentIndex - 1) % 26
    columnName = String.fromCharCode(65 + remainder) + columnName
    currentIndex = Math.floor((currentIndex - 1) / 26)
  }

  return columnName
}

function buildSheetCell(value, rowIndex, columnIndex) {
  const reference = `${columnNameFromIndex(columnIndex)}${rowIndex + 1}`
  const normalizedValue = normalizeCellValue(value)

  if (
    typeof normalizedValue === 'number' &&
    Number.isFinite(normalizedValue)
  ) {
    return `<c r="${reference}"><v>${normalizedValue}</v></c>`
  }

  return `<c r="${reference}" t="inlineStr"><is><t>${escapeXml(normalizedValue)}</t></is></c>`
}

function buildWorksheetXml(columns, rows) {
  const sheetRows = [
    columns.map((column) => column.header || column.label || column.key),
    ...rows.map((row) => columns.map((column) => getColumnValue(column, row))),
  ]

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>
    ${sheetRows
      .map(
        (row, rowIndex) =>
          `<row r="${rowIndex + 1}">${row
            .map((value, columnIndex) => buildSheetCell(value, rowIndex, columnIndex))
            .join('')}</row>`,
      )
      .join('')}
  </sheetData>
</worksheet>`
}

function buildWorkbookXml(sheetName) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName || 'Report')}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`
}

function buildXlsxFiles(columns, rows, sheetName) {
  return {
    '[Content_Types].xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`,
    '_rels/.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`,
    'xl/workbook.xml': buildWorkbookXml(sheetName),
    'xl/_rels/workbook.xml.rels': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`,
    'xl/worksheets/sheet1.xml': buildWorksheetXml(columns, rows),
    'xl/styles.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="1"><fill><patternFill patternType="none"/></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>
</styleSheet>`,
    'docProps/core.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(sheetName || 'Report Export')}</dc:title>
  <dc:creator>Samgyupsal POS System</dc:creator>
  <cp:lastModifiedBy>Samgyupsal POS System</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`,
    'docProps/app.xml': `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Samgyupsal POS System</Application>
</Properties>`,
  }
}

let crcTable = null

function getCrcTable() {
  if (crcTable) {
    return crcTable
  }

  crcTable = Array.from({ length: 256 }, (_, index) => {
    let value = index

    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }

    return value >>> 0
  })

  return crcTable
}

function crc32(bytes) {
  const table = getCrcTable()
  let crc = 0xffffffff

  for (let index = 0; index < bytes.length; index += 1) {
    crc = table[(crc ^ bytes[index]) & 0xff] ^ (crc >>> 8)
  }

  return (crc ^ 0xffffffff) >>> 0
}

function writeUint16(output, value) {
  output.push(value & 0xff, (value >>> 8) & 0xff)
}

function writeUint32(output, value) {
  output.push(
    value & 0xff,
    (value >>> 8) & 0xff,
    (value >>> 16) & 0xff,
    (value >>> 24) & 0xff,
  )
}

function createZipBlob(files) {
  const encoder = new TextEncoder()
  const localParts = []
  const centralParts = []
  let offset = 0

  Object.entries(files).forEach(([path, content]) => {
    const nameBytes = encoder.encode(path)
    const contentBytes = encoder.encode(content)
    const checksum = crc32(contentBytes)
    const localHeader = []

    writeUint32(localHeader, 0x04034b50)
    writeUint16(localHeader, 20)
    writeUint16(localHeader, 0)
    writeUint16(localHeader, 0)
    writeUint16(localHeader, 0)
    writeUint16(localHeader, 0)
    writeUint32(localHeader, checksum)
    writeUint32(localHeader, contentBytes.length)
    writeUint32(localHeader, contentBytes.length)
    writeUint16(localHeader, nameBytes.length)
    writeUint16(localHeader, 0)

    localParts.push(new Uint8Array(localHeader), nameBytes, contentBytes)

    const centralHeader = []
    writeUint32(centralHeader, 0x02014b50)
    writeUint16(centralHeader, 20)
    writeUint16(centralHeader, 20)
    writeUint16(centralHeader, 0)
    writeUint16(centralHeader, 0)
    writeUint16(centralHeader, 0)
    writeUint16(centralHeader, 0)
    writeUint32(centralHeader, checksum)
    writeUint32(centralHeader, contentBytes.length)
    writeUint32(centralHeader, contentBytes.length)
    writeUint16(centralHeader, nameBytes.length)
    writeUint16(centralHeader, 0)
    writeUint16(centralHeader, 0)
    writeUint16(centralHeader, 0)
    writeUint16(centralHeader, 0)
    writeUint32(centralHeader, 0)
    writeUint32(centralHeader, offset)

    centralParts.push(new Uint8Array(centralHeader), nameBytes)
    offset += localHeader.length + nameBytes.length + contentBytes.length
  })

  const centralSize = centralParts.reduce((total, part) => total + part.length, 0)
  const centralOffset = offset
  const endHeader = []

  writeUint32(endHeader, 0x06054b50)
  writeUint16(endHeader, 0)
  writeUint16(endHeader, 0)
  writeUint16(endHeader, Object.keys(files).length)
  writeUint16(endHeader, Object.keys(files).length)
  writeUint32(endHeader, centralSize)
  writeUint32(endHeader, centralOffset)
  writeUint16(endHeader, 0)

  return new Blob([...localParts, ...centralParts, new Uint8Array(endHeader)], {
    type: XLSX_MIME_TYPE,
  })
}

export function downloadRowsAsXlsx(
  filename,
  columns = [],
  rows = [],
  options = {},
) {
  const files = buildXlsxFiles(columns, rows, options.sheetName || 'Report')
  const blob = createZipBlob(files)
  downloadBlob(normalizeFilename(filename, 'xlsx'), blob)
}
