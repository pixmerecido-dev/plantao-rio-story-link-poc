$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Plantão Rio Stories.lnk'))
$shortcut.TargetPath = Join-Path $env:WINDIR 'System32\wscript.exe'
$shortcut.Arguments = '"' + (Join-Path $repo 'PlantaoRioStories.vbs') + '"'
$shortcut.WorkingDirectory = $repo
$shortcut.Description = 'Abrir painel local Plantão Rio Stories'
$shortcut.Save()
