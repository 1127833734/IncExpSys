package handler

import (
	"fmt"
	"incomesystem/db"
	"net/http"
	"strconv"
	"time"
)

// 从请求中提取筛选参数：type（门市/外拍）和 category_id（具体分类）
func getFilterParams(r *http.Request) (typeFilter string, catFilter int) {
	typeFilter = r.URL.Query().Get("type")
	if catStr := r.URL.Query().Get("category_id"); catStr != "" {
		catFilter, _ = strconv.Atoi(catStr)
	}
	return
}

// DailyReport 日报
func DailyReport(w http.ResponseWriter, r *http.Request) {
	date := r.URL.Query().Get("date")
	if date == "" {
		date = time.Now().Format("2006-01-02")
	}
	typeFilter, catFilter := getFilterParams(r)

	report := db.DailyReport{}

	// 收入：按 type 和 category 分组
	incSQL := `SELECT c.type, c.name, COALESCE(SUM(r.amount),0) as total
		 FROM income_records r
		 JOIN income_categories c ON r.category_id = c.id
		 WHERE r.record_date = ?`
	incArgs := []interface{}{date}
	if catFilter > 0 {
		incSQL += " AND r.category_id = ?"
		incArgs = append(incArgs, catFilter)
	} else if typeFilter != "" {
		incSQL += " AND c.type = ?"
		incArgs = append(incArgs, typeFilter)
	}
	incSQL += ` GROUP BY c.type, c.id ORDER BY c.type, c.sort_order`

	rows, err := db.DB.Query(incSQL, incArgs...)
	if err != nil {
		writeJSON(w, 500, map[string]string{"error": "查询失败"})
		return
	}
	defer rows.Close()

	var currentType string
	var group *db.IncomeGroup
	for rows.Next() {
		var typ, name string
		var total float64
		rows.Scan(&typ, &name, &total)

		if typ != currentType {
			if group != nil {
				report.Income = append(report.Income, *group)
			}
			group = &db.IncomeGroup{Type: typ, Categories: []db.IncomeItem{}}
			currentType = typ
		}
		group.Categories = append(group.Categories, db.IncomeItem{Name: name, Total: total})
		report.IncomeTotal += total
	}
	if group != nil {
		report.Income = append(report.Income, *group)
	}
	if report.Income == nil {
		report.Income = []db.IncomeGroup{}
	}

	// 支出：按 category 分组
	expRows, err := db.DB.Query(
		`SELECT c.name, COALESCE(SUM(e.amount),0) as total
		 FROM expense_records e
		 JOIN expense_categories c ON e.category_id = c.id
		 WHERE e.record_date = ?
		 GROUP BY c.id
		 ORDER BY c.sort_order`,
		date,
	)
	if err == nil {
		defer expRows.Close()
		for expRows.Next() {
			var name string
			var total float64
			expRows.Scan(&name, &total)
			report.Expense = append(report.Expense, db.ExpenseItem{Name: name, Total: total})
			report.ExpenseTotal += total
		}
	}
	if report.Expense == nil {
		report.Expense = []db.ExpenseItem{}
	}

	writeJSON(w, 200, report)
}

