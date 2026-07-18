import { Link } from 'react-router-dom'

const MODES = [
  {
    to: '/costar/heartbeat',
    title: 'Heartbeat',
    description: 'Upload a CoStar property list and get a Heartbeat workbook: development by decade, existing/under construction/proposed by class.',
    color: 'bg-abakus-blue',
  },
  {
    to: '/costar/market-overview',
    title: 'Market Overview & Comparison',
    description: 'Upload annual market metrics for up to 6 markets and compare them side by side, by property class.',
    color: 'bg-abakus-pink',
  },
  {
    to: '/costar/multifamily-comps',
    title: 'Multifamily Comps',
    description: 'Upload unit mix sheets for up to 12 comps and get a Unit Type Summary and Comp Summary with charts.',
    color: 'bg-abakus-orange',
  },
]

export default function CostarLanding() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
      <h1 className="font-sans text-4xl md:text-5xl text-abakus-charcoal font-medium tracking-tight mb-3 text-center">
        CoStar
      </h1>
      <p className="text-abakus-light-grey text-lg mb-12 text-center max-w-xl">Pick a module.</p>
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
