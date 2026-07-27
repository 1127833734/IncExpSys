package main

import (
	"embed"
	"fmt"
	"incomesystem/db"
	"incomesystem/handler"
	"incomesystem/middleware"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

//go:embed web/*
var webFS embed.FS

func main() {
	// 确定数据目录：优先 exe 所在目录下的 data/
	exePath, _ := os.Executable()
	dataDir := filepath.Join(filepath.Dir(exePath), "data")

	// 初始化数据库
	fmt.Println("正在启动收支系统...")
	if err := db.Init(dataDir); err != nil {
		log.Fatalf("数据库初始化失败: %v", err)
	}
	defer db.Close()
	fmt.Println("数据库连接成功")

	// 创建路由
	mux := http.NewServeMux()

	// 静态文件（从 embed 中提取）
	webRoot, _ := fs.Sub(webFS, "web")
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(http.FS(webRoot))))

	// 页面路由
	mux.HandleFunc("GET /login.html", serveFile(webRoot, "login.html"))
	mux.HandleFunc("GET /index.html", serveFile(webRoot, "index.html"))
	mux.HandleFunc("GET /", serveIndex(webRoot))

	// API 路由 — 无需鉴权
	mux.HandleFunc("POST /api/login", middleware.RecoveryMiddleware(handler.Login))

	// API 路由 — 需要鉴权
	mux.HandleFunc("POST /api/logout", middleware.RecoveryMiddleware(middleware.AuthMiddleware(handler.Logout)))
	mux.HandleFunc("GET /api/me", middleware.RecoveryMiddleware(middleware.AuthMiddleware(handler.Me)))

	// 收入
	mux.HandleFunc("GET /api/income/categories", middleware.RecoveryMiddleware(middleware.AuthMiddleware(handler.GetIncomeCategories)))
	mux.HandleFunc("POST /api/income", middleware.RecoveryMiddleware(middleware.AuthMiddleware(handler.CreateIncome)))
	mux.HandleFunc("GET /api/income/today", middleware.RecoveryMiddleware(middleware.AuthMiddleware(handler.GetTodayIncome)))
	mux.HandleFunc("DELETE /api/income/{id}", middleware.RecoveryMiddleware(middleware.AdminMiddleware(handler.DeleteIncome)))

	// 支出
	mux.HandleFunc("GET /api/expense/categories", middleware.RecoveryMiddleware(middleware.AuthMiddleware(handler.GetExpenseCategories)))
	mux.HandleFunc("POST /api/expense", middleware.RecoveryMiddleware(middleware.AuthMiddleware(handler.CreateExpense)))
	mux.HandleFunc("GET /api/expense/today", middleware.RecoveryMiddleware(middleware.AuthMiddleware(handler.GetTodayExpense)))
	mux.HandleFunc("DELETE /api/expense/{id}", middleware.RecoveryMiddleware(middleware.AdminMiddleware(handler.DeleteExpense)))

	// 局域网地址（无需鉴权）
	mux.HandleFunc("GET /api/lan", func(w http.ResponseWriter, r *http.Request) {
		addr := getBestLANAddr()
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		fmt.Fprintf(w, `{"addr":"%s"}`, addr)
	})

	// 报表
	mux.HandleFunc("GET /api/report/daily", middleware.RecoveryMiddleware(middleware.AuthMiddleware(handler.DailyReport)))
	mux.HandleFunc("GET /api/report/monthly", middleware.RecoveryMiddleware(middleware.AuthMiddleware(handler.MonthlyReport)))
	mux.HandleFunc("GET /api/report/yearly", middleware.RecoveryMiddleware(middleware.AuthMiddleware(handler.YearlyReport)))

	// 端口
	port := "3456"
	if p := os.Getenv("IES_PORT"); p != "" {
		port = p
	}

	// 打印局域网地址
	fmt.Println()
	fmt.Println("══════════════════════════════════════")
	fmt.Println("  收支系统已启动！")
	fmt.Printf("  本机访问: http://localhost:%s\n", port)
	printLANAddresses(port)
	fmt.Println("══════════════════════════════════════")
	fmt.Println()

	// 自动打开浏览器
	go openBrowser(fmt.Sprintf("http://localhost:%s", port))

	if err := http.ListenAndServe("0.0.0.0:"+port, mux); err != nil {
		log.Fatalf("服务启动失败: %v", err)
	}
}

func serveFile(fsys fs.FS, name string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		data, err := fs.ReadFile(fsys, name)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
	}
}

func serveIndex(fsys fs.FS) http.HandlerFunc {
	loginHTML, _ := fs.ReadFile(fsys, "login.html")
	indexHTML, _ := fs.ReadFile(fsys, "index.html")

	return func(w http.ResponseWriter, r *http.Request) {
		// 已登录 → 主页，未登录 → 登录页
		if s := middleware.GetSession(r); s != nil {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(indexHTML)
		} else {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			w.Write(loginHTML)
		}
	}
}

func printLANAddresses(port string) {
	for _, ip := range getLANIPs() {
		fmt.Printf("  局域网访问: http://%s:%s\n", ip, port)
	}
}

func getLANIPs() []string {
	var ips []string
	addrs, err := net.InterfaceAddrs()
	if err != nil {
		return ips
	}
	for _, addr := range addrs {
		if ipnet, ok := addr.(*net.IPNet); ok && !ipnet.IP.IsLoopback() && ipnet.IP.To4() != nil {
			ips = append(ips, ipnet.IP.String())
		}
	}
	return ips
}

func getBestLANAddr() string {
	ips := getLANIPs()
	// 优先返回 192.168.x.x 地址
	for _, ip := range ips {
		if len(ip) > 8 && ip[:8] == "192.168." {
			return ip
		}
	}
	// 其次返回 10.x.x.x
	for _, ip := range ips {
		if len(ip) > 3 && ip[:3] == "10." {
			return ip
		}
	}
	// 否则返回第一个
	if len(ips) > 0 {
		return ips[0]
	}
	return "localhost"
}

func openBrowser(url string) {
	var cmd *exec.Cmd
	switch runtime.GOOS {
	case "windows":
		cmd = exec.Command("rundll32", "url.dll,FileProtocolHandler", url)
	case "darwin":
		cmd = exec.Command("open", url)
	default:
		cmd = exec.Command("xdg-open", url)
	}
	if cmd != nil {
		cmd.Start()
	}
}
