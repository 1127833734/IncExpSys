package handler

import (
	"encoding/json"
	"incomesystem/db"
	"incomesystem/middleware"
	"net/http"
	"strconv"
	"time"
)

// GetExpenseCategories 获取所有支出分类
func GetExpenseCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := db.DB.Query(
		"SELECT id, name, sort_order FROM expense_categories WHERE is_active=1 ORDER BY sort_order",
	)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "查询失败"})
		return
	}
	defer rows.Close()

	type Category struct {
		ID        int    `json:"id"`
		Name      string `json:"name"`
		SortOrder int    `json:"sort_order"`
	}
	var categories []Category
	for rows.Next() {
		var c Category
		rows.Scan(&c.ID, &c.Name, &c.SortOrder)
		categories = append(categories, c)
	}
	if categories == nil {
		categories = []Category{}
	}
	writeJSON(w, 200, categories)
}

// CreateExpense 录入支出
func CreateExpense(w http.ResponseWriter, r *http.Request) {
	var req db.ExpenseRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "参数错误"})
		return
	}
	if req.CategoryID == 0 || req.Amount <= 0 || req.RecordDate == "" {
		writeJSON(w, 400, map[string]string{"error": "分类、金额和日期不能为空"})
		return
	}

	s := middleware.SessionFromCtx(r.Context())
	_, err := db.DB.Exec(
		"INSERT INTO expense_records (category_id, amount, record_date, notes, created_by) VALUES (?,?,?,?,?)",
		req.CategoryID, req.Amount, req.RecordDate, req.Notes, s.UserID,
	)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "录入失败"})
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "录入成功"})
}

// GetTodayExpense 获取今日支出记录
func GetTodayExpense(w http.ResponseWriter, r *http.Request) {
	date := r.URL.Query().Get("date")
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}

	rows, err := db.DB.Query(
		`SELECT r.id, r.category_id, c.name, r.amount, r.record_date, r.notes, u.name, r.created_at
		 FROM expense_records r
		 JOIN expense_categories c ON r.category_id = c.id
		 JOIN users u ON r.created_by = u.id
		 WHERE r.record_date = ?
		 ORDER BY r.id DESC`,
		date,
	)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "查询失败"})
		return
	}
	defer rows.Close()

	var records []db.ExpenseRecord
	for rows.Next() {
		var rec db.ExpenseRecord
		rows.Scan(&rec.ID, &rec.CategoryID, &rec.CategoryName, &rec.Amount, &rec.RecordDate, &rec.Notes, &rec.CreatedBy, &rec.CreatedAt)
		records = append(records, rec)
	}
	if records == nil {
		records = []db.ExpenseRecord{}
	}

	var total float64
	db.DB.QueryRow("SELECT COALESCE(SUM(amount),0) FROM expense_records WHERE record_date=?", date).Scan(&total)

	writeJSON(w, 200, map[string]interface{}{
		"records": records,
		"total":   total,
	})
}

// DeleteExpense 删除一条支出记录
func DeleteExpense(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "无效的ID"})
		return
	}
	_, err = db.DB.Exec("DELETE FROM expense_records WHERE id=?", id)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "删除失败"})
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "已删除"})
}
