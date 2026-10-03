import { useState } from "react";
import { FolderUp, ArrowRight, LockKeyhole } from "lucide-react";
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
        setMessage("Your account is ready. Sign in to start sharing.");
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
      <div className="auth-story">
        <div className="brand">
          <span className="brand-mark">
            <FolderUp />
          </span>
          <span>
            file share<span className="brand-version">v2</span>
          </span>
        </div>
        <div>
          <span className="eyebrow">A little more organized.</span>
          <h1>
            Your files.
            <br />
            Your space.
          </h1>
          <p>
            A calm home for everything you save.
            <br />
            Collect, find, and share in a few clicks.
          </p>
          <div className="auth-decoration">
            <span />
            <span />
            <span />
            <FolderUp size={64} />
          </div>
        </div>
        <span className="muted">Simple sharing. Thoughtfully built.</span>
      </div>
      <div className="auth-form-wrap">
        <Card className="auth-card">
          <CardContent>
            <div className="auth-heading">
              <LockKeyhole className="text-primary" />
              <h2>{register ? "Make yourself at home" : "Welcome back"}</h2>
              <p className="muted">
                {register
                  ? "Create an account for your files."
                  : "Sign in to your personal file library."}
              </p>
            </div>
            <form onSubmit={submit} noValidate>
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
                    ? "Create account"
                    : "Sign in"}
                <ArrowRight />
              </Button>
            </form>
            <p className="auth-switch muted">
              {register ? "Already have an account?" : "New here?"}{" "}
              <Button
                variant="link"
                onClick={() => {
                  setRegister(!register);
                  setError("");
                  setMessage("");
                  history.replaceState(
                    {},
                    "",
                    register ? "/Login" : "/CreateAccount",
                  );
                }}
              >
                {register ? "Sign in" : "Create account"}
              </Button>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
