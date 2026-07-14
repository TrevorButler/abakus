import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import AnalysisPlaceholder from './pages/AnalysisPlaceholder'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/single" element={<AnalysisPlaceholder mode="Single Geography Analysis" />} />
        <Route path="/comparative" element={<AnalysisPlaceholder mode="Comparative Analysis" />} />
        <Route path="/regional" element={<AnalysisPlaceholder mode="Regional Analysis" />} />
      </Routes>
    </Layout>
  )
}

export default App
