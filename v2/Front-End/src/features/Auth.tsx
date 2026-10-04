import { useState } from "react";
import { Logo } from "@/components/Logo";
import "./auth.css";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { api } from "@/lib/api";
import type { Session } from "@/lib/types";
export function Auth({ onLogin }: { onLogin: (s: Session) => void }) {
  const [register, setRegister] = useState(
    location.pathname.toLowerCase().includes("createaccount") ||
      location.pathname === "/ca",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");
    setMessage("");
    setBusy(true);
    const data = new FormData(e.currentTarget);
    const username = String(data.get("username"));
    const password = String(data.get("password"));
    try {
      if (!username || !password)
        throw Error("Enter your username and password.");
      if (register) {
        if (password !== data.get("repeatPassword"))
          throw Error("The passwords do not match.");
        await api("/auth/register", {
          method: "POST",
          body: JSON.stringify({
            username,
            password,
            creationCode: data.get("creationCode"),
          }),
        });
        setRegister(false);
        setMessage("Your account is ready. Login to start sharing.");
      } else
        onLogin(
          await api<Session>("/auth/login", {
            method: "POST",
            body: JSON.stringify({ username, password }),
          }),
        );
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="auth-layout">
      <Card className="auth-card">
        <CardContent>
          <div className="auth-heading">
            <Logo size={80} />
          </div>
          <form
            aria-label={register ? "Create Account" : "Login"}
            onSubmit={submit}
            noValidate
          >
            {error && (
              <Alert variant="destructive">
                <AlertDescription role="alert">{error}</AlertDescription>
              </Alert>
            )}
            {message && (
              <Alert>
                <AlertDescription role="status">{message}</AlertDescription>
              </Alert>
            )}
            <div className="field">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                required
                maxLength={128}
                placeholder="Your username"
              />
            </div>
            <div className="field">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                placeholder="Your password"
              />
            </div>
            {register && (
              <>
                <div className="field">
                  <Label htmlFor="repeatPassword">Confirm password</Label>
                  <Input
                    id="repeatPassword"
                    name="repeatPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                  />
                </div>
                <div className="field">
                  <Label htmlFor="creationCode">Account creation code</Label>
                  <Input
                    id="creationCode"
                    name="creationCode"
                    autoComplete="off"
                    required
                    placeholder="Provided by your administrator"
                  />
                </div>
              </>
            )}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy
                ? "Please wait…"
                : register
                  ? "Create Account"
                  : "Login"}
            </Button>
          </form>
          {register && (
            <p className="auth-switch muted">
              Already have an account?{" "}
              <Button
                variant="link"
                onClick={() => {
                  setRegister(false);
                  setError("");
                  setMessage("");
                  history.replaceState({}, "", "/Login");
                }}
              >
                Login
              </Button>
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
