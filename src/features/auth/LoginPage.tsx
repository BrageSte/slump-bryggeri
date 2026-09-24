import { useQueryClient } from "@tanstack/react-query";
import { useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router";
import { Wordmark } from "../../components/AppShell.tsx";
import { Button, Card, Field, InlineError, TextInput } from "../../design-system/index.ts";
import { authClient } from "../../lib/auth-client.ts";
import { meQueryKey, useMe } from "./session.ts";

type AuthError = { status?: number; code?: string; message?: string } | null;

function describe(error: AuthError, fallback: string): string {
  if (!error) return fallback;
  if (error.status === 429) return "For mange forsøk. Vent litt og prøv igjen.";
  switch (error.code) {
    case "INVALID_OTP":
      return "Feil kode. Sjekk e-posten og prøv igjen.";
    case "OTP_EXPIRED":
      return "Koden er utløpt. Be om en ny.";
    case "TOO_MANY_ATTEMPTS":
      return "For mange feil forsøk. Be om en ny kode.";
    case "INVALID_EMAIL":
      return "Ugyldig e-postadresse.";
    default:
      return fallback;
  }
}

const isLocalDev = ["localhost", "127.0.0.1"].includes(window.location.hostname);

export function LoginPage() {
  const me = useMe();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (me.data) return <Navigate to="/" replace />;

  async function sendCode(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true);
    setError(null);
    const result = await authClient.emailOtp.sendVerificationOtp({ email: email.trim().toLowerCase(), type: "sign-in" });
    setBusy(false);
    if (result.error) {
      setError(describe(result.error as AuthError, "Kunne ikke sende kode. Prøv igjen."));
      return;
    }
    setCode("");
    setStep("code");
  }

  async function verify(otp: string) {
    setBusy(true);
    setError(null);
    const result = await authClient.signIn.emailOtp({ email: email.trim().toLowerCase(), otp });
    if (result.error) {
      setBusy(false);
      setError(describe(result.error as AuthError, "Innloggingen feilet. Prøv igjen."));
      return;
    }
    await queryClient.invalidateQueries({ queryKey: meQueryKey });
    navigate("/", { replace: true });
  }

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <Wordmark className="text-4xl text-primary-strong" />
          <p className="mt-2 text-muted">Bryggeassistent for Slump Bryggeri</p>
        </div>
        <Card>
          {step === "email" ? (
            <form onSubmit={sendCode} className="space-y-4">
              <h1 className="text-section font-semibold">Logg inn</h1>
              <Field label="E-post" hint="Vi sender deg en engangskode. Ingen passord.">
                {(props) => (
                  <TextInput
                    {...props}
                    type="email"
                    inputMode="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="navn@eksempel.no"
                  />
                )}
              </Field>
              {error && <InlineError>{error}</InlineError>}
              <Button type="submit" variant="primary" size="lg" block loading={busy}>
                Send kode
              </Button>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void verify(code);
              }}
              className="space-y-4"
            >
              <h1 className="text-section font-semibold">Skriv inn koden</h1>
              <p className="text-small text-muted">
                Vi sendte en 6-sifret kode til <strong className="text-text">{email}</strong>.
              </p>
              <Field label="Kode">
                {(props) => (
                  <TextInput
                    {...props}
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    autoFocus
                    value={code}
                    className="text-center text-title tracking-[.4em] tabular"
                    onChange={(e) => {
                      const digits = e.target.value.replace(/\D/g, "").slice(0, 6);
                      setCode(digits);
                      if (digits.length === 6) void verify(digits);
                    }}
                  />
                )}
              </Field>
              {isLocalDev && <p className="text-small text-muted">Lokalt: koden skrives i terminalen der dev-serveren kjører.</p>}
              {error && <InlineError>{error}</InlineError>}
              <Button type="submit" variant="primary" size="lg" block loading={busy} disabled={code.length !== 6}>
                Logg inn
              </Button>
              <div className="flex justify-between gap-2">
                <Button variant="ghost" size="sm" onClick={() => setStep("email")}>
                  Annen e-post
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void sendCode()} disabled={busy}>
                  Send ny kode
                </Button>
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  );
}
