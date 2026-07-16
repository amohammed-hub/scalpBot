import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Dashboard from "./pages/Dashboard";
import RiskCalculator from "./pages/RiskCalculator";
import Settings from "./pages/Settings";
import UpstoxCallback from "./pages/UpstoxCallback";
import HeroZeroScanner from "./pages/HeroZeroScanner";
import PnLAnalytics from "./pages/PnLAnalytics";
import Backtest from "./pages/Backtest";
import Login from "./pages/Login";
import Admin from "./pages/Admin";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/admin" component={Admin} />
      <Route path="/dashboard" component={Dashboard} />
      <Route path="/risk-calculator" component={RiskCalculator} />
      <Route path="/settings" component={Settings} />
      <Route path="/upstox-callback" component={UpstoxCallback} />
      <Route path="/hero-zero" component={HeroZeroScanner} />
      <Route path="/pnl-analytics" component={PnLAnalytics} />
      <Route path="/backtest" component={Backtest} />
      <Route path="/verification" component={Verification} />
      <Route path="/404" component={NotFound} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <Router />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
import Verification from "./pages/Verification";
