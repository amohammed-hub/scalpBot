import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import AppFooter from "@/components/AppFooter";

export default function Privacy() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex flex-col">
      <div className="max-w-3xl mx-auto px-4 py-12 flex-1">
        <Link href="/" className="inline-flex items-center gap-2 text-white/50 hover:text-white/80 text-sm mb-8 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to Home
        </Link>

        <h1 className="text-3xl font-bold mb-2">Privacy Policy</h1>
        <p className="text-white/40 text-sm mb-8">Last updated: July 22, 2026</p>

        <div className="space-y-6 text-white/70 text-sm leading-relaxed">
          <section>
            <h2 className="text-white text-lg font-semibold mb-2">1. Information We Collect</h2>
            <p>When you use ScalpBot, we collect:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong>Account Information:</strong> Mobile number, name (provided during login)</li>
              <li><strong>Upstox API Credentials:</strong> API Key, API Secret, and Access Token (stored encrypted on our server for order execution)</li>
              <li><strong>Trading Data:</strong> Trade history, bot configuration, signal logs, and performance metrics</li>
              <li><strong>Telegram Information:</strong> Bot token and chat ID (if you enable Telegram alerts)</li>
              <li><strong>Usage Data:</strong> Pages visited, features used, bot start/stop times</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">2. How We Use Your Information</h2>
            <p>We use your information to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Execute trades on your behalf via the Upstox API</li>
              <li>Monitor open positions and apply stop-loss/target logic</li>
              <li>Send you Telegram alerts about trade signals and execution</li>
              <li>Generate P&L analytics and performance reports</li>
              <li>Improve the Service and fix bugs</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">3. Data Storage & Security</h2>
            <p>Your data is stored on secure cloud servers (Railway/TiDB). We implement:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>HTTPS encryption for all data in transit</li>
              <li>Server-side storage of API credentials (not exposed to frontend)</li>
              <li>Session-based authentication with OTP verification</li>
              <li>Rate limiting on all API endpoints</li>
              <li>No plain-text logging of sensitive credentials</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">4. Data Sharing</h2>
            <p>We do NOT sell, rent, or share your personal information with third parties. Your data is only shared with:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li><strong>Upstox:</strong> API credentials are sent to Upstox servers to execute orders on your behalf</li>
              <li><strong>Telegram:</strong> Your bot token and chat ID are used to send alerts via Telegram's API</li>
              <li><strong>Razorpay:</strong> Payment information is processed by Razorpay for subscriptions</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">5. Data Retention</h2>
            <p>We retain your data for as long as your account is active. Trade history and analytics are kept indefinitely for your reference. If you request account deletion, we will remove all personal data within 30 days, though anonymized aggregate statistics may be retained.</p>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">6. Your Rights</h2>
            <p>You have the right to:</p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>Access your stored data</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your account and data</li>
              <li>Revoke Upstox API access at any time (via Upstox dashboard)</li>
              <li>Disable Telegram alerts</li>
            </ul>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">7. Cookies & Local Storage</h2>
            <p>We use browser localStorage to store your session token and UI preferences. No third-party tracking cookies are used. Analytics are privacy-respecting and self-hosted.</p>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">8. Changes to This Policy</h2>
            <p>We may update this Privacy Policy from time to time. Changes will be posted on this page with an updated "Last updated" date. Continued use of the Service after changes constitutes acceptance.</p>
          </section>

          <section>
            <h2 className="text-white text-lg font-semibold mb-2">9. Contact</h2>
            <p>For privacy-related questions or data requests, contact us via Telegram or the support channel linked in the app.</p>
          </section>
        </div>
      </div>
      <AppFooter />
    </div>
  );
}
