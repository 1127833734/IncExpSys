package db

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"

	_ "modernc.org/sqlite"
)

var DB *sql.DB

// Init 初始化数据库连接，建表，写入种子数据
func Init(dataDir string) error {
	if err := os.MkdirAll(dataDir, 0755); err != nil {
		return fmt.Errorf("创建数据目录失败: %w", err)
	}

	dbPath := filepath.Join(dataDir, "income_expense.db")
	var err error
	DB, err = sql.Open("sqlite", dbPath+"?_journal_mode=WAL&_synchronous=NORMAL")
	if err != nil {
		return fmt.Errorf("打开数据库失败: %w", err)
	}

	if err := createTables(); err != nil {
		return fmt.Errorf("建表失败: %w", err)
	}
	if err := seedData(); err != nil {
		return fmt.Errorf("种子数据失败: %w", err)
	}
	return nil
}

func createTables() error {
	sqls := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			work_no TEXT UNIQUE NOT NULL,
			password TEXT NOT NULL,
			name TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'staff',
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
		)`,
		`CREATE TABLE IF NOT EXISTS income_categories (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			type TEXT NOT NULL,
			sort_order INTEGER NOT NULL DEFAULT 0,
			is_active INTEGER NOT NULL DEFAULT 1
		)`,
		`CREATE TABLE IF NOT EXISTS income_records (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			order_no TEXT DEFAULT '',
			category_id INTEGER NOT NULL,
			amount REAL NOT NULL DEFAULT 0,
			payment_method TEXT NOT NULL DEFAULT '现金',
			record_date TEXT NOT NULL,
			notes TEXT DEFAULT '',
			created_by INTEGER NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
		)`,
		`CREATE TABLE IF NOT EXISTS expense_categories (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			sort_order INTEGER NOT NULL DEFAULT 0,
			is_active INTEGER NOT NULL DEFAULT 1
		)`,
		`CREATE TABLE IF NOT EXISTS expense_records (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			category_id INTEGER NOT NULL,
			amount REAL NOT NULL DEFAULT 0,
			record_date TEXT NOT NULL,
			notes TEXT DEFAULT '',
			created_by INTEGER NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now','localtime'))
		)`,
	}
	for _, s := range sqls {
		if _, err := DB.Exec(s); err != nil {
			return err
		}
	}
	return nil
}

func seedData() error {
	// 检查是否已有数据
	var count int
	DB.QueryRow("SELECT COUNT(*) FROM users").Scan(&count)
	if count == 0 {
		if _, err := DB.Exec(`INSERT INTO users (work_no, password, name, role) VALUES ('admin','123456','管理员','admin')`); err != nil {
			return err
		}
	}

	// 收入分类种子数据
	DB.QueryRow("SELECT COUNT(*) FROM income_categories").Scan(&count)
	if count == 0 {
		incomeCategories := []struct {
			Name      string
			Type      string
			SortOrder int
		}{
			// 门市
			{"驾证", "门市", 1},
			{"居住&二代证", "门市", 2},
			{"护照", "门市", 3},
			{"出相", "门市", 4},
			{"拍摄社保", "门市", 5},
			{"拍摄", "门市", 6},
			{"斋拍摄", "门市", 7},
			{"保安证", "门市", 8},
			{"复印打印", "门市", 9},
			{"调相回执", "门市", 10},
			{"校卡", "门市", 11},
			{"过塑", "门市", 12},
			{"社保", "门市", 13},
			{"斋拍", "门市", 14},
			{"扫描", "门市", 15},
			{"相架", "门市", 16},
			{"其他", "门市", 17},
			// 外拍
			{"外拍", "外拍", 1},
		}
		for _, c := range incomeCategories {
			if _, err := DB.Exec("INSERT INTO income_categories (name, type, sort_order) VALUES (?,?,?)", c.Name, c.Type, c.SortOrder); err != nil {
				return err
			}
		}
	}

	// 支出分类种子数据
	DB.QueryRow("SELECT COUNT(*) FROM expense_categories").Scan(&count)
	if count == 0 {
		expenseCategories := []struct {
			Name      string
			SortOrder int
		}{
			{"租金", 1},
			{"人工费", 2},
			{"水费", 3},
			{"电费", 4},
			{"耗材开销", 5},
			{"其他", 6},
		}
		for _, c := range expenseCategories {
			if _, err := DB.Exec("INSERT INTO expense_categories (name, sort_order) VALUES (?,?)", c.Name, c.SortOrder); err != nil {
				return err
			}
		}
	}
	return nil
}

// Close 关闭数据库
func Close() {
	if DB != nil {
		DB.Close()
	}
}
