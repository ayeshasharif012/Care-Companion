# Kill whatever is holding port 5000 (Windows)
$conn = Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue | Select-Object -First 1
if ($conn) {
    $pid = $conn.OwningProcess
    Write-Host "Stopping process $pid on port 5000..."
    Stop-Process -Id $pid -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
    Write-Host "Port 5000 freed."
} else {
    Write-Host "Port 5000 is free."
}
