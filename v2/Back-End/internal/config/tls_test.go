package config

import (
	"crypto/rand"
	"crypto/rsa"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"math/big"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/youmark/pkcs8"
)

func TestLegacyEncryptedTLSKeyAndChain(t *testing.T) {
	key, e := rsa.GenerateKey(rand.Reader, 2048)
	if e != nil {
		t.Fatal(e)
	}
	now := time.Now()
	template := &x509.Certificate{SerialNumber: big.NewInt(1), Subject: pkix.Name{CommonName: "localhost"}, DNSNames: []string{"localhost"}, NotBefore: now.Add(-time.Hour), NotAfter: now.Add(time.Hour), KeyUsage: x509.KeyUsageDigitalSignature | x509.KeyUsageKeyEncipherment}
	der, e := x509.CreateCertificate(rand.Reader, template, template, &key.PublicKey, key)
	if e != nil {
		t.Fatal(e)
	}
	dir := t.TempDir()
	certPath, chainPath, keyPath := filepath.Join(dir, "cert.pem"), filepath.Join(dir, "chain.pem"), filepath.Join(dir, "key.pem")
	cert := pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der})
	if e = os.WriteFile(certPath, cert, 0600); e != nil {
		t.Fatal(e)
	}
	if e = os.WriteFile(chainPath, cert, 0600); e != nil {
		t.Fatal(e)
	}
	legacy, e := x509.EncryptPEMBlock(rand.Reader, "RSA PRIVATE KEY", x509.MarshalPKCS1PrivateKey(key), []byte("synthetic-password"), x509.PEMCipherAES256)
	if e != nil {
		t.Fatal(e)
	}
	modern, e := pkcs8.MarshalPrivateKey(key, []byte("synthetic-password"), nil)
	if e != nil {
		t.Fatal(e)
	}
	for _, block := range []*pem.Block{legacy, {Type: "ENCRYPTED PRIVATE KEY", Bytes: modern}} {
		if e = os.WriteFile(keyPath, pem.EncodeToMemory(block), 0600); e != nil {
			t.Fatal(e)
		}
		c := Config{PrivateKeyFilepath: keyPath, CertificateFilepath: certPath, CACertFilepath: chainPath, PEMPassphrase: "synthetic-password"}
		tlsConfig, e := c.TLS()
		if e != nil {
			t.Fatal(e)
		}
		if len(tlsConfig.Certificates) != 1 || len(tlsConfig.Certificates[0].Certificate) != 2 {
			t.Fatal("TLS chain was not retained")
		}
		c.PEMPassphrase = "wrong"
		if _, e = c.TLS(); e == nil {
			t.Fatal("incorrect passphrase accepted")
		}
	}
}
