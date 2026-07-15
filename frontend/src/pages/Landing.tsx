import { Link } from 'react-router-dom'

const MODES = [
  {
    to: '/single',
    title: 'Single Geography',
    description: 'Explore the full demographic, housing, and income dashboard for one place or county.',
    color: 'bg-abakus-blue',
  },
  {
    to: '/comparative',
    title: 'Comparative Analysis',
    description: 'Compare a primary geography against up to five similar communities, side by side.',
    color: 'bg-abakus-pink',
  },
  {
    to: '/regional',
    title: 'Regional Analysis',
    description: 'Select multiple geographies and view them aggregated as a region, or separated out.',
    color: 'bg-abakus-orange',
  },
  {
    to: '/housing-demand',
    title: 'Housing Demand Projections',
    description: 'Project future housing demand for one geography from population, household size, and turnover assumptions.',
    color: 'bg-abakus-green',
  },
]

export default function Landing() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
      <h1 className="font-sans text-4xl md:text-5xl text-abakus-charcoal font-medium tracking-tight mb-3 text-center">
        Where do you want to start?
      </h1>
      <p className="text-abakus-light-grey text-lg mb-12 text-center max-w-xl">
        Pick an analysis mode. You'll choose your geography next.
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-6 w-full max-w-5xl">
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
    </div>
  )
}
