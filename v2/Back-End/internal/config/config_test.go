package config

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestLegacyExpiration(t *testing.T) {
	cases := map[string]time.Duration{`1800`: 30 * time.Minute, `"30m"`: 30 * time.Minute, `"2 days"`: 48 * time.Hour, `" 1H "`: time.Hour, `"1000"`: time.Second, `"1 week"`: 7 * 24 * time.Hour, `"500 ms"`: 500 * time.Millisecond}
	for raw, want := range cases {
		got, e := Expiration(json.RawMessage(raw))
		if e != nil || got != want {
			t.Errorf("%s = %s, %v", raw, got, e)
		}
	}
	for _, raw := range []string{`0`, `"garbage"`, `"-1h"`, `"9999999999999999999y"`} {
		if _, e := Expiration(json.RawMessage(raw)); e == nil {
			t.Errorf("accepted %s", raw)
		}
	}
}
func TestLoadPreservesLegacyConfigAndResolvesPaths(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Config.json")
	source := `{"HTTP_PORT":8080,"HTTPS_PORT":0,"PRIVATE_KEY_FILEPATH":"certs/key.pem","DATABASE_URL":"mongodb://localhost/legacy","ACCOUNT_CREATION_CODE":"retained","BCRYPT_SALT_ROUNDS":18,"JWT_SECRET_KEY":"existing-secret","JWT_EXPIRATION":"2 days","MAX_UPLOAD_SIZE":512,"DATE_LANGUAGE":"en-US","DATE_TIMEZONE_REGION":"UTC","unknownLegacyKey":true}`
	if e := os.WriteFile(path, []byte(source), 0600); e != nil {
		t.Fatal(e)
	}
	c, e := Load(path, Overrides{})
	if e != nil {
		t.Fatal(e)
	}
	if c.JWTSecretKey != "existing-secret" || c.MaxUploadSize != 512 || c.BcryptSaltRounds != 18 || c.PrivateKeyFilepath != filepath.Join(filepath.Dir(path), "certs/key.pem") || c.UploadsDir != filepath.Join(filepath.Dir(path), "uploads") {
		t.Fatalf("legacy configuration changed: %+v", c)
	}
	b, e := os.ReadFile(path)
	if e != nil {
		t.Fatal(e)
	}
	if string(b) != source {
		t.Fatal("existing config was rewritten")
	}
}
func TestMissingConfigIsPrivateAndReusable(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Config.json")
	first, e := Load(path, Overrides{})
	if e != nil {
		t.Fatal(e)
	}
	second, e := Load(path, Overrides{})
	if e != nil {
		t.Fatal(e)
	}
	if first.JWTSecretKey == "" || first.JWTSecretKey != second.JWTSecretKey || first.AccountCreationCode != second.AccountCreationCode {
		t.Fatal("default secrets are not reusable")
	}
}
