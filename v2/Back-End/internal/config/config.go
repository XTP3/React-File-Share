// Package config reads the original v1 configuration without migrating it.
package config

import (
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"encoding/hex"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
	_ "time/tzdata"

	"github.com/youmark/pkcs8"
)

type Config struct {
	HTTPPort            int             `json:"HTTP_PORT"`
	HTTPSPort           int             `json:"HTTPS_PORT"`
	PrivateKeyFilepath  string          `json:"PRIVATE_KEY_FILEPATH"`
	CertificateFilepath string          `json:"CERTIFICATE_FILEPATH"`
	CACertFilepath      string          `json:"CA_CERT_FILEPATH"`
	PEMPassphrase       string          `json:"PEM_PASSPHRASE"`
	DatabaseURL         string          `json:"DATABASE_URL"`
	AccountCreationCode string          `json:"ACCOUNT_CREATION_CODE"`
	BcryptSaltRounds    int             `json:"BCRYPT_SALT_ROUNDS"`
	JWTSecretKey        string          `json:"JWT_SECRET_KEY"`
	JWTExpiration       json.RawMessage `json:"JWT_EXPIRATION"`
	MaxUploadSize       int64           `json:"MAX_UPLOAD_SIZE"`
	DateLanguage        string          `json:"DATE_LANGUAGE"`
	DateTimezoneRegion  string          `json:"DATE_TIMEZONE_REGION"`
	UploadsDir          string          `json:"UPLOADS_DIR,omitempty"`
	WWWDir              string          `json:"WWW_DIR,omitempty"`
	SecureCookies       bool            `json:"SECURE_COOKIES,omitempty"`
	AllowedOrigins      []string        `json:"ALLOWED_ORIGINS,omitempty"`
	SessionDuration     time.Duration   `json:"-"`
}

type Overrides struct {
	UploadsDir, WWWDir  string
	HTTPPort, HTTPSPort *int
}

func Default() Config {
	return Config{HTTPPort: 8080, DatabaseURL: "mongodb://127.0.0.1:27017/ReactFileShare", BcryptSaltRounds: 10, JWTExpiration: json.RawMessage(`"30m"`), MaxUploadSize: 10 << 30, DateLanguage: "en-US", DateTimezoneRegion: "UTC"}
}

// Load creates a private development configuration only if the selected file
// does not exist. O_EXCL prevents replacing somebody else's secrets.
func Load(path string, o Overrides) (Config, error) {
	c := Default()
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		secret := make([]byte, 32)
		if _, err = rand.Read(secret); err != nil {
			return c, err
		}
		c.JWTSecretKey = hex.EncodeToString(secret)
		if _, err = rand.Read(secret); err != nil {
			return c, err
		}
		c.AccountCreationCode = hex.EncodeToString(secret)
		b, err = json.MarshalIndent(c, "", "  ")
		if err != nil {
			return c, err
		}
		f, e := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
		if errors.Is(e, os.ErrExist) {
			b, err = os.ReadFile(path)
		} else if e != nil {
			return c, e
		} else {
			_, e = f.Write(b)
			if e == nil {
				e = f.Sync()
			}
			f.Close()
			if e != nil {
				return c, e
			}
		}
	}
	if err != nil {
		return c, err
	}
	if err = json.Unmarshal(b, &c); err != nil {
		return c, fmt.Errorf("configuration: %w", err)
	}
	base, err := filepath.Abs(filepath.Dir(path))
	if err != nil {
		return c, err
	}
	resolve := func(p string) string {
		if p != "" && !filepath.IsAbs(p) {
			return filepath.Join(base, p)
		}
		return p
	}
	c.PrivateKeyFilepath = resolve(c.PrivateKeyFilepath)
	c.CertificateFilepath = resolve(c.CertificateFilepath)
	c.CACertFilepath = resolve(c.CACertFilepath)
	if o.UploadsDir != "" {
		c.UploadsDir = o.UploadsDir
	}
	if c.UploadsDir == "" {
		c.UploadsDir = "uploads"
	}
	c.UploadsDir = resolve(c.UploadsDir)
	if o.WWWDir != "" {
		c.WWWDir = o.WWWDir
	}
	if c.WWWDir == "" {
		c.WWWDir = "www"
	}
	c.WWWDir = resolve(c.WWWDir)
	if o.HTTPPort != nil {
		c.HTTPPort = *o.HTTPPort
	}
	if o.HTTPSPort != nil {
		c.HTTPSPort = *o.HTTPSPort
	}
	if c.HTTPPort < 0 || c.HTTPPort > 65535 || c.HTTPSPort < 0 || c.HTTPSPort > 65535 {
		return c, errors.New("port must be between 0 (disabled) and 65535")
	}
	if c.HTTPPort == 0 && c.HTTPSPort == 0 {
		return c, errors.New("at least one listener must be enabled")
	}
	if c.JWTSecretKey == "" || c.AccountCreationCode == "" || c.DatabaseURL == "" {
		return c, errors.New("database, JWT secret, and account creation code are required")
	}
	for i, origin := range c.AllowedOrigins {
		origin = strings.TrimSuffix(strings.TrimSpace(origin), "/")
		u, e := url.Parse(origin)
		if e != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" || u.Path != "" || u.RawQuery != "" || u.Fragment != "" || u.User != nil {
			return c, errors.New("ALLOWED_ORIGINS must contain explicit HTTP(S) origins")
		}
		c.AllowedOrigins[i] = origin
	}
	if c.MaxUploadSize < 1 || c.BcryptSaltRounds < 4 || c.BcryptSaltRounds > 31 {
		return c, errors.New("invalid upload limit or bcrypt rounds (4–31)")
	}
	if _, err = time.LoadLocation(c.DateTimezoneRegion); err != nil {
		return c, fmt.Errorf("time zone: %w", err)
	}
	c.SessionDuration, err = Expiration(c.JWTExpiration)
	return c, err
}

