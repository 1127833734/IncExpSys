@echo off
:: 主机模式 — 启动服务端（存放数据库，其他电脑连接这台）
start "" "%~dp0收支系统.exe" --server
