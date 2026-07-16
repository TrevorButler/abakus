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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 w-full max-w-4xl">
        {DOMAINS.map((domain) => (
          <Link
            key={domain.to}
            to={domain.to}
            className="group flex flex-col rounded-2xl border border-abakus-charcoal/10 bg-white overflow-hidden transition-shadow hover:shadow-lg"
          >
            <div className={`h-2 ${domain.color}`} />
            <div className="p-6 flex flex-col gap-2">
              <h2 className="text-xl font-medium text-abakus-charcoal">{domain.title}</h2>
              <p className="text-abakus-light-grey text-sm leading-relaxed">{domain.description}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
