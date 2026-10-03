import { useEffect, useState } from "react";
import { WifiOff, Download, RefreshCw } from "lucide-react";
import { useRegisterSW } from "virtual:pwa-register/react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
interface InstallPrompt extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
}
export function Connection({ uploading }: { uploading: boolean }) {
  const [online, setOnline] = useState(navigator.onLine);
  const [install, setInstall] = useState<InstallPrompt>();
  const {
    needRefresh: [refresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError: () => {
      /* shell remains usable if registration is blocked */
    },
  });
  useEffect(() => {
    const yes = () => setOnline(true),
      no = () => setOnline(false),
      prompt = (e: Event) => {
        e.preventDefault();
        setInstall(e as InstallPrompt);
      };
    window.addEventListener("online", yes);
    window.addEventListener("offline", no);
    window.addEventListener("beforeinstallprompt", prompt);
    return () => {
      window.removeEventListener("online", yes);
      window.removeEventListener("offline", no);
      window.removeEventListener("beforeinstallprompt", prompt);
    };
  }, []);
  return (
    <div className="connection-feedback">
      {!online && (
        <Alert>
          <WifiOff />
          <AlertDescription role="status">
            You are offline. Your app is available; file transfers and account
            changes need a connection.
          </AlertDescription>
        </Alert>
      )}
      {refresh && (
        <Alert>
          <RefreshCw />
          <AlertDescription role="status">
            <span>
              {uploading
                ? "An update is ready. Finish your uploads before updating."
                : "A fresh version is ready."}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={uploading}
              onClick={() => updateServiceWorker(true)}
            >
              Update app
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {install && (
        <Button
          variant="outline"
          size="sm"
          className="install-button"
          onClick={async () => {
            await install.prompt();
            await install.userChoice;
            setInstall(undefined);
          }}
        >
          <Download />
          Install app
        </Button>
      )}
    </div>
  );
}
