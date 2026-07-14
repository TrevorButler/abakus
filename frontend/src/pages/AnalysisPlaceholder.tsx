import { Link } from 'react-router-dom'

export default function AnalysisPlaceholder({ mode }: { mode: string }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-16 gap-4">
      <h1 className="text-3xl font-medium text-abakus-charcoal">{mode}</h1>
      <p className="text-abakus-light-grey">Geography selection and dashboard coming next.</p>
      <Link to="/" className="text-abakus-blue hover:underline text-sm">
        Back to mode selection
      </Link>
    </div>
  )
}
