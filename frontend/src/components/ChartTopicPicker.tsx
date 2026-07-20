interface ChartSection {
  name: string
  keys: string[]
}

interface Props {
  sections: ChartSection[]
  titleFor: (key: string) => string
  selected: string[]
  onChange: (selected: string[]) => void
}

// Pre-fetch opt-in checklist for the master module wizard -- unlike
// DownloadWorkbookButton's checklist (which gates a download of data
// that's already been fetched, all checked by default), this drives what
// gets requested in the first place, and starts with nothing selected:
// every chart across every section is opt-in, never included by default.
export default function ChartTopicPicker({ sections, titleFor, selected, onChange }: Props) {
  const selectedSet = new Set(selected)

  function toggle(key: string) {
    onChange(selectedSet.has(key) ? selected.filter((k) => k !== key) : [...selected, key])
  }

  return (
    <div className="w-full max-w-2xl flex flex-col gap-4">
      {sections.map((section) => (
        <div key={section.name} className="bg-white rounded-xl border border-abakus-charcoal/10 p-4">
          <h3 className="text-sm font-medium text-abakus-charcoal mb-2">{section.name}</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1">
            {section.keys.map((key) => (
              <label key={key} className="flex items-center gap-2 text-sm text-abakus-charcoal py-0.5">
                <input type="checkbox" checked={selectedSet.has(key)} onChange={() => toggle(key)} />
                {titleFor(key)}
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
