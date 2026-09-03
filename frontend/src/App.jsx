import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";

import Navbar from "./components/Navbar";

import Wallet from "./pages/Wallet";
import Referrals from "./pages/Referrals";
import Purchase from "./pages/Purchase";
import AboutUs from "./pages/Aboutus";
import Timer from "./pages/Timer";
import AdminDashboard from "./pages/AdminDashboard";
import Maintenance from "./pages/Maintenance";

import useTgStartRedirect from "./hooks/useTgStartRedirect";
import { captureInviterCode } from "./utils/referral";
import ErrorBoundary from "./components/ErrorBoundary";


const MAINTENANCE_MODE = false;


function AppContent() {

  useTgStartRedirect();
  captureInviterCode();


  // =========================================
  // SYSTEM MAINTENANCE
  // =========================================

  if (MAINTENANCE_MODE) {
    return <Maintenance />;
  }


  return (
    <div
      style={{
        padding: 16,
        paddingBottom: 80,
      }}
    >

      <Routes>

        <Route
          path="/"
          element={
            <Navigate
              to="/Timer"
              replace
            />
          }
        />


        <Route
          path="/Timer"
          element={<Timer />}
        />


        <Route
          path="/wallet"
          element={<Wallet />}
        />


        <Route
          path="/referrals"
          element={<Referrals />}
        />


        <Route
          path="/stake"
          element={<Purchase />}
        />


        <Route
          path="/Aboutus"
          element={<AboutUs />}
        />


        <Route
          path="/system-admin"
          element={<AdminDashboard />}
        />


        <Route
          path="*"
          element={
            <Navigate
              to="/Timer"
              replace
            />
          }
        />

      </Routes>


      <Navbar />

    </div>
  );
}



export default function App() {

  return (
    <BrowserRouter>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </BrowserRouter>
  );

}