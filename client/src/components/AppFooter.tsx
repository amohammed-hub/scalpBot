import { Link } from "wouter";

export default function AppFooter() {
  return (
    <footer className="w-full border-t border-white/5 bg-black/30 backdrop-blur-sm mt-auto">
      <div className="max-w-7xl mx-auto px-4 py-4 flex flex-col sm:flex-row items-center justify-between gap-2">
        <p className="text-white/40 text-xs">
          &copy; 2026 ScalpBot&trade;. All rights reserved.
        </p>
        <div className="flex items-center gap-4">
          <Link href="/terms" className="text-white/40 hover:text-white/70 text-xs transition-colors">
            Terms of Service
          </Link>
          <Link href="/privacy" className="text-white/40 hover:text-white/70 text-xs transition-colors">
            Privacy Policy
          </Link>
        </div>
      </div>
    </footer>
  );
}
