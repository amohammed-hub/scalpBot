import { useState, useEffect } from "react";
import { TrendingUp, Menu, X, Zap } from "lucide-react";

const navLinks = [
  { label: "Scalper Tool", href: "#scalper" },
  { label: "Algoverse", href: "#algoverse" },
  { label: "Integrations", href: "#integrations" },
  { label: "Risk Management", href: "#risk" },
  { label: "SEBI Rules", href: "#sebi" },
];

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener("scroll", onScroll);
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const handleNav = (href: string) => {
    setMobileOpen(false);
    const el = document.querySelector(href);
    if (el) el.scrollIntoView({ behavior: "smooth" });
  };

  return (
    <header
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled
          ? "bg-[oklch(0.11_0.025_240/0.95)] backdrop-blur-xl border-b border-white/5 shadow-lg"
          : "bg-transparent"
      }`}
    >
      <div className="container flex items-center justify-between h-16">
        {/* Logo */}
        <a
          href="#"
          onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}
          className="flex items-center gap-2 group"
        >
          <div className="w-8 h-8 rounded-lg bg-[oklch(0.78_0.18_195/0.15)] border border-[oklch(0.78_0.18_195/0.4)] flex items-center justify-center pulse-glow">
            <Zap className="w-4 h-4 text-[oklch(0.78_0.18_195)]" />
          </div>
          <span className="font-bold text-sm tracking-wide" style={{ fontFamily: "'Syne', sans-serif" }}>
            <span className="text-[oklch(0.78_0.18_195)]">Upstox</span>
            <span className="text-white/90"> Scalping Hub</span>
          </span>
        </a>

        {/* Desktop Nav */}
        <nav className="hidden md:flex items-center gap-6">
          {navLinks.map((link) => (
            <button
              key={link.href}
              onClick={() => handleNav(link.href)}
              className="text-sm text-white/60 hover:text-[oklch(0.78_0.18_195)] transition-colors duration-200 font-medium"
            >
              {link.label}
            </button>
          ))}
        </nav>

        {/* CTA */}
        <div className="hidden md:flex items-center gap-3">
          <a
            href="https://upstox.com/scalper/"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-[oklch(0.78_0.18_195)] text-[oklch(0.11_0.025_240)] text-sm font-semibold hover:bg-[oklch(0.82_0.18_195)] transition-colors duration-200"
          >
            <TrendingUp className="w-4 h-4" />
            Try Scalper
          </a>
        </div>

        {/* Mobile Menu Toggle */}
        <button
          className="md:hidden text-white/70 hover:text-white"
          onClick={() => setMobileOpen(!mobileOpen)}
        >
          {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="md:hidden bg-[oklch(0.13_0.025_240/0.98)] backdrop-blur-xl border-b border-white/5 px-4 py-4 flex flex-col gap-3">
          {navLinks.map((link) => (
            <button
              key={link.href}
              onClick={() => handleNav(link.href)}
              className="text-left text-sm text-white/70 hover:text-[oklch(0.78_0.18_195)] transition-colors py-2 border-b border-white/5"
            >
              {link.label}
            </button>
          ))}
          <a
            href="https://upstox.com/scalper/"
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[oklch(0.78_0.18_195)] text-[oklch(0.11_0.025_240)] text-sm font-semibold"
          >
            <TrendingUp className="w-4 h-4" />
            Try Scalper Free
          </a>
        </div>
      )}
    </header>
  );
}
