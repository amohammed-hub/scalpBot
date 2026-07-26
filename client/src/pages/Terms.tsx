import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import AppFooter from "@/components/AppFooter";

export default function Terms() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
      <div className="max-w-3xl mx-auto px-4 py-12 flex-1">
        <Link href="/" className="inline-flex items-center gap-2 text-white/50 hover:text-white/80 text-sm mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>

        <h1 className="text-3xl font-bold mb-2">Terms of Service</h1>
        <p className="text-white/40 text-sm mb-8">Last updated: July 22, 2026</p>

        <div className="space-y-6 text-white/70 text-sm leading-relaxed">
          <section>
            <h2 className="text-white text-lg font-semibold mb-2">1. Acceptance of Terms</h2>
            <p>By accessing or using ScalpBot ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">2. Description of Service</h2>
            <p>ScalpBot is an automated trading signal and execution tool that connects to your Upstox brokerage account via API. The Service provides algorithmic signal detection, order placement, risk management, and trade analytics for educational and informational purposes.</p>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">3. No Financial Advice</h2>
            <p>ScalpBot does NOT provide financial, investment, or trading advice. All signals, strategies, and analytics are for educational purposes only. You are solely responsible for your trading decisions and any resulting profits or losses. Past performance does not guarantee future results.</p>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">4. Risk Disclosure</h2>
            <p>Trading in financial instruments involves substantial risk of loss and is not suitable for all investors. You should only trade with money you can afford to lose. Leveraged products such as futures and options carry a high degree of risk. You acknowledge that:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>You may lose more than your initial investment</li>
              <li>Automated trading systems can malfunction or produce unexpected results</li>
              <li>Market conditions can change rapidly and without warning</li>
              <li>Technical failures (network, API, server) may prevent timely order execution</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">5. User Responsibilities</h2>
            <p>You are responsible for:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Maintaining the security of your Upstox API credentials</li>
              <li>Monitoring your open positions and account balance</li>
              <li>Ensuring compliance with all applicable laws and SEBI regulations</li>
              <li>Using Demo mode before deploying live capital</li>
              <li>Setting appropriate risk limits and stop-losses</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">6. Intellectual Property</h2>
            <p>All content, code, algorithms, strategies, and branding associated with ScalpBot are proprietary and protected by intellectual property laws. You may not copy, modify, distribute, reverse-engineer, or create derivative works from the Service without explicit written permission.</p>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">7. Limitation of Liability</h2>
            <p>To the maximum extent permitted by law, ScalpBot and its creators shall not be liable for any direct, indirect, incidental, consequential, or punitive damages arising from your use of the Service, including but not limited to trading losses, missed opportunities, or system downtime.</p>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">8. Subscription & Payments</h2>
            <p>Paid subscriptions are billed in advance. All plans include a 2-day free trial. No refunds are issued upon cancellation — access continues until the end of your current billing period. We reserve the right to change pricing with 30 days notice.</p>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">9. Termination</h2>
            <p>We may suspend or terminate your access at any time for violation of these terms, abuse of the Service, or at our sole discretion. Upon termination, all running bots will be stopped and open positions will NOT be automatically closed — you must manage your brokerage account directly.</p>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">10. Governing Law</h2>
            <p>These terms are governed by the laws of India. Any disputes shall be subject to the exclusive jurisdiction of the courts in Hyderabad, Telangana.</p>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">11. Contact</h2>
            <p>For questions about these terms, contact us via Telegram or the support channel linked in the app.</p>
          </section>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}
