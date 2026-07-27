package handler

import (
	"encoding/json"
	"fmt"
	"incomesystem/db"
	"incomesystem/middleware"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// GetIncomeCategories 获取所有收入分类
func GetIncomeCategories(w http.ResponseWriter, r *http.Request) {
	rows, err := db.DB.Query(
		"SELECT id, name, type, sort_order FROM income_categories WHERE is_active=1 ORDER BY type, sort_order",
	)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "查询失败"})
		return
	}
	defer rows.Close()

	type Category struct {
		ID        int    `json:"id"`
		Name      string `json:"name"`
		Type      string `json:"type"`
		SortOrder int    `json:"sort_order"`
	}
	var categories []Category
	for rows.Next() {
		var c Category
		rows.Scan(&c.ID, &c.Name, &c.Type, &c.SortOrder)
		categories = append(categories, c)
	}
	if categories == nil {
		categories = []Category{}
	}
	writeJSON(w, 200, categories)
}

// CreateIncome 录入收入
func CreateIncome(w http.ResponseWriter, r *http.Request) {
	var req db.IncomeRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeJSON(w, 400, map[string]string{"error": "参数错误"})
		return
	}
	if req.CategoryID == 0 || req.Amount <= 0 || req.RecordDate == "" {
		writeJSON(w, 400, map[string]string{"error": "分类、金额和日期不能为空"})
		return
	}
	if req.PaymentMethod == "" {
		req.PaymentMethod = "现金"
	}

	s := middleware.SessionFromCtx(r.Context())

	// 查询分类类型，判断是否生成单号
	var catType string
	db.DB.QueryRow("SELECT type FROM income_categories WHERE id=?", req.CategoryID).Scan(&catType)

	var orderNo string
	if catType == "开单" {
		// 在事务中生成单号
		tx, err := db.DB.Begin()
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "事务开启失败"})
			return
		}
		defer tx.Rollback()

		// 查当天最大单号
		var lastNo string
		tx.QueryRow(
			"SELECT order_no FROM income_records WHERE record_date=? AND order_no!='' ORDER BY id DESC LIMIT 1",
			req.RecordDate,
		).Scan(&lastNo)

		seq := 1
		if lastNo != "" {
			// 从 "20250115-003" 中提取序号
			parts := strings.Split(lastNo, "-")
			if len(parts) == 2 {
				seq, _ = strconv.Atoi(parts[1])
				seq++
			}
		}

		// 生成单号：取 record_date 的日期部分（替换 "-" 为空）
		dateStr := strings.ReplaceAll(req.RecordDate, "-", "")
		orderNo = fmt.Sprintf("%s-%03d", dateStr, seq)

		_, err = tx.Exec(
			"INSERT INTO income_records (order_no, category_id, amount, payment_method, record_date, notes, created_by) VALUES (?,?,?,?,?,?,?)",
			orderNo, req.CategoryID, req.Amount, req.PaymentMethod, req.RecordDate, req.Notes, s.UserID,
		)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "录入失败"})
			return
		}
		tx.Commit()
	} else {
		_, err := db.DB.Exec(
			"INSERT INTO income_records (order_no, category_id, amount, payment_method, record_date, notes, created_by) VALUES ('',?,?,?,?,?,?)",
			req.CategoryID, req.Amount, req.PaymentMethod, req.RecordDate, req.Notes, s.UserID,
		)
		if err != nil {
			writeJSON(w, 500, map[string]string{"error": "录入失败"})
			return
		}
	}

	result := map[string]interface{}{
		"ok":       true,
		"order_no": orderNo,
	}
	writeJSON(w, 200, result)
}

// GetTodayIncome 获取今日收入记录
func GetTodayIncome(w http.ResponseWriter, r *http.Request) {
	date := r.URL.Query().Get("date")
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}

	rows, err := db.DB.Query(
		`SELECT r.id, r.order_no, r.category_id, c.name, c.type,
		        r.amount, r.payment_method, r.record_date, r.notes, u.name, r.created_at
		 FROM income_records r
		 JOIN income_categories c ON r.category_id = c.id
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

	var records []db.IncomeRecord
	for rows.Next() {
		var rec db.IncomeRecord
		rows.Scan(&rec.ID, &rec.OrderNo, &rec.CategoryID, &rec.CategoryName, &rec.Type,
			&rec.Amount, &rec.PaymentMethod, &rec.RecordDate, &rec.Notes, &rec.CreatedBy, &rec.CreatedAt)
		records = append(records, rec)
	}
	if records == nil {
		records = []db.IncomeRecord{}
	}

	// 计算今日合计
	var total float64
	db.DB.QueryRow("SELECT COALESCE(SUM(amount),0) FROM income_records WHERE record_date=?", date).Scan(&total)

	writeJSON(w, 200, map[string]interface{}{
		"records": records,
		"total":   total,
	})
}

// DeleteIncome 删除一条收入记录
func DeleteIncome(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("id")
	id, err := strconv.Atoi(idStr)
	if err != nil {
		writeJSON(w, 400, map[string]string{"error": "无效的ID"})
		return
	}
	_, err = db.DB.Exec("DELETE FROM income_records WHERE id=?", id)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "删除失败"})
		return
	}
	writeJSON(w, 200, map[string]string{"ok": "已删除"})
}
