param(
    [string]$Message = "site update"
)
$git = "C:\Program Files\Git\cmd\git.exe"
& $git add -A
& $git commit -m "$Message"
& $git push origin main
