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
  function addItem() {
    if (items.length >= maxItems) return
    onChange([...items, { id: crypto.randomUUID(), name: '', file: null }])
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
        <button type="button" onClick={addItem} className="self-start text-abakus-blue hover:underline text-sm">
          + Add {items.length > 0 ? 'another' : 'a'} file ({items.length}/{maxItems})
        </button>
      )}
    </div>
  )
}
