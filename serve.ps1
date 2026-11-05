# XML viewer: a small local web server for Windows, started by start.bat.
# It serves this folder (so the built-in examples can load) and opens the page in your browser.
# Only this computer can reach it (localhost). Close the window to stop it.
param([int]$Port = 8080)

$root = [System.IO.Path]::GetFullPath((Split-Path -Parent $MyInvocation.MyCommand.Path))
if (-not $root.EndsWith([System.IO.Path]::DirectorySeparatorChar)) { $root += [System.IO.Path]::DirectorySeparatorChar }

# take the first free port from 8080 up
$listener = $null
for ($p = $Port; $p -lt $Port + 20; $p++) {
  $l = New-Object System.Net.HttpListener
  $l.Prefixes.Add("http://localhost:$p/")
  try { $l.Start(); $listener = $l; $Port = $p; break } catch { $l.Close() }
}
if (-not $listener) { Write-Host "Could not start the local server (ports $Port-$($Port + 19) are busy)."; exit 1 }

$url = "http://localhost:$Port/"
Write-Host ""
Write-Host "  The XML viewer is running at $url"
Write-Host "  Keep this window open while you use it. Close it to stop."
Write-Host ""
Start-Process $url

$types = @{
  ".html" = "text/html; charset=utf-8"; ".js" = "text/javascript; charset=utf-8"; ".css" = "text/css; charset=utf-8";
  ".xml" = "application/xml"; ".svg" = "image/svg+xml"; ".json" = "application/json";
  ".png" = "image/png"; ".ico" = "image/x-icon"; ".md" = "text/plain; charset=utf-8"
}

while ($listener.IsListening) {
  try { $ctx = $listener.GetContext() } catch { break }
  $res = $ctx.Response
  try {
    $rel = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath).TrimStart('/')
    if ($rel -eq "") { $rel = "index.html" }
    $path = [System.IO.Path]::GetFullPath((Join-Path $root $rel))
    # only files inside this folder
    if ($path.StartsWith($root, [StringComparison]::OrdinalIgnoreCase) -and (Test-Path -LiteralPath $path -PathType Leaf)) {
      $ext = [System.IO.Path]::GetExtension($path).ToLower()
      if ($types.ContainsKey($ext)) { $res.ContentType = $types[$ext] } else { $res.ContentType = "application/octet-stream" }
      $bytes = [System.IO.File]::ReadAllBytes($path)
    } else {
      $res.StatusCode = 404
      $bytes = [System.Text.Encoding]::UTF8.GetBytes("Not found")
    }
    $res.Headers.Add("Cache-Control", "no-cache")
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
  } catch {
  } finally {
    $res.Close()
  }
}
