import { Link } from 'react-router-dom'

export default function PumsLanding() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center px-6 py-16">
      <h1 className="font-sans text-4xl md:text-5xl text-abakus-charcoal font-medium tracking-tight mb-3 text-center">
        PUMA / PUMS
      </h1>
      <p className="text-abakus-light-grey text-lg mb-12 text-center max-w-xl">
        Pick a PUMA on the map to see its household averages.
      </p>
      <Link
        to="/pums/household-summary"
        className="group flex flex-col rounded-2xl border border-abakus-charcoal/10 bg-white overflow-hidden transition-shadow hover:shadow-lg w-full max-w-sm"
      >
        <div className="h-2 bg-abakus-green" />
        <div className="p-6 flex flex-col gap-2">
          <h2 className="text-xl font-medium text-abakus-charcoal">Population & Children by Housing Type</h2>
          <p className="text-abakus-light-grey text-sm leading-relaxed">
            Average household size and school-aged children per unit, by unit type and bedroom count.
          </p>
        </div>
      </Link>
      <Link to="/" className="text-abakus-blue hover:underline text-sm mt-auto pt-12">
        Back to data source selection
      </Link>
    </div>
  )
}
