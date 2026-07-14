import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import SingleGeography from './pages/SingleGeography'
import Dashboard from './pages/Dashboard'
import AnalysisPlaceholder from './pages/AnalysisPlaceholder'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/single" element={<SingleGeography />} />
        <Route path="/single/:geoid" element={<Dashboard />} />
        <Route path="/comparative" element={<AnalysisPlaceholder mode="Comparative Analysis" />} />
        <Route path="/regional" element={<AnalysisPlaceholder mode="Regional Analysis" />} />
      </Routes>
    </Layout>
  )
}

export default App
