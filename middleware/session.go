package middleware

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"log"
	"net/http"
	"sync"
	"time"
)

// Session 会话信息
type Session struct {
	UserID   int       `json:"user_id"`
	WorkNo   string    `json:"work_no"`
	Name     string    `json:"name"`
	Role     string    `json:"role"`
	CreateAt time.Time `json:"create_at"`
}

var (
	sessions   = make(map[string]*Session)
	sessionsMu sync.RWMutex
)

// sessionCookieName cookie 名称
const sessionCookieName = "ies_session"

// generateToken 生成随机 32 字符 token
func generateToken() string {
	b := make([]byte, 16)
	rand.Read(b)
	return hex.EncodeToString(b)
}

// CreateSession 创建会话，写入 cookie
func CreateSession(w http.ResponseWriter, userID int, workNo, name, role string) *Session {
	s := &Session{
		UserID:   userID,
		WorkNo:   workNo,
		Name:     name,
		Role:     role,
		CreateAt: time.Now(),
	}
	token := generateToken()
	sessionsMu.Lock()
	sessions[token] = s
	sessionsMu.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    token,
		Path:     "/",
		HttpOnly: true,
		MaxAge:   86400, // 24小时
		SameSite: http.SameSiteLaxMode,
	})
	return s
}

// DestroySession 销毁会话
func DestroySession(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return
	}
	sessionsMu.Lock()
	delete(sessions, cookie.Value)
	sessionsMu.Unlock()

	http.SetCookie(w, &http.Cookie{
		Name:     sessionCookieName,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
	})
}

// GetSession 从请求中获取会话
func GetSession(r *http.Request) *Session {
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil {
		return nil
	}
	sessionsMu.RLock()
	s := sessions[cookie.Value]
	sessionsMu.RUnlock()
	return s
}

type contextKey string

const sessionKey contextKey = "session"

// RecoveryMiddleware 捕获 panic
func RecoveryMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if err := recover(); err != nil {
				log.Printf("PANIC: %v", err)
				writeJSON(w, 500, map[string]string{"error": "服务器内部错误"})
			}
		}()
		next(w, r)
	}
}

// AuthMiddleware 鉴权中间件：未登录返回 401
func AuthMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s := GetSession(r)
		if s == nil {
			writeJSON(w, http.StatusUnauthorized, map[string]string{"error": "未登录"})
			return
		}
		ctx := context.WithValue(r.Context(), sessionKey, s)
		next(w, r.WithContext(ctx))
	}
}

// AdminMiddleware 管理员鉴权中间件
func AdminMiddleware(next http.HandlerFunc) http.HandlerFunc {
	return AuthMiddleware(func(w http.ResponseWriter, r *http.Request) {
		s, _ := r.Context().Value(sessionKey).(*Session)
		if s == nil || s.Role != "admin" {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "需要管理员权限"})
			return
		}
		next(w, r)
	})
}

// SessionFromCtx 从 context 获取 session（handler 中使用）
func SessionFromCtx(ctx context.Context) *Session {
	s, _ := ctx.Value(sessionKey).(*Session)
	return s
}

func writeJSON(w http.ResponseWriter, status int, v interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(v); err != nil {
		log.Printf("writeJSON error: %v", err)
	}
}
