import { useEffect, useRef } from 'react'
import maplibregl, { Map as MapLibreMap } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { mapAssetUrl } from '../lib/api'

interface Props {
  selectedGeoid: string | null
  onToggle: (geoid: string) => void
  showCounties: boolean
  showPlaces: boolean
}

const PUMA_SOURCE_ID = 'pumas'
const PUMA_FILL_LAYER = 'pumas-fill'
const PUMA_LINE_LAYER = 'pumas-line'
const COUNTY_SOURCE_ID = 'counties-overlay'
const COUNTY_LINE_LAYER = 'counties-overlay-line'
const PLACE_SOURCE_ID = 'places-overlay'
const PLACE_LINE_LAYER = 'places-overlay-line'

const BASEMAP_STYLE = 'https://basemaps.cartocdn.com/gl/positron-gl-style/style.json'

// Mirrors GeographyMap.tsx's two-effect pattern (rebuild-on-mount, opacity-
// only update on selection change), but PUMA polygons are the ONLY
// selectable/clickable layer -- county and place boundaries are
// independently-toggleable reference overlays (line-only, no fill, no
// click/mouseenter listeners registered), so clicks always fall through to
// the PUMA fill layer regardless of which overlays are visible.
export default function PumaMap({ selectedGeoid, onToggle, showCounties, showPlaces }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const onToggleRef = useRef(onToggle)
  onToggleRef.current = onToggle

  useEffect(() => {
    if (!containerRef.current) return

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: BASEMAP_STYLE,
      center: [-84.5, 33.0],
      zoom: 5,
    })
    mapRef.current = map

    map.on('error', (e) => {
      console.error('[PumaMap] maplibre error:', e.error?.message ?? e)
    })

    map.on('load', () => {
      map.addSource(COUNTY_SOURCE_ID, { type: 'geojson', data: mapAssetUrl('counties.geojson') })
      map.addLayer({
        id: COUNTY_LINE_LAYER,
        type: 'line',
        source: COUNTY_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: { 'line-color': '#fbab34', 'line-width': 1 },
      })

      map.addSource(PLACE_SOURCE_ID, { type: 'geojson', data: mapAssetUrl('places.geojson') })
      map.addLayer({
        id: PLACE_LINE_LAYER,
        type: 'line',
        source: PLACE_SOURCE_ID,
        layout: { visibility: 'none' },
        paint: { 'line-color': '#f7a097', 'line-width': 1 },
      })

      map.addSource(PUMA_SOURCE_ID, { type: 'geojson', data: mapAssetUrl('pumas.geojson') })
      map.addLayer({
        id: PUMA_FILL_LAYER,
        type: 'fill',
        source: PUMA_SOURCE_ID,
        paint: {
          'fill-color': '#36bfee',
          'fill-opacity': ['case', ['in', ['get', 'GEOID'], ['literal', []]], 0.6, 0.15],
        },
      })
      map.addLayer({
        id: PUMA_LINE_LAYER,
        type: 'line',
        source: PUMA_SOURCE_ID,
        paint: { 'line-color': '#4f4e52', 'line-width': 0.5 },
      })

      map.on('click', PUMA_FILL_LAYER, (e) => {
        const geoid = e.features?.[0]?.properties?.GEOID
        if (geoid) onToggleRef.current(geoid)
      })
      map.on('mouseenter', PUMA_FILL_LAYER, () => {
        map.getCanvas().style.cursor = 'pointer'
      })
      map.on('mouseleave', PUMA_FILL_LAYER, () => {
        map.getCanvas().style.cursor = ''
      })
    })

    return () => {
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const applyHighlight = () => {
      if (map.getLayer(PUMA_FILL_LAYER)) {
        map.setPaintProperty(PUMA_FILL_LAYER, 'fill-opacity', [
          'case',
          ['in', ['get', 'GEOID'], ['literal', selectedGeoid ? [selectedGeoid] : []]],
          0.6,
          0.15,
        ])
      }
    }
    if (map.isStyleLoaded()) applyHighlight()
    else map.once('load', applyHighlight)
  }, [selectedGeoid])

  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    const applyVisibility = () => {
      if (map.getLayer(COUNTY_LINE_LAYER)) map.setLayoutProperty(COUNTY_LINE_LAYER, 'visibility', showCounties ? 'visible' : 'none')
      if (map.getLayer(PLACE_LINE_LAYER)) map.setLayoutProperty(PLACE_LINE_LAYER, 'visibility', showPlaces ? 'visible' : 'none')
    }
    if (map.isStyleLoaded()) applyVisibility()
    else map.once('load', applyVisibility)
  }, [showCounties, showPlaces])

  return <div ref={containerRef} className="w-full h-96 rounded-lg overflow-hidden border border-abakus-charcoal/10" />
}
