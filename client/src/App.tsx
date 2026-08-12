import { lazy, Suspense } from "react";
import { Toaster } from "@/components/ui/sonner";
import { TradeToastContainer } from "@/components/TradeToast";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Login from "./pages/Login";
import UpstoxCallback from "./pages/UpstoxCallback";
import { WhatsAppButton } from "./components/WhatsAppButton";

// D18 — Code-splitting: lazy-load every heavy page so the initial JS bundle
// drops from ~1.9MB to the lightweight login/home shell. The dashboard shell,
// chart components, and the backtest engine are fetched only when the user
// navigates to those routes (preloading kicks in on hover of nav links).
const Dashboard = lazy(() => import("./pages/Dashboard"));
const RiskCalculator = lazy(() => import("./pages/RiskCalculator"));
const Settings = lazy(() => import("./pages/Settings"));
const HeroZeroScanner = lazy(() => import("./pages/HeroZeroScanner"));
const PnLAnalytics = lazy(() => import("./pages/PnLAnalytics"));
const Backtest = lazy(() => import("./pages/Backtest"));
const Terms = lazy(() => import("./pages/Terms"));
const Privacy = lazy(() => import("./pages/Privacy"));

function PageLoader() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-4 border-border border-t-primary" aria-label="Loading" />
    </div>
  );
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/login" component={Login} />
      <Route path="/terms">
        <Suspense fallback={<PageLoader />}><Terms /></Suspense>
      </Route>
      <Route path="/privacy">
        <Suspense fallback={<PageLoader />}><Privacy /></Suspense>
      </Route>
      <Route path="/dashboard">
        <Suspense fallback={<PageLoader />}><Dashboard /></Suspense>
      </Route>
      <Route path="/dashboard/trades">
        <Suspense fallback={<PageLoader />}><Dashboard /></Suspense>
      </Route>
      <Route path="/dashboard/log">
        <Suspense fallback={<PageLoader />}><Dashboard /></Suspense>
      </Route>
      <Route path="/risk-calculator">
        <Suspense fallback={<PageLoader />}><RiskCalculator /></Suspense>
      </Route>
      <Route path="/settings">
        <Suspense fallback={<PageLoader />}><Settings /></Suspense>
      </Route>
      <Route path="/upstox-callback" component={UpstoxCallback} />
      <Route path="/hero-zero">
        <Suspense fallback={<PageLoader />}><HeroZeroScanner /></Suspense>
      </Route>
      <Route path="/pnl-analytics">
        <Suspense fallback={<PageLoader />}><PnLAnalytics /></Suspense>
      </Route>
      <Route path="/backtest">
        <Suspense fallback={<PageLoader />}><Backtest /></Suspense>
      </Route>
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
          <TradeToastContainer />
          <Router />
          <WhatsAppButton />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;
