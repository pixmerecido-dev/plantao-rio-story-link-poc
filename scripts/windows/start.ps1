$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
Set-Location -LiteralPath $repo
if (-not $env:ADMIN_PORT -and (Test-Path '.env')) {
  $match = Select-String -Path '.env' -Pattern '^ADMIN_PORT=(\d+)$' | Select-Object -First 1
  if ($match) { $env:ADMIN_PORT = $match.Matches[0].Groups[1].Value }
}
$port = if ($env:ADMIN_PORT) { [int]$env:ADMIN_PORT } else { 4310 }
$url = "http://127.0.0.1:$port"
$mutex = New-Object System.Threading.Mutex($false, 'Local\PlantaoRioStoriesLauncher')
if (-not $mutex.WaitOne(0)) { exit }
try {
  # A running backend is reused; a listener alone is not readiness.
  try {
    $health = Invoke-RestMethod "$url/api/runtime" -TimeoutSec 2
    if ($health.panel_available -eq $true -and $health.application -eq 'plantao-rio-stories') { Start-Process $url; exit }
  } catch {}
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $version = & $node -p 'process.versions.node'
  if ([version]$version -lt [version]'22.19.0') { throw 'Atualize o Node.js para 22.19 ou superior (recomendado: versão LTS).' }
  $data = if ($env:ADMIN_DATA_DIR) { $env:ADMIN_DATA_DIR } else { Join-Path $repo 'data\admin' }
  New-Item -ItemType Directory -Force -Path $data | Out-Null
  $backendLock = Join-Path $data 'backend.lock'
  if (Test-Path $backendLock) {
    $ownerPid = 0
    $ownerText = (Get-Content -LiteralPath $backendLock -Raw).Trim()
    if (-not [int]::TryParse($ownerText, [ref]$ownerPid)) { throw 'O registro do painel precisa de revisão. Não apague dados; envie backend.stderr.log.' }
    if (Get-Process -Id $ownerPid -ErrorAction SilentlyContinue) {
      throw 'Já existe um painel em execução que este launcher não pode reutilizar. Encerre a versão anterior pelas janelas abertas ou salve seu trabalho e reinicie o Windows. Depois abra Plantão Rio Stories novamente.'
    }
  }
  $lockHash = (Get-FileHash -LiteralPath (Join-Path $repo 'package-lock.json') -Algorithm SHA256).Hash
  $stamp = Join-Path $data 'launcher-lock.sha256'
  # Missing launcher stamp does not mean a working npm installation must be deleted.
  $check = Start-Process $node -ArgumentList ('"' + (Join-Path $repo 'scripts\windows\dependency-check.mjs') + '" "' + $repo + '"') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $data 'dependencies-check.stdout.log') -RedirectStandardError (Join-Path $data 'dependencies-check.stderr.log')
  if ($check.ExitCode -eq 0) {
    Set-Content -LiteralPath $stamp -Value $lockHash -Encoding ASCII
  } else {
    # Never terminate unrelated Node/esbuild processes. Refuse installation while this repo is in use.
    $busy = @(Get-CimInstance Win32_Process -ErrorAction SilentlyContinue | Where-Object {
      $_.ExecutablePath -and $_.ExecutablePath.StartsWith((Join-Path $repo 'node_modules\'), [System.StringComparison]::OrdinalIgnoreCase)
    })
    if ($busy.Count -gt 0) {
      throw 'Existe um componente deste projeto em uso. Feche as janelas antigas do painel/testes ou reinicie o Windows e abra novamente Plantão Rio Stories. Nenhum processo foi encerrado automaticamente.'
    }
    $npm = (Get-Command npm.cmd -ErrorAction Stop).Source
    $npmCli = Join-Path (Split-Path $npm -Parent) 'node_modules\npm\bin\npm-cli.js'
    if (-not (Test-Path $npmCli)) { throw 'Instalação Node.js incompleta: npm indisponível.' }
    $install = Start-Process $node -ArgumentList ('"' + $npmCli + '" ci --no-audit --no-fund') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $data 'install.stdout.log') -RedirectStandardError (Join-Path $data 'install.stderr.log')
    if ($install.ExitCode -ne 0) {
      $errorLog = Get-Content -LiteralPath (Join-Path $data 'install.stderr.log') -Raw -ErrorAction SilentlyContinue
      if ($errorLog -match '(?is)EPERM.*esbuild\.exe|EBUSY|resource busy') {
        throw 'O Windows bloqueou um arquivo da instalação. Feche as janelas antigas do painel/testes ou reinicie o Windows e tente novamente. Se persistir, envie install.stderr.log. Não apague node_modules nem desative o antivírus.'
      }
      throw 'Não foi possível instalar dependências. Envie data/admin/install.stderr.log para identificar a causa.'
    }
    $verify = Start-Process $node -ArgumentList ('"' + (Join-Path $repo 'scripts\windows\dependency-check.mjs') + '" "' + $repo + '"') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $data 'dependencies-check.stdout.log') -RedirectStandardError (Join-Path $data 'dependencies-check.stderr.log')
    if ($verify.ExitCode -ne 0) { throw 'A instalação não ficou completa. Envie os logs de instalação; o painel não foi iniciado.' }
    Set-Content -LiteralPath $stamp -Value $lockHash -Encoding ASCII
  }
  $build = Start-Process $node -ArgumentList ('"' + (Join-Path $repo 'node_modules\typescript\bin\tsc') + '"') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -Wait -RedirectStandardOutput (Join-Path $data 'build.stdout.log') -RedirectStandardError (Join-Path $data 'build.stderr.log')
  if ($build.ExitCode -ne 0) { throw 'Não foi possível preparar o painel. Peça ao administrador para revisar os logs de build.' }
  $backend = Start-Process $node -ArgumentList ('"' + (Join-Path $repo 'dist\admin\server.js') + '"') -WorkingDirectory $repo -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $data 'backend.stdout.log') -RedirectStandardError (Join-Path $data 'backend.stderr.log')
  $ready = $false
  for ($i = 0; $i -lt 40; $i++) {
    Start-Sleep -Milliseconds 500
    if ($backend.HasExited) { throw 'O painel não iniciou. Peça ao administrador para revisar os logs locais.' }
    try { $health = Invoke-RestMethod "$url/api/runtime" -TimeoutSec 2; if ($health.panel_available -eq $true -and $health.application -eq 'plantao-rio-stories') { $ready = $true; break } } catch {}
  }
  if (-not $ready) { throw 'O painel demorou para iniciar. Não inicie outra cópia; consulte os logs locais.' }
  Start-Process $url
} catch {
  [System.Windows.Forms.MessageBox]::Show($_.Exception.Message, 'Plantão Rio Stories', 'OK', 'Warning') | Out-Null
} finally { $mutex.ReleaseMutex(); $mutex.Dispose() }
