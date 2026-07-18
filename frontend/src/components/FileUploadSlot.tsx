interface Props {
  label?: string
  onLabelChange?: (label: string) => void
  labelPlaceholder?: string
  file: File | null
  onFileChange: (file: File | null) => void
  accept?: string
  onRemove?: () => void
}

// Single named-file-input row -- the building block reused by every
// CoStar/SmartRE upload page, standalone (Heartbeat's one file) or inside
// MultiFileUploader (Multifamily Comps, SmartRE). onLabelChange being
// undefined omits the name textbox entirely (Market Overview's per-class
// slots don't need one; the market name is captured once per market).
export default function FileUploadSlot({
  label,
  onLabelChange,
  labelPlaceholder = 'Name',
  file,
  onFileChange,
  accept = '.xlsx,.xls,.csv',
  onRemove,
}: Props) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {onLabelChange && (
        <input
          type="text"
          value={label ?? ''}
          onChange={(e) => onLabelChange(e.target.value)}
          placeholder={labelPlaceholder}
          className="border border-abakus-charcoal/20 rounded-lg px-3 py-2 bg-white text-sm w-48"
        />
      )}
      <label className="flex items-center gap-2 border border-dashed border-abakus-charcoal/25 rounded-lg px-3 py-2 text-sm text-abakus-light-grey cursor-pointer hover:bg-abakus-cream transition-colors">
        <input
          type="file"
          accept={accept}
          className="hidden"
          onChange={(e) => onFileChange(e.target.files?.[0] ?? null)}
        />
        <span className={file ? 'text-abakus-charcoal' : ''}>{file ? file.name : 'Choose file...'}</span>
      </label>
      {onRemove && (
        <button type="button" onClick={onRemove} className="text-abakus-warm-400 text-xs hover:underline shrink-0">
          Remove
        </button>
      )}
    </div>
  )
}
