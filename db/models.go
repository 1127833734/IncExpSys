package db

// User 用户模型
type User struct {
	ID       int    `json:"id"`
	WorkNo   string `json:"work_no"`
	Password string `json:"-"`
	Name     string `json:"name"`
	Role     string `json:"role"` // "admin" | "staff"
}

// IncomeCategory 收入分类
type IncomeCategory struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	Type      string `json:"type"` // "开单" | "不开单" | "外拍"
	SortOrder int    `json:"sort_order"`
}

// IncomeRecord 收入记录
type IncomeRecord struct {
	ID            int     `json:"id"`
	OrderNo       string  `json:"order_no"`
	CategoryID    int     `json:"category_id"`
	CategoryName  string  `json:"category_name"`
	Type          string  `json:"type"`
	Amount        float64 `json:"amount"`
	PaymentMethod string  `json:"payment_method"`
	RecordDate    string  `json:"record_date"`
	Notes         string  `json:"notes"`
	CreatedBy     string  `json:"created_by"`
	CreatedAt     string  `json:"created_at"`
}

// ExpenseCategory 支出分类
type ExpenseCategory struct {
	ID        int    `json:"id"`
	Name      string `json:"name"`
	SortOrder int    `json:"sort_order"`
}

// ExpenseRecord 支出记录
type ExpenseRecord struct {
	ID           int     `json:"id"`
	CategoryID   int     `json:"category_id"`
	CategoryName string  `json:"category_name"`
	Amount       float64 `json:"amount"`
	RecordDate   string  `json:"record_date"`
	Notes        string  `json:"notes"`
	CreatedBy    string  `json:"created_by"`
	CreatedAt    string  `json:"created_at"`
}

// DailyReport 日报结构
type DailyReport struct {
	Income      []IncomeGroup `json:"income"`
	Expense     []ExpenseItem `json:"expense"`
	IncomeTotal float64       `json:"income_total"`
	ExpenseTotal float64      `json:"expense_total"`
}

// IncomeGroup 收入分组（按类型）
type IncomeGroup struct {
	Type       string        `json:"type"`
	Categories []IncomeItem  `json:"categories"`
}

// IncomeItem 收入项
type IncomeItem struct {
	Name  string  `json:"name"`
	Total float64 `json:"total"`
}

// ExpenseItem 支出项
type ExpenseItem struct {
	Name  string  `json:"name"`
	Total float64 `json:"total"`
}

// MonthlyReport 月报结构
type MonthlyReport struct {
	Days             []DaySummary `json:"days"`
	MonthIncomeTotal float64      `json:"month_income_total"`
	MonthExpenseTotal float64     `json:"month_expense_total"`
}

// DaySummary 日汇总
type DaySummary struct {
	Date    string  `json:"date"`
	Income  float64 `json:"income"`
	Expense float64 `json:"expense"`
}

// YearlyReport 年报结构
type YearlyReport struct {
	Months           []MonthSummary `json:"months"`
	YearIncomeTotal  float64        `json:"year_income_total"`
	YearExpenseTotal float64        `json:"year_expense_total"`
}

// MonthSummary 月汇总
type MonthSummary struct {
	Month   string  `json:"month"`
	Income  float64 `json:"income"`
	Expense float64 `json:"expense"`
}

// LoginRequest 登录请求
type LoginRequest struct {
	WorkNo   string `json:"work_no"`
	Password string `json:"password"`
}

// IncomeRequest 收入录入请求
type IncomeRequest struct {
	CategoryID    int     `json:"category_id"`
	Amount        float64 `json:"amount"`
	PaymentMethod string  `json:"payment_method"`
	RecordDate    string  `json:"record_date"`
	Notes         string  `json:"notes"`
}

// ExpenseRequest 支出录入请求
type ExpenseRequest struct {
	CategoryID int     `json:"category_id"`
	Amount     float64 `json:"amount"`
	RecordDate string  `json:"record_date"`
	Notes      string  `json:"notes"`
}
