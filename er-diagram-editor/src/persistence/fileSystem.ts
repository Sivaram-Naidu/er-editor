// Download + File System Access API, feature-detected.
//
// V1 is browser-only with no backend (SRS §1.2), so "save to disk" means one of two
// things depending on the browser: a real file handle where the File System Access API
// exists (Chromium), or a download where it does not (Firefox, Safari). Both are
// implemented; the caller does not need to care which ran.

export interface SaveFileOptions {
  suggestedName: string
  contents: string
  mimeType: string
  /** For the File System Access picker, e.g. `{ '.erd.json': 'ER diagram' }`. */
  extensions: Record<string, string>
}

export interface SaveBlobOptions extends Omit<SaveFileOptions, 'contents'> {
  /** Already-encoded bytes. Used for PNG/SVG export (FR-6.5). */
  blob: Blob
}

interface FileSystemPickerWindow {
  showSaveFilePicker?: (options: unknown) => Promise<FileSystemFileHandle>
  showOpenFilePicker?: (options: unknown) => Promise<FileSystemFileHandle[]>
}

function picker(): FileSystemPickerWindow {
  return globalThis as unknown as FileSystemPickerWindow
}

export function hasFileSystemAccess(): boolean {
  return typeof picker().showSaveFilePicker === 'function'
}

/** Fallback path: an object URL and a synthetic click. */
function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')

  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()

  // Revoked on the next task, not immediately: some browsers abort the download if the
  // URL is released while the click is still being processed.
  setTimeout(() => {
    URL.revokeObjectURL(url)
  }, 0)
}

/**
 * Write bytes to disk.
 *
 * @returns true if a file handle was used, false if it fell back to a download.
 *
 * Both public entry points funnel through here because the picker dance — feature detect,
 * distinguish a cancellation from a failure, fall back — is the same whether the payload
 * is a Mermaid file or a PNG, and a second copy of it would be a second place for the
 * AbortError case to be got wrong.
 */
export async function saveBlobFile(options: SaveBlobOptions): Promise<boolean> {
  const showSaveFilePicker = picker().showSaveFilePicker

  if (showSaveFilePicker !== undefined) {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: options.suggestedName,
        types: [
          {
            description: 'Diagram',
            accept: { [options.mimeType]: Object.keys(options.extensions) },
          },
        ],
      })
      const writable = await handle.createWritable()
      await writable.write(options.blob)
      await writable.close()
      return true
    } catch (error) {
      // AbortError means the user dismissed the picker; that is a cancellation, not a
      // failure, and must not silently trigger a download they did not ask for.
      if (error instanceof DOMException && error.name === 'AbortError') return true
      // Anything else — a permission problem, an unsupported origin — falls through.
    }
  }

  download(options.blob, options.suggestedName)
  return false
}

/** @returns true if a file handle was used, false if it fell back to a download. */
export async function saveTextFile(options: SaveFileOptions): Promise<boolean> {
  const { contents, ...rest } = options
  return saveBlobFile({ ...rest, blob: new Blob([contents], { type: options.mimeType }) })
}

export interface OpenedFile {
  name: string
  text: string
}

/**
 * Read a text file chosen by the user. Resolves undefined if they cancel.
 *
 * The NAME is returned alongside the text, not just the text: the importer is chosen by
 * extension, so a reader that only gets the contents cannot tell a `.sql` dump from a
 * `.mmd` diagram without guessing from the bytes.
 */
export async function openTextFile(accept: string): Promise<OpenedFile | undefined> {
  const showOpenFilePicker = picker().showOpenFilePicker

  if (showOpenFilePicker !== undefined) {
    try {
      const [handle] = await showOpenFilePicker({ multiple: false })
      if (handle === undefined) return undefined
      const file = await handle.getFile()
      return { name: file.name, text: await file.text() }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return undefined
    }
  }

  return new Promise<OpenedFile | undefined>((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept

    input.addEventListener('change', () => {
      const file = input.files?.[0]
      if (file === undefined) {
        resolve(undefined)
        return
      }
      void file.text().then(
        (text) => {
          resolve({ name: file.name, text })
        },
        () => {
          resolve(undefined)
        },
      )
    })

    // `cancel` is not universally supported; when it is missing the promise simply never
    // settles, which is acceptable for a user-initiated dialog that was dismissed.
    input.addEventListener('cancel', () => {
      resolve(undefined)
    })

    input.click()
  })
}
