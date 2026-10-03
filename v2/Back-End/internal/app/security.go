package app

import (
	"mime"
	"net"
	"net/http"
	"time"
)

type rateEntry struct {
	tokens  float64
	updated time.Time
}

func (a *App) originAllowed(r *http.Request) bool {
	origin := r.Header.Get("Origin")
	if origin == "" {
		return true
	}
	scheme := "http"
	if r.TLS != nil || a.Config.SecureCookies {
		scheme = "https"
	}
	if origin == scheme+"://"+r.Host {
		return true
	}
	for _, allowed := range a.Config.AllowedOrigins {
		if origin == allowed {
			return true
		}
	}
	return false
}
func (a *App) security(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if origin != "" {
			if !a.originAllowed(r) {
				fail(w, 403, "request origin is not allowed")
				return
			}
			w.Header().Add("Vary", "Origin")
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		if r.Method == "OPTIONS" {
			w.Header().Set("Access-Control-Allow-Methods", "GET, HEAD, POST, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type, X-CSRF-Token")
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(204)
			return
		}
		path := r.URL.Path
		register := path == "/api/v2/auth/register" || path == "/api/account/create"
		login := path == "/api/v2/auth/login" || path == "/api/authentication/login"
		if r.Method == "POST" && (register || login) {
			typ, _, e := mime.ParseMediaType(r.Header.Get("Content-Type"))
			if e != nil || typ != "application/json" {
				fail(w, 415, "authentication requests require application/json")
				return
			}
			key, _, e := net.SplitHostPort(r.RemoteAddr)
			if e != nil {
				key = r.RemoteAddr
			}
			capacity := 30.0
			if register {
				key = "register:" + key
				capacity = 10
			} else {
				key = "login:" + key
			}
			if !a.allowRate(key, capacity) {
				w.Header().Set("Retry-After", "60")
				fail(w, 429, "too many authentication attempts; try again shortly")
				return
			}
		}
		next.ServeHTTP(w, r)
	})
}
func (a *App) allowRate(key string, capacity float64) bool {
	a.rateMu.Lock()
	defer a.rateMu.Unlock()
	now := time.Now()
	entry, found := a.rates[key]
	if !found {
		if len(a.rates) >= 10000 {
			for k, v := range a.rates {
				if now.Sub(v.updated) > 5*time.Minute {
					delete(a.rates, k)
				}
			}
		}
		if len(a.rates) >= 10000 {
			return false
		}
		entry = rateEntry{tokens: capacity, updated: now}
	}
	entry.tokens += now.Sub(entry.updated).Seconds() * capacity / 60
	if entry.tokens > capacity {
		entry.tokens = capacity
	}
	entry.updated = now
	allowed := entry.tokens >= 1
	if allowed {
		entry.tokens--
	}
	a.rates[key] = entry
	return allowed
}
