import { useEffect, useRef } from 'react'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { mapAssetUrl, type GeoType } from '../lib/api'

interface Props {
  geoType: GeoType
  selectedGeoids: string[]
  onToggle: (geoid: string) => void
}

const SOURCE_ID = 'geographies'
const FILL_LAYER = 'geographies-fill'
const LINE_LAYER = 'geographies-line'

// CARTO's free, keyless "Positron" basemap -- no API key required, matches
// the light/cream aesthetic. Revisit before heavy production traffic (rate
// limits, attribution terms) -- fine for development.
const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

export default function GeographyMap({ geoType, selectedGeoids, onToggle }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const onToggleRef = useRef(onToggle)
  onToggleRef.current = onToggle

  // Map + data layer setup, re-run when geoType changes (swap which
  // GeoJSON layer is shown, not just re-filter -- places and counties are
  // separate files).
  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [-84.5, 33.0], // roughly centered on the 7-state region
      zoom: 5,
    })
    mapRef.current = map

    map.on('error', (e) => {
      console.error('[GeographyMap] maplibre error:', e.error?.message ?? e)
    })

    map.on('load', () => {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: mapAssetUrl(geoType === 'place' ? 'places.geojson' : 'counties.geojson'),
      })
      map.addLayer({
        id: FILL_LAYER,
        type: 'fill',
        source: SOURCE_ID,
        paint: {
          'fill-color': '#36bfee',
          'fill-opacity': ['case', ['in', ['get', 'GEOID'], ['literal', []]], 0.6, 0.15],
        },
      })
      map.addLayer({
        id: LINE_LAYER,
        type: 'line',
        source: SOURCE_ID,
        paint: { 'line-color': '#4f4e52', 'line-width': 0.5 },
      })

      map.on('click', FILL_LAYER, (e) => {
        const geoid = e.features?.[0]?.properties?.GEOID
        if (geoid) onToggleRef.current(geoid)
      })
      map.on('mouseenter', FILL_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', FILL_LAYER, () => {
        map.getCanvas().style.cursor = ''
      })
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [geoType])

  // Update the highlight expression whenever the selection changes, without
  // rebuilding the whole map.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const applyHighlight = () => {
      if (map.getLayer(FILL_LAYER)) {
        map.setPaintProperty(FILL_LAYER, 'fill-opacity', [
          'case',
          ['in', ['get', 'GEOID'], ['literal', selectedGeoids]],
          0.6,
          0.15,
        ])
      }
    }
    if (map.isStyleLoaded()) applyHighlight()
    else map.once('load', applyHighlight)
  }, [selectedGeoids])

  return <div ref={containerRef} className="w-full h-96 rounded-lg overflow-hidden border border-abakus-charcoal/10" />
}
