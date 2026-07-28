package main

import (
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync"
	"time"
)

func scanPort(ip string, port string, timeout time.Duration) bool {
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(ip, port), timeout)
	if err != nil {
		return false
	}
	conn.Close()
	return true
}

func discoverServer(port string, myIPs map[string]bool) string {
	client := &http.Client{Timeout: 800 * time.Millisecond}

	// 快速检查本机
	for ip := range myIPs {
		if resp, err := client.Get(fmt.Sprintf("http://%s:%s/api/lan", ip, port)); err == nil {
			resp.Body.Close()
			return ip
		}
	}

	// 扫描局域网其他机器
	subnets := getSubnets(myIPs)
	if len(subnets) == 0 {
		return ""
	}

	fmt.Println("  正在扫描局域网服务端...")

	var targets []string
	for _, subnet := range subnets {
		for i := 1; i <= 254; i++ {
			ip := fmt.Sprintf("%s.%d", subnet, i)
			if myIPs[ip] {
				continue
			}
			targets = append(targets, ip)
		}
	}

	result := make(chan string, 1)
	var wg sync.WaitGroup
	sem := make(chan struct{}, 80)

	for _, ip := range targets {
		wg.Add(1)
		go func(ip string) {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()

			if scanPort(ip, port, 200*time.Millisecond) {
				select {
				case result <- ip:
				default:
				}
			}
		}(ip)
	}

	done := make(chan struct{})
	go func() {
		wg.Wait()
		close(done)
	}()

	select {
	case ip := <-result:
		return ip
	case <-done:
		return ""
	}
}

func getSubnets(myIPs map[string]bool) []string {
	seen := make(map[string]bool)
	var subnets []string
	for ip := range myIPs {
		parts := strings.Split(ip, ".")
		if len(parts) == 4 {
			prefix := strings.Join(parts[:3], ".")
			if !seen[prefix] {
				seen[prefix] = true
				subnets = append(subnets, prefix)
			}
		}
	}
	return subnets
}
