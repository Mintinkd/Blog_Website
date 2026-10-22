# Windows wrapper for gh: decode its UTF-8 output correctly under CP936.
# Usage: .\scripts\gh.ps1 issue view 36 --json number,title | ConvertFrom-Json
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()
$flatArgs = foreach ($arg in $args) {
  if ($arg -is [array]) { $arg -join ',' } else { $arg }
}
& gh @flatArgs
exit $LASTEXITCODE
