import { MessageCircle } from "lucide-react";

export function WhatsAppButton() {
  return (
    <a
      href="https://wa.me/916301742267?text=Hi%2C%20I%27m%20interested%20in%20ScalpBot"
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Chat on WhatsApp"
      className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[#25D366] shadow-lg transition-transform duration-200 hover:scale-110 active:scale-95"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 32 32"
        className="h-7 w-7 fill-white"
      >
        <path d="M16.004 0h-.008C7.174 0 0 7.176 0 16.004c0 3.5 1.132 6.744 3.054 9.378L1.054 31.2l6.044-1.94a15.9 15.9 0 0 0 8.906 2.712C24.826 31.972 32 24.796 32 16.004 32 7.176 24.826 0 16.004 0zm9.53 22.606c-.4 1.126-2.342 2.154-3.228 2.234-.886.08-1.712.4-5.77-1.202-4.878-1.926-7.952-6.95-8.192-7.272-.24-.322-1.962-2.61-1.962-4.978 0-2.37 1.242-3.536 1.682-4.018.44-.482.96-.602 1.28-.602.32 0 .64.002.92.016.294.016.69-.112 1.08.824.4.96 1.36 3.33 1.48 3.57.12.24.2.52.04.84-.16.32-.24.52-.48.8-.24.28-.504.626-.72.84-.24.24-.49.5-.21.98.28.48 1.244 2.054 2.672 3.326 1.836 1.636 3.384 2.142 3.864 2.382.48.24.76.2 1.04-.12.28-.32 1.2-1.4 1.52-1.88.32-.48.64-.4 1.08-.24.44.16 2.79 1.316 3.27 1.556.48.24.8.36.92.56.12.2.12 1.146-.28 2.272z" />
      </svg>
    </a>
  );
}
