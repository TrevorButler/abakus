import { Link } from 'react-router-dom'

const DOMAINS = [
  {
    to: '/acs',
    title: 'American Community Survey',
    description: 'Population, housing, and income analysis from Census ACS 5-year estimates.',
    color: 'bg-abakus-blue',
  },
  {
    to: '/bls',
    title: 'Employment & Wages',
    description: 'BLS employment and wage trends by industry sector, plus office demand projections.',
    color: 'bg-abakus-orange',
  },
  {
    to: '/pums',
    title: 'PUMA / PUMS',
    description: 'Microdata-driven household averages at the Public Use Microdata Area level.',
    color: 'bg-abakus-green',
  },
  {
    to: '/costar',
    title: 'CoStar',
    description: 'Clean and repackage CoStar exports into ready-to-use workbooks with editable charts.',
    color: 'bg-abakus-warm-400',
  },
  {
    to: '/smartre',
    title: 'SmartRE',
    description: 'Clean SmartRE sales downloads into comp-set price and volume analysis.',
    color: 'bg-abakus-warm-200',
  },
]

export default function Landing() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
      <h1 className="font-sans text-4xl md:text-5xl text-abakus-charcoal font-medium tracking-tight mb-3 text-center">
        Where do you want to start?
      </h1>
      <p className="text-abakus-light-grey text-lg mb-12 text-center max-w-xl">
        Pick a data source. You'll choose an analysis mode next.
      </p>
      <div className="flex flex-col gap-4 w-full max-w-5xl">
        {DOMAINS.map((domain) => (
          <Link
            key={domain.to}
            to={domain.to}
            className="group flex items-stretch rounded-2xl border border-abakus-charcoal/10 bg-white overflow-hidden transition-shadow hover:shadow-lg"
          >
            <div className={`w-2 shrink-0 ${domain.color}`} />
            <div className="flex-1 p-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
              <h2 className="text-xl font-medium text-abakus-charcoal">{domain.title}</h2>
              <p className="text-abakus-light-grey text-sm leading-relaxed sm:max-w-md sm:text-right">{domain.description}</p>
            </div>
          </Link>
        ))}
      </div>

      <div className="w-full max-w-5xl mt-8 pt-8 border-t border-abakus-charcoal/10 flex flex-col items-center gap-2">
        <p className="text-abakus-light-grey text-sm">Want it all in one place?</p>
        <Link
          to="/master"
          className="bg-abakus-charcoal text-white font-medium px-8 py-3 rounded-2xl hover:opacity-90 transition-opacity"
        >
          Build Report
        </Link>
      </div>
    </div>
  )
}
