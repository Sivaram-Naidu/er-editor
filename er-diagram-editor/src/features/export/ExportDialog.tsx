// Export dialog, preview, loss report (FR-6.1 to FR-6.3, FR-6.5).
//
// The format list is the two registries concatenated: text adapters, which turn the model
// into a string, and image adapters, which photograph a render of it. They behave
// differently enough that the dialog branches on which kind is selected — a text format
// gets a preview and a Copy button, an image format gets a size and a note that it cannot
// be read back in — but the format picker and the loss report are shared, because to the
// user "export as PNG" and "export as Mermaid" are the same decision.

import { useCallback, useMemo, useState } from 'react'

import type { Diagram } from '../../domain'
import {
  computeLoss,
  exportAdapters,
  fitToLimit,
  imageExplanations,
  imageExportAdapters,
  renderImage,
  type ExportAdapterInfo,
  type ExportResult,
  type ImageExportAdapter,
  type LossItem,
} from '../../io'
import { saveBlobFile, saveTextFile } from '../../persistence'
import { Dialog } from '../../ui'

import { ExportSurface } from './ExportSurface'
import type { SurfaceGeometry } from './bounds'

/** PNG is written at 2x so it stays sharp on a retina display and when zoomed into. */
const PNG_PIXEL_RATIO = 2

export interface ExportDialogProps {
  diagram: Diagram
  onClose: () => void
}

const TREATMENT_LABEL: Record<LossItem['treatment'], string> = {
  approximated: 'Approximated',
  decomposed: 'Restructured',
  dropped: 'Not exported',
}

function LossReport({
  items,
  note,
}: {
  items: readonly LossItem[]
  note: string | undefined
}): React.ReactElement {
  const caveat = note === undefined ? null : <p className="erd-export__note">{note}</p>

  if (items.length === 0) {
    return (
      <>
        <p className="erd-export__lossless">
          Nothing is lost — this format holds the whole diagram.
        </p>
        {caveat}
      </>
    )
  }

  // Grouped by construct rather than listed per element: "3 weak entities" is more
  // useful than three near-identical lines, and the element names are still there.
  const grouped = new Map<
    string,
    { treatment: LossItem['treatment']; detail: string; names: string[] }
  >()
  for (const item of items) {
    const existing = grouped.get(item.construct)
    if (existing === undefined) {
      grouped.set(item.construct, {
        treatment: item.treatment,
        detail: item.detail,
        names: [item.elementLabel],
      })
    } else {
      existing.names.push(item.elementLabel)
    }
  }

  return (
    <div className="erd-export__loss">
      <h3>What changes in this format</h3>
      <ul>
        {[...grouped.entries()].map(([construct, group]) => (
          <li key={construct} data-treatment={group.treatment}>
            <span className="erd-export__treatment">{TREATMENT_LABEL[group.treatment]}</span>
            <span>{group.detail}</span>
            <span className="erd-export__affected">
              {group.names.slice(0, 4).join(', ')}
              {group.names.length > 4 ? ` and ${String(group.names.length - 4)} more` : ''}
            </span>
          </li>
        ))}
      </ul>
      {caveat}
    </div>
  )
}

/** Every format the dialog offers, in one list, so the picker is one control. */
const ALL_FORMATS: readonly ExportAdapterInfo[] = [...exportAdapters, ...imageExportAdapters]

function imageAdapterFor(id: string): ImageExportAdapter | undefined {
  return imageExportAdapters.find((candidate) => candidate.id === id)
}

