import { useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Smartphone, Shield, ArrowRight } from "lucide-react";

export default function Login() {
  const [, navigate] = useLocation();
  const [step, setStep] = useState<"mobile" | "otp" | "name">("mobile");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");
  const [name, setName] = useState("");
  const [countdown, setCountdown] = useState(0);

  const sendOtpMutation = trpc.mobileAuth.sendOtp.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        toast.success("OTP sent to your mobile number");
        setStep("otp");
        // Start 60s countdown
        setCountdown(60);
        const interval = setInterval(() => {
          setCountdown((prev) => {
            if (prev <= 1) {
              clearInterval(interval);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        toast.error(data.message);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const verifyOtpMutation = trpc.mobileAuth.verifyOtp.useMutation({
    onSuccess: (data) => {
      if (data.success && data.user) {
        // Do NOT overwrite localStorage sessionToken — the server was updated to match it.
        // The localStorage token is the identity key linked to credentials, trades, etc.
        // Store auth token for API calls
        if (data.token) {
          localStorage.setItem("scalpbot_auth_token", data.token);
        }
        // If user has no name, ask for it
        if (!data.user.name) {
          setStep("name");
        } else {
          toast.success(`Welcome back, ${data.user.name}!`);
          navigate("/dashboard");
        }
      } else {
        toast.error(data.message ?? "Verification failed");
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const updateNameMutation = trpc.mobileAuth.updateName.useMutation({
    onSuccess: () => {
      toast.success(`Welcome, ${name}!`);
      navigate("/dashboard");
    },
    onError: (e) => toast.error(e.message),
  });

  const handleSendOtp = () => {
    if (mobile.length < 10) {
      toast.error("Enter a valid 10-digit mobile number");
      return;
    }
    sendOtpMutation.mutate({ mobile });
  };

  const handleVerifyOtp = () => {
    if (otp.length !== 6) {
      toast.error("Enter the 6-digit OTP");
      return;
    }
    // Pass the current localStorage sessionToken so the server updates the user record to match
    const currentToken = localStorage.getItem("scalpbot_session") || undefined;
    verifyOtpMutation.mutate({ mobile, code: otp, sessionToken: currentToken });
  };

  const handleSetName = () => {
    if (name.trim().length < 1) {
      toast.error("Enter your name");
      return;
    }
    updateNameMutation.mutate({ name: name.trim() });
  };

  return (
    <div className="min-h-screen bg-[#0a0f1a] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center gap-2 mb-4">
            <div className="w-10 h-10 bg-teal-500/20 rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-teal-400" />
            </div>
            <span className="text-2xl font-bold text-white font-[Syne]">ScalpBot</span>
          </div>
          <p className="text-white/50 text-sm">
            {step === "mobile" && "Enter your mobile number to get started"}
            {step === "otp" && "Enter the 6-digit OTP sent to your phone"}
            {step === "name" && "What should we call you?"}
          </p>
        </div>

        {/* Card */}
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 backdrop-blur-sm">
          {step === "mobile" && (
            <div className="space-y-4">
              <div className="relative">
                <Smartphone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-white/40" />
                <Input
                  type="tel"
                  placeholder="Enter 10-digit mobile number"
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/\D/g, "").slice(0, 10))}
                  className="pl-10 bg-white/5 border-white/10 text-white placeholder:text-white/30 h-12 text-lg"
                  onKeyDown={(e) => e.key === "Enter" && handleSendOtp()}
                />
              </div>
              <div className="flex items-center gap-2 text-xs text-white/40">
                <span className="bg-white/10 px-2 py-0.5 rounded text-white/60">+91</span>
                <span>India mobile numbers only</span>
              </div>
              <Button
                className="w-full bg-teal-500 hover:bg-teal-600 text-white h-12 text-base font-medium"
                onClick={handleSendOtp}
                disabled={sendOtpMutation.isPending || mobile.length < 10}
              >
                {sendOtpMutation.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>Send OTP <ArrowRight className="w-4 h-4 ml-2" /></>
                )}
              </Button>
            </div>
          )}

          {step === "otp" && (
            <div className="space-y-4">
              <p className="text-sm text-white/60 text-center">
                OTP sent to <span className="text-teal-400 font-mono">+91 {mobile}</span>
              </p>
              <Input
                type="text"
                inputMode="numeric"
                placeholder="Enter 6-digit OTP"
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30 h-12 text-lg text-center tracking-[0.5em] font-mono"
                onKeyDown={(e) => e.key === "Enter" && handleVerifyOtp()}
                autoFocus
              />
              <Button
                className="w-full bg-teal-500 hover:bg-teal-600 text-white h-12 text-base font-medium"
                onClick={handleVerifyOtp}
                disabled={verifyOtpMutation.isPending || otp.length !== 6}
              >
                {verifyOtpMutation.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  "Verify & Login"
                )}
              </Button>
              <div className="flex items-center justify-between">
                <button
                  className="text-sm text-white/40 hover:text-white/60"
                  onClick={() => { setStep("mobile"); setOtp(""); }}
                >
                  Change number
                </button>
                <button
                  className="text-sm text-teal-400 hover:text-teal-300 disabled:text-white/20"
                  onClick={handleSendOtp}
                  disabled={countdown > 0 || sendOtpMutation.isPending}
                >
                  {countdown > 0 ? `Resend in ${countdown}s` : "Resend OTP"}
                </button>
              </div>
            </div>
          )}

          {step === "name" && (
            <div className="space-y-4">
              <p className="text-sm text-white/60 text-center">
                First time? Tell us your name.
              </p>
              <Input
                type="text"
                placeholder="Your name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="bg-white/5 border-white/10 text-white placeholder:text-white/30 h-12 text-lg"
                onKeyDown={(e) => e.key === "Enter" && handleSetName()}
                autoFocus
              />
              <Button
                className="w-full bg-teal-500 hover:bg-teal-600 text-white h-12 text-base font-medium"
                onClick={handleSetName}
                disabled={updateNameMutation.isPending || name.trim().length < 1}
              >
                {updateNameMutation.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>Continue to Dashboard <ArrowRight className="w-4 h-4 ml-2" /></>
                )}
              </Button>
            </div>
          )}
        </div>

        {/* Footer */}
        <p className="text-center text-white/30 text-xs mt-6">
          By continuing, you agree to our Terms of Service.
          <br />Your data is encrypted and never shared.
        </p>
      </div>
    </div>
  );
}
