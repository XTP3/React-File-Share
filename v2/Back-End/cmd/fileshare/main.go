package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/XTP3/React-File-Share/v2/internal/app"
	"github.com/XTP3/React-File-Share/v2/internal/config"
)

var version = "2.0.0"

type portFlag struct{ value *int }

func (p *portFlag) String() string {
	if p.value == nil {
		return ""
	}
	return strconv.Itoa(*p.value)
}
func (p *portFlag) Set(s string) error {
	v, e := strconv.Atoi(s)
	if e != nil {
		return e
	}
	p.value = &v
	return nil
}
func main() {
	if e := run(); e != nil {
		log.Print(e)
		os.Exit(1)
	}
}
func run() error {
	var configPath, uploads, www string
	var hp, sp portFlag
	var showVersion bool
	flag.StringVar(&configPath, "config", "Config.json", "legacy configuration file (created privately only when absent)")
	flag.StringVar(&uploads, "uploads-dir", "", "existing uploads directory")
	flag.StringVar(&www, "www-dir", "", "built SPA directory")
	flag.Var(&hp, "http-port", "HTTP port; 0 disables HTTP")
	flag.Var(&sp, "https-port", "HTTPS port; 0 disables HTTPS")
	flag.BoolVar(&showVersion, "version", false, "print version")
	flag.Parse()
	if showVersion {
		fmt.Println(version)
		return nil
	}
	c, e := config.Load(configPath, config.Overrides{UploadsDir: uploads, WWWDir: www, HTTPPort: hp.value, HTTPSPort: sp.value})
	if e != nil {
		return e
	}
	var tlsServer *http.Server
	if c.HTTPSPort > 0 {
		tc, e := c.TLS()
		if e != nil {
			return fmt.Errorf("TLS configuration: %w", e)
		}
		tlsServer = &http.Server{Addr: fmt.Sprintf(":%d", c.HTTPSPort), TLSConfig: tc}
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	a, e := app.New(ctx, c)
	cancel()
	if e != nil {
		return e
	}
	defer a.Close(context.Background())
	a.Version = version
	handler := a.Handler()
	servers := []*http.Server{}
	errorsCh := make(chan error, 2)
	setup := func(s *http.Server) {
		s.Handler = handler
		s.ReadHeaderTimeout = 10 * time.Second
		s.IdleTimeout = 60 * time.Second
		s.MaxHeaderBytes = 1 << 20
		servers = append(servers, s)
	}
	if c.HTTPPort > 0 {
		s := &http.Server{Addr: fmt.Sprintf(":%d", c.HTTPPort)}
		setup(s)
		go func() {
			log.Printf("React File Share %s HTTP port %d", version, c.HTTPPort)
			errorsCh <- s.ListenAndServe()
		}()
	}
	if tlsServer != nil {
		setup(tlsServer)
		go func() {
			log.Printf("React File Share %s HTTPS port %d", version, c.HTTPSPort)
			errorsCh <- tlsServer.ListenAndServeTLS("", "")
		}()
	}
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	defer signal.Stop(stop)
	select {
	case <-stop:
	case e = <-errorsCh:
		if !errors.Is(e, http.ErrServerClosed) {
			for _, s := range servers {
				s.Close()
			}
			return e
		}
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	for _, s := range servers {
		if e = s.Shutdown(shutdown); e != nil {
			s.Close()
		}
	}
	return nil
}
