import Navbar from "@/components/Navbar";
import TickerBanner from "@/components/TickerBanner";
import HeroSection from "@/components/HeroSection";
import ScalperToolSection from "@/components/ScalperToolSection";
import AlgoverseSection from "@/components/AlgoverseSection";
import IntegrationsSection from "@/components/IntegrationsSection";
import RiskManagementSection from "@/components/RiskManagementSection";
import SEBISection from "@/components/SEBISection";
import Footer from "@/components/Footer";
import RiskCalcBanner from "@/components/RiskCalcBanner";

export default function Home() {
  return (
    <div className="min-h-screen bg-[oklch(0.11_0.025_240)]">
      <Navbar />
      <TickerBanner />
      <HeroSection />

      <RiskCalcBanner />
      {/* Section dividers */}
      <div className="section-divider" />
      <ScalperToolSection />
      <div className="section-divider" />
      <AlgoverseSection />
      <div className="section-divider" />
      <IntegrationsSection />
      <div className="section-divider" />
      <RiskManagementSection />
      <div className="section-divider" />
      <SEBISection />
      <div className="section-divider" />
      <Footer />
    </div>
  );
}
