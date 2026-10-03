package app

import (
	"context"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"go.mongodb.org/mongo-driver/v2/bson"
	"go.mongodb.org/mongo-driver/v2/mongo"
	"golang.org/x/crypto/bcrypt"
)

const cookieName = "rfs_session"

type identity struct {
	Owner, Token, Session string
	Cookie                bool
}
type identityKey struct{}

func who(r *http.Request) identity { return r.Context().Value(identityKey{}).(identity) }
func randomID(n int) string {
	b := make([]byte, n)
	if _, e := rand.Read(b); e != nil {
		panic(e)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func passwordBytes(s string) []byte {
	b := []byte(s)
	if len(b) > 72 {
		b = b[:72]
	}
	return b
}
func (a *App) csrf(token string) string {
	h := hmac.New(sha256.New, []byte(a.Config.JWTSecretKey))
	h.Write([]byte("csrf:" + token))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}
func (a *App) private(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		id := identity{}
		header := r.Header.Get("Authorization")
		if header != "" {
			parts := strings.Fields(header)
			if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") {
				fail(w, 401, "invalid authorization")
				return
			}
			id.Token = parts[1]
		} else if c, e := r.Cookie(cookieName); e == nil {
			id.Token = c.Value
			id.Cookie = true
		}
		if id.Token == "" {
			status := 401
			if !strings.HasPrefix(r.URL.Path, "/api/v2/") {
				status = 400
			}
			fail(w, status, "authentication required")
			return
		}
		claims := jwt.MapClaims{}
		token, e := jwt.ParseWithClaims(id.Token, claims, func(t *jwt.Token) (any, error) { return []byte(a.Config.JWTSecretKey), nil }, jwt.WithValidMethods([]string{"HS256"}))
		if e != nil || !token.Valid {
			fail(w, 401, "expired or invalid authentication")
			return
		}
		id.Owner, _ = claims["uniqueID"].(string)
		if !safeName(id.Owner) {
			fail(w, 401, "invalid account identity")
			return
		}
		id.Session, _ = claims["sid"].(string)
		if id.Cookie || id.Session != "" {
			if id.Session == "" {
				fail(w, 401, "invalid session")
				return
			}
			n, e := a.DB.Collection("sessions").CountDocuments(r.Context(), bson.M{"_id": id.Session, "ownerID": id.Owner, "expiresAt": bson.M{"$gt": time.Now()}})
			if e != nil {
				fail(w, 503, "authentication storage unavailable")
				return
			}
			if n == 0 {
				fail(w, 401, "session expired")
				return
			}
			if id.Cookie && r.Method != "GET" && r.Method != "HEAD" && r.Method != "OPTIONS" {
				expected := a.csrf(id.Token)
				if subtle.ConstantTimeCompare([]byte(expected), []byte(r.Header.Get("X-CSRF-Token"))) != 1 {
					fail(w, 403, "invalid CSRF token")
					return
				}
			}
		}
		next(w, r.WithContext(context.WithValue(r.Context(), identityKey{}, id)))
	}
}
func (a *App) register(w http.ResponseWriter, r *http.Request) {
	var body struct{ Username, Password, CreationCode string }
	if !decode(w, r, &body) {
		return
	}
	if subtle.ConstantTimeCompare([]byte(body.CreationCode), []byte(a.Config.AccountCreationCode)) != 1 {
		fail(w, 400, "incorrect account creation code")
		return
	}
	if strings.TrimSpace(body.Username) == "" || len(body.Username) > 200 || body.Password == "" {
		fail(w, 400, "username and password are required")
		return
	}
	a.mutation.Lock()
	defer a.mutation.Unlock()
	n, e := a.DB.Collection("users").CountDocuments(r.Context(), bson.M{"username": body.Username})
	if e != nil {
		fail(w, 503, "database unavailable")
		return
	}
	if n > 0 {
		fail(w, 409, "username already exists")
		return
	}
	hash, e := bcrypt.GenerateFromPassword(passwordBytes(body.Password), a.Config.BcryptSaltRounds)
	if e != nil {
		fail(w, 500, "password hashing failed")
		return
	}
	id := randomID(16)
	if e = a.root.Mkdir(id, 0700); e != nil {
		fail(w, 500, "account storage could not be created")
		return
	}
	if e = syncDir(a.root, "."); e != nil {
		a.root.Remove(id)
		fail(w, 500, "account directory sync failed")
		return
	}
	_, e = a.DB.Collection("users").InsertOne(r.Context(), bson.M{"_id": bson.NewObjectID(), "uniqueID": id, "username": body.Username, "password": string(hash), "timeOfCreation": float64(time.Now().UnixMilli()), "__v": int32(0)})
	if e != nil {
		a.root.Remove(id)
		fail(w, 503, "account could not be saved")
		return
	}
	ok(w, 201)
}
func (a *App) login(w http.ResponseWriter, r *http.Request) {
	var body struct{ Username, Password string }
	if !decode(w, r, &body) {
		return
	}
	var user bson.M
	e := a.DB.Collection("users").FindOne(r.Context(), bson.M{"username": body.Username}).Decode(&user)
	if e != nil {
		if !errors.Is(e, mongo.ErrNoDocuments) {
			fail(w, 503, "database unavailable")
			return
		}
		fail(w, 401, "incorrect username or password")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(str(user, "password")), passwordBytes(body.Password)) != nil {
		fail(w, 401, "incorrect username or password")
		return
	}
	uid := str(user, "uniqueID")
	if !safeName(uid) {
		fail(w, 500, "invalid account storage identity")
		return
	}
	now := time.Now()
	exp := now.Add(a.Config.SessionDuration)
	claims := jwt.MapClaims{"uniqueID": uid, "iat": now.Unix(), "exp": exp.Unix()}
	legacy := !strings.HasPrefix(r.URL.Path, "/api/v2/")
	sid := ""
	if !legacy {
		sid = randomID(24)
		claims["sid"] = sid
	}
	token, e := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(a.Config.JWTSecretKey))
	if e != nil {
		fail(w, 500, "login failed")
		return
	}
	if legacy {
		reply(w, 200, map[string]string{"token": token})
		return
	}
	_, e = a.DB.Collection("sessions").InsertOne(r.Context(), bson.M{"_id": sid, "ownerID": uid, "expiresAt": exp})
	if e != nil {
		fail(w, 503, "session could not be saved")
		return
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: token, Path: "/", HttpOnly: true, Secure: r.TLS != nil || a.Config.SecureCookies, SameSite: http.SameSiteLaxMode, Expires: exp, MaxAge: int(a.Config.SessionDuration.Seconds())})
	reply(w, 200, map[string]any{"user": map[string]string{"uniqueID": uid, "username": str(user, "username")}, "csrfToken": a.csrf(token)})
}
func (a *App) token(w http.ResponseWriter, r *http.Request) { ok(w, 200) }
func (a *App) me(w http.ResponseWriter, r *http.Request) {
	id := who(r)
	var user bson.M
	e := a.DB.Collection("users").FindOne(r.Context(), bson.M{"uniqueID": id.Owner}).Decode(&user)
	if e != nil {
		fail(w, 401, "account unavailable")
		return
	}
	reply(w, 200, map[string]any{"user": map[string]string{"uniqueID": id.Owner, "username": str(user, "username")}, "csrfToken": a.csrf(id.Token)})
}
func (a *App) clearCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: cookieName, Value: "", Path: "/", HttpOnly: true, Secure: r.TLS != nil || a.Config.SecureCookies, SameSite: http.SameSiteLaxMode, MaxAge: -1, Expires: time.Unix(1, 0)})
}
func (a *App) logout(w http.ResponseWriter, r *http.Request) {
	id := who(r)
	if id.Session != "" {
		if _, e := a.DB.Collection("sessions").DeleteOne(r.Context(), bson.M{"_id": id.Session}); e != nil {
			fail(w, 503, "logout could not be saved")
			return
		}
	}
	a.clearCookie(w, r)
	ok(w, 200)
}
func (a *App) password(w http.ResponseWriter, r *http.Request) {
	var body struct{ ToChange, CurrentPassword, NewPassword string }
	if !decode(w, r, &body) {
		return
	}
	if !strings.HasPrefix(r.URL.Path, "/api/v2/") && body.ToChange != "password" {
		fail(w, 400, "unsupported account change")
		return
	}
	if body.NewPassword == "" {
		fail(w, 400, "invalid password")
		return
	}
	id := who(r)
	var user bson.M
	e := a.DB.Collection("users").FindOne(r.Context(), bson.M{"uniqueID": id.Owner}).Decode(&user)
	if e != nil {
		fail(w, 401, "account unavailable")
		return
	}
	if bcrypt.CompareHashAndPassword([]byte(str(user, "password")), passwordBytes(body.CurrentPassword)) != nil {
		fail(w, 400, "incorrect current password")
		return
	}
	hash, e := bcrypt.GenerateFromPassword(passwordBytes(body.NewPassword), a.Config.BcryptSaltRounds)
	if e != nil {
		fail(w, 500, "password hashing failed")
		return
	}
	result, e := a.DB.Collection("users").UpdateOne(r.Context(), bson.M{"_id": user["_id"], "password": user["password"]}, bson.M{"$set": bson.M{"password": string(hash)}})
	if e != nil {
		fail(w, 503, "password could not be saved")
		return
	}
	if result.MatchedCount == 0 {
		fail(w, 409, "password changed; sign in again")
		return
	}
	if _, e = a.DB.Collection("sessions").DeleteMany(r.Context(), bson.M{"ownerID": id.Owner}); e != nil {
		fail(w, 503, "password updated; session cleanup pending")
		return
	}
	a.clearCookie(w, r)
	ok(w, 200)
}
