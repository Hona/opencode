@echo off
set DASHBOARD__MCP__AUTHMODE=Unsecured
set DASHBOARD__MCP__DISABLED=false
set ASPIRE_DASHBOARD_UNSECURED_ALLOW_ANONYMOUS=true
set ASPNETCORE_URLS=http://localhost:18888
set ASPNETCORE_ENVIRONMENT=Production
echo Starting Aspire Dashboard at http://localhost:18888...
cd /d "C:\Workspaces\opencode-aspire\aspire\src\Aspire.Dashboard"
dotnet run --configuration Release --no-launch-profile