export function ExportDialog(props: ExportDialogProps): React.ReactElement {
  const [adapterId, setAdapterId] = useState(ALL_FORMATS[0]?.id ?? 'native-json')
  const [copied, setCopied] = useState(false)
  /** Set while the off-screen surface is mounted and rasterising. */
  const [rendering, setRendering] = useState(false)
  const [imageError, setImageError] = useState<string | undefined>(undefined)

  const adapter = ALL_FORMATS.find((candidate) => candidate.id === adapterId) ?? ALL_FORMATS[0]
  const imageAdapter = adapter === undefined ? undefined : imageAdapterFor(adapter.id)
  const textAdapter = exportAdapters.find((candidate) => candidate.id === adapter?.id)

  // Recomputed only when the document or the format changes. Exporting the reference
  // schema is cheap, but not cheap enough to redo on every keystroke elsewhere.
  const result: ExportResult = useMemo(
    () => textAdapter?.export(props.diagram) ?? { content: '', lossReport: [] },
    [textAdapter, props.diagram],
  )

  // An image adapter has no `export`, so its loss report is derived here from the same
  // capability comparison the text adapters run inside their own exporters.
  const lossReport = useMemo(
    () =>
      imageAdapter === undefined
        ? result.lossReport
        : computeLoss(props.diagram, imageAdapter.capabilities, imageExplanations),
    [imageAdapter, props.diagram, result.lossReport],
  )

  const filename =
    adapter === undefined
      ? 'diagram'
      : `${props.diagram.name.replace(/[^\w-]+/g, '_') || 'diagram'}${adapter.extension}`

  const handleSurfaceReady = useCallback(
    (element: HTMLElement, geometry: SurfaceGeometry) => {
      if (imageAdapter === undefined) return

      const pixelRatio = imageAdapter.format === 'png' ? PNG_PIXEL_RATIO : 1
      // A very large schema would exceed the browser's canvas limit, at which point the
      // encoder returns a blank image rather than failing. Scaling to fit trades
      // sharpness for an image that exists.
      const fit = fitToLimit(geometry.width, geometry.height, pixelRatio)
      const width = Math.floor(geometry.width * fit.scale)
      const height = Math.floor(geometry.height * fit.scale)

      void renderImage(imageAdapter.format, {
        element,
        width,
        height,
        transform: `scale(${String(fit.scale)})`,
        // Read from the live theme rather than hard-coded white, so a diagram exported
        // from the dark theme is not dark text on white paper. `--erd-paper` is the token
        // the canvas itself paints, so the image matches what was on screen.
        backgroundColor:
          getComputedStyle(document.documentElement).getPropertyValue('--erd-paper').trim() ||
          '#ffffff',
        pixelRatio,
      })
        .then((blob) =>
          saveBlobFile({
            suggestedName: filename,
            blob,
            mimeType: imageAdapter.mimeType,
            extensions: { [imageAdapter.extension]: imageAdapter.label },
          }),
        )
        .then(
          () => {
            setRendering(false)
          },
          (cause: unknown) => {
            setImageError(
              cause instanceof Error ? cause.message : 'The image could not be generated.',
            )
            setRendering(false)
          },
        )
    },
    [filename, imageAdapter],
  )

  const handleSurfaceEmpty = useCallback(() => {
    setImageError('There is nothing on the canvas to export yet.')
    setRendering(false)
  }, [])

  if (adapter === undefined) return <></>

  return (
    <>
      <Dialog title="Export" onClose={props.onClose}>
        <label className="erd-inspector__field">
          <span className="erd-inspector__label">Format</span>
          <select
            className="erd-select erd-select--block"
            value={adapterId}
            onChange={(event) => {
              setAdapterId(event.target.value)
              setCopied(false)
              setImageError(undefined)
            }}
          >
            {ALL_FORMATS.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>

        {/* The report comes BEFORE the preview and the buttons on purpose. FR-6.3 is
          about telling the user what changes before they commit, and a warning below
          the fold is a warning nobody reads. */}
        <LossReport items={lossReport} note={adapter.note} />

        {imageAdapter === undefined ? (
          <label className="erd-inspector__field">
            <span className="erd-inspector__label">Preview</span>
            <textarea className="erd-export__preview" readOnly value={result.content} rows={14} />
          </label>
        ) : (
          /* No preview for an image, deliberately. Generating one means mounting the whole
           off-screen surface and rasterising it — the entire cost of the export — every
           time the user changes the format in the dropdown. The dialog says what will be
           written instead, which is the part a preview would actually be consulted for. */
          <p className="erd-inspector__empty">
            Writes the whole diagram at full detail, at the positions you arranged — not just the
            part currently on screen.
          </p>
        )}

        {imageError === undefined ? null : (
          <p className="erd-import__error" role="alert">
            {imageError}
          </p>
        )}

        <footer className="erd-modal__foot">
          {imageAdapter === undefined ? (
            <button
              type="button"
              className="erd-btn"
              onClick={() => {
                // `navigator.clipboard` is typed as always present but is genuinely absent
                // over plain HTTP and in some embedded webviews, so the guard is a runtime
                // check rather than a type one.
                const clipboard = (navigator as { clipboard?: Clipboard }).clipboard
                if (clipboard === undefined) return
                void clipboard.writeText(result.content).then(
                  () => {
                    setCopied(true)
                  },
                  () => {
                    // Clipboard access can be refused outright; the textarea above is
                    // still selectable, so this is a convenience, not the only route.
                    setCopied(false)
                  },
                )
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          ) : null}

          <button
            type="button"
            className="erd-btn erd-btn--primary"
            disabled={rendering}
            onClick={() => {
              setImageError(undefined)

              if (imageAdapter === undefined) {
                void saveTextFile({
                  suggestedName: filename,
                  contents: result.content,
                  mimeType: adapter.mimeType,
                  extensions: { [adapter.extension]: adapter.label },
                })
                return
              }

              // Mounting the surface IS starting the export; it calls back when the render
              // has settled. Kept out of an effect so it only ever runs on a click.
              setRendering(true)
            }}
          >
            {rendering ? 'Rendering…' : `Download ${adapter.extension}`}
          </button>
        </footer>
      </Dialog>

      {/*
        Mounted only while an export is running: it holds every node in the DOM with
        culling off, which is exactly the cost the editing canvas avoids.

        A SIBLING of the dialog, not a child. Inside it, the surface's DOM would sit
        within Radix's focus scope, and React Flow makes its nodes and its zoom controls
        focusable — so mid-export, Tab could walk into a hundred off-screen tables. `inert`
        stops a browser focusing them, but the trap has no business knowing they exist.
      */}
      {rendering && imageAdapter !== undefined ? (
        <ExportSurface
          diagram={props.diagram}
          onReady={handleSurfaceReady}
          onEmpty={handleSurfaceEmpty}
        />
      ) : null}
    </>
  )
}
