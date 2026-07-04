import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { trpc } from "@/lib/trpc";
import { CheckCircle, XCircle, Loader2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";

const LS_SESSION = "scalpbot_session";
const LS_CREDS = "scalpbot_credentials";

function getSessionToken(): string {
  let token = localStorage.getItem(LS_SESSION);
  if (!token) {
    token = crypto.randomUUID();
    localStorage.setItem(LS_SESSION, token);
  }
  return token;
}

function getRedirectUri(): string {
  // Use the live app URL as redirect URI (same origin)
  return `${window.location.origin}/upstox-callback`;
}

type Status = "loading" | "success" | "error" | "no_code";

export default function UpstoxCallback() {
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<Status>("loading");
  const [errorMsg, setErrorMsg] = useState("");

  const exchangeCode = trpc.credentials.exchangeCode.useMutation();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get("code");

    if (!code) {
      setStatus("no_code");
      return;
    }

    const sessionToken = getSessionToken();
    const redirectUri = getRedirectUri();

    // Also save the redirect URI to localStorage so Settings shows the correct one
    try {
      const creds = JSON.parse(localStorage.getItem(LS_CREDS) ?? "null") ?? {};
      localStorage.setItem(LS_CREDS, JSON.stringify({ ...creds, redirectUri }));
    } catch {
      // ignore
    }

    exchangeCode.mutate(
      { sessionToken, code, redirectUri },
      {
        onSuccess: () => {
          // Mark tokenSavedAt so Dashboard token indicator turns green immediately
          // The actual token is stored server-side in the DB; we just record the timestamp
          try {
            const creds = JSON.parse(localStorage.getItem(LS_CREDS) ?? "null") ?? {};
            localStorage.setItem(LS_CREDS, JSON.stringify({
              ...creds,
              // Mark token as fetched today via OAuth (actual token is in DB)
              accessToken: creds.accessToken || "[auto-fetched]",
              tokenSavedAt: Date.now(),
            }));
          } catch {
            // ignore
          }
          setStatus("success");
          // Auto-redirect to settings after 3 seconds
          setTimeout(() => navigate("/settings"), 3000);
        },
        onError: (err) => {
          setErrorMsg(err.message);
          setStatus("error");
        },
      }
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="min-h-screen bg-[oklch(0.10_0.02_240)] text-white flex items-center justify-center p-6">
      <div className="max-w-md w-full">
        {/* Logo */}
        <div className="flex items-center justify-center gap-2 mb-8">
          <div className="w-10 h-10 bg-teal-500 rounded-xl flex items-center justify-center">
            <Zap className="w-6 h-6 text-white" />
          </div>
          <span className="text-xl font-bold text-white">ScalpBot</span>
        </div>

        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 text-center">
          {status === "loading" && (
            <>
              <Loader2 className="w-12 h-12 text-teal-400 animate-spin mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">Fetching Your Access Token…</h2>
              <p className="text-white/50 text-sm">
                Connecting to Upstox and exchanging your authorization code for an access token.
                This takes just a second.
              </p>
            </>
          )}

          {status === "success" && (
            <>
              <CheckCircle className="w-12 h-12 text-emerald-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">Access Token Saved!</h2>
              <p className="text-white/60 text-sm mb-4">
                Your Upstox access token has been automatically fetched and saved.
                You are now ready for Live trading today.
              </p>
              <div className="bg-emerald-500/10 border border-emerald-500/30 rounded-xl p-3 mb-6">
                <p className="text-emerald-400 text-xs">
                  Token is valid until 3:30 AM tomorrow (IST). You will need to refresh it each morning.
                </p>
              </div>
              <p className="text-white/30 text-xs mb-4">Redirecting to Settings in 3 seconds…</p>
              <Button
                className="bg-teal-500 hover:bg-teal-600 text-white w-full"
                onClick={() => navigate("/settings")}
              >
                Go to Settings Now
              </Button>
            </>
          )}

          {status === "error" && (
            <>
              <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">Token Exchange Failed</h2>
              <p className="text-white/60 text-sm mb-4">
                Could not automatically fetch your access token. This usually happens if:
              </p>
              <ul className="text-left text-white/50 text-sm space-y-2 mb-6">
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">•</span>
                  Your API Key or Secret is not saved in Settings yet
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">•</span>
                  The authorization code has already been used (each code is single-use)
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-red-400 mt-0.5">•</span>
                  The redirect URI in your Upstox app does not match this page's URL
                </li>
              </ul>
              {errorMsg && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 mb-6 text-left">
                  <p className="text-red-400 text-xs font-mono break-all">{errorMsg}</p>
                </div>
              )}
              <div className="flex gap-3">
                <Button
                  variant="outline"
                  className="flex-1 border-white/20 text-white/70 bg-transparent hover:bg-white/5"
                  onClick={() => navigate("/settings")}
                >
                  Go to Settings
                </Button>
                <Button
                  className="flex-1 bg-teal-500 hover:bg-teal-600 text-white"
                  onClick={() => navigate("/dashboard")}
                >
                  Go to Dashboard
                </Button>
              </div>
            </>
          )}

          {status === "no_code" && (
            <>
              <XCircle className="w-12 h-12 text-amber-400 mx-auto mb-4" />
              <h2 className="text-xl font-bold text-white mb-2">No Authorization Code</h2>
              <p className="text-white/60 text-sm mb-6">
                This page is the callback URL for Upstox OAuth. It should only be opened after
                logging in through Upstox. Please use the "Get Token Automatically" button in Settings.
              </p>
              <Button
                className="bg-teal-500 hover:bg-teal-600 text-white w-full"
                onClick={() => navigate("/settings")}
              >
                Go to Settings
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
