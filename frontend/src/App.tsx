import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import SingleGeography from './pages/SingleGeography'
import Dashboard from './pages/Dashboard'
import ComparativeAnalysis from './pages/ComparativeAnalysis'
import RegionalAnalysis from './pages/RegionalAnalysis'
import HousingDemand from './pages/HousingDemand'
import Admin from './pages/Admin'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/single" element={<SingleGeography />} />
        <Route path="/single/:geoid" element={<Dashboard />} />
        <Route path="/comparative" element={<ComparativeAnalysis />} />
        <Route path="/regional" element={<RegionalAnalysis />} />
        <Route path="/housing-demand" element={<HousingDemand />} />
        <Route path="/admin" element={<Admin />} />
      </Routes>
    </Layout>
  )
}

export default App
