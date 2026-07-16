import { Link } from 'react-router-dom'

const MODES = [
  {
    to: '/bls/single',
    title: 'Single Geography',
    description: 'Employment and wage trends by industry sector for one county.',
    color: 'bg-abakus-blue',
  },
  {
    to: '/bls/comparative',
    title: 'Comparative Analysis',
    description: 'Select multiple counties and view them aggregated as a region, or separated out.',
    color: 'bg-abakus-pink',
  },
  {
    to: '/bls/office-demand',
    title: 'Office Demand Projections',
    description: 'Project future office space demand from sector job growth, allocated down to individual places.',
    color: 'bg-abakus-green',
  },
]

export default function BlsLanding() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
      <h1 className="font-sans text-4xl md:text-5xl text-abakus-charcoal font-medium tracking-tight mb-3 text-center">
        Employment &amp; Wages
      </h1>
      <p className="text-abakus-light-grey text-lg mb-12 text-center max-w-xl">
        Pick an analysis mode. You'll choose your county next.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
        {MODES.map((mode) => (
          <Link
            key={mode.to}
            to={mode.to}
            className="group flex flex-col rounded-2xl border border-abakus-charcoal/10 bg-white overflow-hidden transition-shadow hover:shadow-lg"
          >
            <div className={`h-2 ${mode.color}`} />
            <div className="p-6 flex flex-col gap-2">
              <h2 className="text-xl font-medium text-abakus-charcoal">{mode.title}</h2>
              <p className="text-abakus-light-grey text-sm leading-relaxed">{mode.description}</p>
            </div>
          </Link>
        ))}
      </div>
      <Link to="/" className="text-abakus-blue hover:underline text-sm mt-auto pt-12">
        Back to data source selection
      </Link>
    </div>
  )
}
