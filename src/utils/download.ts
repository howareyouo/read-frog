export function saveAs(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoke lazily so the browser has time to start the download
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
