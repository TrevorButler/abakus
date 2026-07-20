import { Routes, Route } from 'react-router-dom'
import Layout from './components/Layout'
import Landing from './pages/Landing'
import AcsLanding from './pages/AcsLanding'
import SingleGeography from './pages/SingleGeography'
import Dashboard from './pages/Dashboard'
import ComparativeAnalysis from './pages/ComparativeAnalysis'
import RegionalAnalysis from './pages/RegionalAnalysis'
import HousingDemand from './pages/HousingDemand'
import BlsLanding from './pages/BlsLanding'
import BlsSingleGeography from './pages/BlsSingleGeography'
import BlsDashboard from './pages/BlsDashboard'
import BlsComparative from './pages/BlsComparative'
import BlsOfficeDemand from './pages/BlsOfficeDemand'
import PumsLanding from './pages/PumsLanding'
import PumaHouseholdSummary from './pages/PumaHouseholdSummary'
import CostarLanding from './pages/CostarLanding'
import CostarHeartbeat from './pages/CostarHeartbeat'
import CostarMarketOverview from './pages/CostarMarketOverview'
import CostarMultifamilyComps from './pages/CostarMultifamilyComps'
import SmartReSalesAnalysis from './pages/SmartReSalesAnalysis'
import MasterModule from './pages/MasterModule'
import Admin from './pages/Admin'

function App() {
  return (
    <Layout>
      <Routes>
        <Route path="/" element={<Landing />} />

        <Route path="/acs" element={<AcsLanding />} />
        <Route path="/acs/single" element={<SingleGeography />} />
        <Route path="/acs/single/:geoid" element={<Dashboard />} />
        <Route path="/acs/comparative" element={<ComparativeAnalysis />} />
        <Route path="/acs/regional" element={<RegionalAnalysis />} />
        <Route path="/acs/housing-demand" element={<HousingDemand />} />

        <Route path="/bls" element={<BlsLanding />} />
        <Route path="/bls/single" element={<BlsSingleGeography />} />
        <Route path="/bls/single/:geoid" element={<BlsDashboard />} />
        <Route path="/bls/comparative" element={<BlsComparative />} />
        <Route path="/bls/office-demand" element={<BlsOfficeDemand />} />

        <Route path="/pums" element={<PumsLanding />} />
        <Route path="/pums/household-summary" element={<PumaHouseholdSummary />} />

        <Route path="/costar" element={<CostarLanding />} />
        <Route path="/costar/heartbeat" element={<CostarHeartbeat />} />
        <Route path="/costar/market-overview" element={<CostarMarketOverview />} />
        <Route path="/costar/multifamily-comps" element={<CostarMultifamilyComps />} />

        <Route path="/smartre" element={<SmartReSalesAnalysis />} />

        <Route path="/master" element={<MasterModule />} />

        <Route path="/admin" element={<Admin />} />
      </Routes>
    </Layout>
  )
}

export default App
