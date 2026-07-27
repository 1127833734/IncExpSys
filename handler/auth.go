package handler

import (
	"encoding/json"
	"incomesystem/db"
	"incomesystem/middleware"
	"net/http"
)

// Login 用户登录
func Login(w http.ResponseWriter, r *http.Request) {
	var req db.LoginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "参数错误"})
		return
	}
	if req.WorkNo == "" || req.Password == "" {
		writeJSON(w, 400, map[string]string{"error": "工号和密码不能为空"})
		return
	}

	var user db.User
	err := db.DB.QueryRow(
		"SELECT id, work_no, password, name, role FROM users WHERE work_no=?",
		req.WorkNo,
	).Scan(&user.ID, &user.WorkNo, &user.Password, &user.Name, &user.Role)
	if err != nil {
		writeJSON(w, 401, map[string]string{"error": "工号或密码错误"})
		return
	}
	if user.Password != req.Password {
		writeJSON(w, 401, map[string]string{"error": "工号或密码错误"})
		return
	}

	middleware.CreateSession(w, user.ID, user.WorkNo, user.Name, user.Role)
	writeJSON(w, 200, map[string]interface{}{
		"id":      user.ID,
		"work_no": user.WorkNo,
		"name":    user.Name,
		"role":    user.Role,
	})
}

// Logout 登出
func Logout(w http.ResponseWriter, r *http.Request) {
	middleware.DestroySession(w, r)
	writeJSON(w, 200, map[string]string{"ok": "已登出"})
}

// Me 获取当前用户
func Me(w http.ResponseWriter, r *http.Request) {
	s := middleware.SessionFromCtx(r.Context())
	if s == nil {
		writeJSON(w, 401, map[string]string{"error": "未登录"})
		return
	}
	writeJSON(w, 200, map[string]interface{}{
		"id":      s.UserID,
		"work_no": s.WorkNo,
		"name":    s.Name,
		"role":    s.Role,
	})
}