// Expiration matches jsonwebtoken's numeric seconds and ms-style strings.
func Expiration(raw json.RawMessage) (time.Duration, error) {
	var n float64
	if json.Unmarshal(raw, &n) == nil && n > 0 && n <= 3155760000 {
		return time.Duration(n * float64(time.Second)), nil
	}
	var s string
	if json.Unmarshal(raw, &s) != nil {
		return 0, errors.New("invalid JWT_EXPIRATION")
	}
	pattern := regexp.MustCompile(`(?i)^([0-9]+(?:\.[0-9]+)?)\s*(milliseconds?|msecs?|ms|seconds?|secs?|s|minutes?|mins?|m|hours?|hrs?|h|days?|d|weeks?|w|years?|yrs?|y)?$`)
	match := pattern.FindStringSubmatch(strings.TrimSpace(s))
	if match == nil {
		return 0, errors.New("unsupported JWT_EXPIRATION")
	}
	n, e := strconv.ParseFloat(match[1], 64)
	if e != nil || n <= 0 {
		return 0, errors.New("invalid JWT_EXPIRATION")
	}
	unit := strings.ToLower(match[2])
	factor := time.Millisecond
	switch {
	case unit == "" || unit == "ms" || strings.HasPrefix(unit, "msec") || strings.HasPrefix(unit, "millisecond"):
		factor = time.Millisecond
	case unit == "s" || strings.HasPrefix(unit, "sec"):
		factor = time.Second
	case unit == "m" || strings.HasPrefix(unit, "min"):
		factor = time.Minute
	case unit == "h" || strings.HasPrefix(unit, "hour") || strings.HasPrefix(unit, "hr"):
		factor = time.Hour
	case unit == "d" || strings.HasPrefix(unit, "day"):
		factor = 24 * time.Hour
	case unit == "w" || strings.HasPrefix(unit, "week"):
		factor = 7 * 24 * time.Hour
	case unit == "y" || strings.HasPrefix(unit, "year") || strings.HasPrefix(unit, "yr"):
		factor = time.Duration(float64(365.25*24) * float64(time.Hour))
	}
	value := n * float64(factor)
	if value <= 0 || value > float64(int64(^uint64(0)>>1)) {
		return 0, errors.New("JWT_EXPIRATION is out of range")
	}
	return time.Duration(value), nil
}

func (c Config) TLS() (*tls.Config, error) {
	key, err := os.ReadFile(c.PrivateKeyFilepath)
	if err != nil {
		return nil, err
	}
	cert, err := os.ReadFile(c.CertificateFilepath)
	if err != nil {
		return nil, err
	}
	block, _ := pem.Decode(key)
	if block == nil {
		return nil, errors.New("invalid private key PEM")
	}
	if x509.IsEncryptedPEMBlock(block) {
		der, e := x509.DecryptPEMBlock(block, []byte(c.PEMPassphrase))
		if e != nil {
			return nil, e
		}
		key = pem.EncodeToMemory(&pem.Block{Type: block.Type, Bytes: der})
	} else if block.Type == "ENCRYPTED PRIVATE KEY" {
		k, e := pkcs8.ParsePKCS8PrivateKey(block.Bytes, []byte(c.PEMPassphrase))
		if e != nil {
			return nil, e
		}
		der, e := x509.MarshalPKCS8PrivateKey(k)
		if e != nil {
			return nil, e
		}
		key = pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: der})
	}
	if c.CACertFilepath != "" {
		chain, e := os.ReadFile(c.CACertFilepath)
		if e != nil {
			return nil, e
		}
		cert = append(append(cert, '\n'), chain...)
	}
	pair, err := tls.X509KeyPair(cert, key)
	if err != nil {
		return nil, err
	}
	return &tls.Config{Certificates: []tls.Certificate{pair}, MinVersion: tls.VersionTLS12}, nil
}