// MonthlyReport 月报
func MonthlyReport(w http.ResponseWriter, r *http.Request) {
	year := r.URL.Query().Get("year")
	month := r.URL.Query().Get("month")
	if year == "" || month == "" {
		now := time.Now()
		year = now.Format("2006")
		month = now.Format("01")
	}
	ym := year + "-" + month
	typeFilter, catFilter := getFilterParams(r)

	report := db.MonthlyReport{}

	// 收入按日汇总
	incSQL := `SELECT record_date, COALESCE(SUM(amount),0) as total
		 FROM income_records r`
	incArgs := []interface{}{ym}
	if catFilter > 0 {
		incSQL += " WHERE r.category_id = ? AND strftime('%Y-%m', record_date) = ?"
		incArgs = []interface{}{catFilter, ym}
	} else if typeFilter != "" {
		incSQL += " JOIN income_categories c ON r.category_id = c.id WHERE c.type = ? AND strftime('%Y-%m', record_date) = ?"
		incArgs = []interface{}{typeFilter, ym}
	} else {
		incSQL += " WHERE strftime('%Y-%m', record_date) = ?"
	}
	incSQL += ` GROUP BY record_date ORDER BY record_date`

	incRows, err := db.DB.Query(incSQL, incArgs...)
	if err == nil {
		defer incRows.Close()
		dayMap := make(map[string]*db.DaySummary)
		for incRows.Next() {
			var d string
			var total float64
			incRows.Scan(&d, &total)
			dayMap[d] = &db.DaySummary{Date: d, Income: total}
			report.MonthIncomeTotal += total
		}

		// 支出按日汇总
		expRows, err2 := db.DB.Query(
			`SELECT record_date, COALESCE(SUM(amount),0) as total
			 FROM expense_records
			 WHERE strftime('%Y-%m', record_date) = ?
			 GROUP BY record_date
			 ORDER BY record_date`,
			ym,
		)
		if err2 == nil {
			defer expRows.Close()
			for expRows.Next() {
				var d string
				var total float64
				expRows.Scan(&d, &total)
				if ds, ok := dayMap[d]; ok {
					ds.Expense = total
				} else {
					dayMap[d] = &db.DaySummary{Date: d, Expense: total}
				}
				report.MonthExpenseTotal += total
			}
		}

		for _, ds := range dayMap {
			report.Days = append(report.Days, *ds)
		}
		for i := 0; i < len(report.Days)-1; i++ {
			for j := i + 1; j < len(report.Days); j++ {
				if report.Days[i].Date > report.Days[j].Date {
					report.Days[i], report.Days[j] = report.Days[j], report.Days[i]
				}
			}
		}
	}
	if report.Days == nil {
		report.Days = []db.DaySummary{}
	}

	writeJSON(w, 200, report)
}

// YearlyReport 年报
func YearlyReport(w http.ResponseWriter, r *http.Request) {
	year := r.URL.Query().Get("year")
	if year == "" {
		year = time.Now().Format("2006")
	}
	typeFilter, catFilter := getFilterParams(r)

	report := db.YearlyReport{}

	// 收入按月汇总
	incSQL := `SELECT strftime('%m', record_date) as month, COALESCE(SUM(amount),0) as total
		 FROM income_records r`
	incArgs := []interface{}{year}
	if catFilter > 0 {
		incSQL += " WHERE r.category_id = ? AND strftime('%Y', record_date) = ?"
		incArgs = []interface{}{catFilter, year}
	} else if typeFilter != "" {
		incSQL += " JOIN income_categories c ON r.category_id = c.id WHERE c.type = ? AND strftime('%Y', record_date) = ?"
		incArgs = []interface{}{typeFilter, year}
	} else {
		incSQL += " WHERE strftime('%Y', record_date) = ?"
	}
	incSQL += ` GROUP BY month ORDER BY month`

	incRows, err := db.DB.Query(incSQL, incArgs...)
	if err == nil {
		defer incRows.Close()
		monthMap := make(map[string]*db.MonthSummary)
		for incRows.Next() {
			var m string
			var total float64
			incRows.Scan(&m, &total)
			monthMap[m] = &db.MonthSummary{Month: m, Income: total}
			report.YearIncomeTotal += total
		}

		expRows, err2 := db.DB.Query(
			`SELECT strftime('%m', record_date) as month, COALESCE(SUM(amount),0) as total
			 FROM expense_records
			 WHERE strftime('%Y', record_date) = ?
			 GROUP BY month
			 ORDER BY month`,
			year,
		)
		if err2 == nil {
			defer expRows.Close()
			for expRows.Next() {
				var m string
				var total float64
				expRows.Scan(&m, &total)
				if ms, ok := monthMap[m]; ok {
					ms.Expense = total
				} else {
					monthMap[m] = &db.MonthSummary{Month: m, Expense: total}
				}
				report.YearExpenseTotal += total
			}
		}

		for m := 1; m <= 12; m++ {
			key := fmt.Sprintf("%02d", m)
			if ms, ok := monthMap[key]; ok {
				report.Months = append(report.Months, *ms)
			} else {
				report.Months = append(report.Months, db.MonthSummary{Month: key, Income: 0, Expense: 0})
			}
		}
	}
	if report.Months == nil {
		report.Months = []db.MonthSummary{}
	}

	writeJSON(w, 200, report)
}
