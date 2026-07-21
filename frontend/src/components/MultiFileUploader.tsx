import FileUploadSlot from './FileUploadSlot'

export interface UploadItem {
  id: string
  name: string
  file: File | null
}

interface Props {
  items: UploadItem[]
  onChange: (items: UploadItem[]) => void
  maxItems: number
  withNames?: boolean
  namePlaceholder?: string
  accept?: string
}

// "+"-driven list of upload slots up to a cap -- used by Multifamily Comps
// (up to 12, named) and SmartRE (up to 20, unnamed). Market Overview isn't
// built on this: it's a fixed 6-market x 5-class matrix, not an open-ended
// list, so it manages its own upload state directly.
export default function MultiFileUploader({
  items,
  onChange,
  maxItems,
  withNames = true,
  namePlaceholder = 'Name',
  accept,
}: Props) {
  // Native multi-select (the file picker's own ctrl/shift-click or "select
  // all") -- selected files first backfill any empty slots (so the
  // starting blank row doesn't linger unused), then append new rows for
  // the rest, up to maxItems. Per explicit feedback: batch-selecting many
  // files at once should be possible instead of one "+ Add a file" click
  // per file.
  function handleBatchSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    const next = [...items]
    for (const f of files) {
      const emptyIdx = next.findIndex((it) => !it.file)
      if (emptyIdx !== -1) {
        next[emptyIdx] = { ...next[emptyIdx], file: f }
      } else if (next.length < maxItems) {
        next.push({ id: crypto.randomUUID(), name: '', file: f })
      } else {
        break
      }
    }
    onChange(next)
    e.target.value = ''
  }

  function updateItem(id: string, patch: Partial<UploadItem>) {
    onChange(items.map((it) => (it.id === id ? { ...it, ...patch } : it)))
  }

  function removeItem(id: string) {
    onChange(items.filter((it) => it.id !== id))
  }

  return (
    <div className="flex flex-col gap-2">
      {items.map((item) => (
        <FileUploadSlot
          key={item.id}
          label={withNames ? item.name : undefined}
          onLabelChange={withNames ? (v) => updateItem(item.id, { name: v }) : undefined}
          labelPlaceholder={namePlaceholder}
          file={item.file}
          onFileChange={(f) => updateItem(item.id, { file: f })}
          accept={accept}
          onRemove={() => removeItem(item.id)}
        />
      ))}
      {items.length < maxItems && (
        <label className="self-start flex items-center gap-2 border border-dashed border-abakus-charcoal/25 rounded-lg px-3 py-2 text-sm text-abakus-blue hover:bg-abakus-cream transition-colors cursor-pointer">
          <input type="file" accept={accept} multiple className="hidden" onChange={handleBatchSelect} />
          + Add files ({items.length}/{maxItems}) -- select multiple at once
        </label>
      )}
    </div>
  )
}
