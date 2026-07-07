/**
 * QRModal — Precision Dark Finance theme
 * Shows a scannable QR code for the live site URL
 * Includes device-specific install instructions and copy link button
 */

import { useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { X, Smartphone, Monitor, Copy, Check, Download, Wifi, QrCode } from "lucide-react";

const LIVE_URL = window.location.origin;

interface QRModalProps {
  open: boolean;
  onClose: () => void;
}

export default function QRModal({ open, onClose }: QRModalProps) {
  const [copied, setCopied] = useState(false);
  const [activeDevice, setActiveDevice] = useState<"mobile" | "desktop">("mobile");

  const copyLink = () => {
    navigator.clipboard.writeText(LIVE_URL).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-md" />

      {/* Modal */}
      <div
        className="relative z-10 w-full max-w-md rounded-3xl border border-white/10 bg-[oklch(0.14_0.025_240)] shadow-2xl overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-[oklch(0.78_0.18_195/0.15)] border border-[oklch(0.78_0.18_195/0.35)] flex items-center justify-center">
              <QrCode className="w-4 h-4 text-[oklch(0.78_0.18_195)]" />
            </div>
            <div>
              <h2 className="text-white font-black text-base" style={{ fontFamily: "'Syne', sans-serif" }}>
                Open on Any Device
              </h2>
              <p className="text-white/40 text-xs">Scan QR code or copy the link</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg border border-white/10 flex items-center justify-center text-white/40 hover:text-white hover:border-white/20 transition-all duration-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* QR Code */}
        <div className="flex flex-col items-center px-6 py-6">
          <div className="p-4 rounded-2xl bg-white mb-4 shadow-lg shadow-[oklch(0.78_0.18_195/0.15)]">
            <QRCodeSVG
              value={LIVE_URL}
              size={200}
              bgColor="#ffffff"
              fgColor="#0D1B2A"
              level="H"
              includeMargin={false}
              imageSettings={{
                src: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cGF0aCBkPSJNMTMgMTBWM0w0IDE0SDExVjIxTDIwIDEwSDEzWiIgZmlsbD0iIzAwRDRGRiIgc3Ryb2tlPSIjMDBENEZGIiBzdHJva2Utd2lkdGg9IjIiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg==",
                height: 32,
                width: 32,
                excavate: true,
              }}
            />
          </div>

          <div className="flex items-center gap-2 mb-1">
            <Wifi className="w-3.5 h-3.5 text-[oklch(0.78_0.18_195)]" />
            <span className="text-[oklch(0.78_0.18_195)] text-xs font-semibold">Works on any device with a browser</span>
          </div>
          <p className="text-white/30 text-xs text-center mb-5">
            Point your phone camera at the QR code to open instantly
          </p>

          {/* Copy Link */}
          <div className="w-full flex items-center gap-2 p-3 rounded-xl bg-white/4 border border-white/8 mb-5">
            <span className="flex-1 text-white/50 text-xs truncate" style={{ fontFamily: "'DM Mono', monospace" }}>
              {LIVE_URL}
            </span>
            <button
              onClick={copyLink}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 shrink-0 ${
                copied
                  ? "bg-[oklch(0.78_0.18_195/0.2)] text-[oklch(0.78_0.18_195)] border border-[oklch(0.78_0.18_195/0.4)]"
                  : "bg-white/8 text-white/60 border border-white/10 hover:bg-white/12 hover:text-white"
              }`}
            >
              {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          {/* Device Tabs */}
          <div className="w-full">
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setActiveDevice("mobile")}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
                  activeDevice === "mobile"
                    ? "bg-[oklch(0.78_0.18_195/0.12)] text-[oklch(0.78_0.18_195)] border border-[oklch(0.78_0.18_195/0.3)]"
                    : "bg-white/3 text-white/40 border border-white/8 hover:border-white/15"
                }`}
              >
                <Smartphone className="w-3.5 h-3.5" />
                Android / iPhone
              </button>
              <button
                onClick={() => setActiveDevice("desktop")}
                className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-semibold transition-all duration-200 ${
                  activeDevice === "desktop"
                    ? "bg-[oklch(0.78_0.18_195/0.12)] text-[oklch(0.78_0.18_195)] border border-[oklch(0.78_0.18_195/0.3)]"
                    : "bg-white/3 text-white/40 border border-white/8 hover:border-white/15"
                }`}
              >
                <Monitor className="w-3.5 h-3.5" />
                PC / Mac
              </button>
            </div>

            {/* Install Instructions */}
            {activeDevice === "mobile" && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-white/30 uppercase tracking-widest mb-3">How to install on phone</p>
                {[
                  { step: "1", icon: "📱", text: "Scan the QR code above with your camera app" },
                  { step: "2", icon: "🌐", text: "The site opens in your browser (Chrome/Safari)" },
                  { step: "3", icon: "⋯", text: 'Tap the browser menu (⋯ or Share button)' },
                  { step: "4", icon: "📲", text: '"Add to Home Screen" → tap Add — done!' },
                ].map(item => (
                  <div key={item.step} className="flex items-start gap-3 p-3 rounded-xl bg-white/3 border border-white/5">
                    <span className="text-base shrink-0">{item.icon}</span>
                    <p className="text-white/55 text-xs leading-relaxed">{item.text}</p>
                  </div>
                ))}
                <p className="text-white/25 text-xs text-center mt-2">
                  Works on iPhone (Safari) and Android (Chrome) — no app store needed
                </p>
              </div>
            )}

            {activeDevice === "desktop" && (
              <div className="space-y-2">
                <p className="text-xs font-bold text-white/30 uppercase tracking-widest mb-3">How to install on PC / Mac</p>
                {[
                  { step: "1", icon: "🔗", text: "Copy the link above and open it in Chrome or Edge" },
                  { step: "2", icon: "📥", text: 'Look for the install icon (⊕) in the address bar' },
                  { step: "3", icon: "✅", text: 'Click "Install" — the app opens like a desktop app' },
                  { step: "4", icon: "🖥️", text: "Find it in your Start Menu or Applications folder" },
                ].map(item => (
                  <div key={item.step} className="flex items-start gap-3 p-3 rounded-xl bg-white/3 border border-white/5">
                    <span className="text-base shrink-0">{item.icon}</span>
                    <p className="text-white/55 text-xs leading-relaxed">{item.text}</p>
                  </div>
                ))}
                <p className="text-white/25 text-xs text-center mt-2">
                  Works on Chrome and Edge — no download required
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 pb-5">
          <a
            href={LIVE_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-[oklch(0.78_0.18_195)] text-[oklch(0.11_0.025_240)] text-sm font-bold hover:bg-[oklch(0.82_0.18_195)] transition-colors duration-200"
          >
            <Download className="w-4 h-4" />
            Open Live App
          </a>
        </div>
      </div>
    </div>
  );
}
