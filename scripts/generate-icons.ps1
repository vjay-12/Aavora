Add-Type -AssemblyName System.Drawing

$srcPath = "C:\Users\vijay\.gemini\antigravity-ide\brain\ac45f1a6-64f9-46c8-8c32-67fd49b250d9\aavora_app_icon_1790937792980.jpg"
if (-not (Test-Path $srcPath)) {
    Write-Error "Source image not found: $srcPath"
    exit 1
}

$srcImg = [System.Drawing.Image]::FromFile($srcPath)

function Resize-Image($img, $width, $height, $destPath) {
    $bmp = New-Object System.Drawing.Bitmap($width, $height)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $g.DrawImage($img, 0, 0, $width, $height)
    
    $bmp.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)
    $g.Dispose()
    $bmp.Dispose()
    Write-Host "Created: $destPath ($width x $height)"
}

Resize-Image $srcImg 192 192 "public\icon-192.png"
Resize-Image $srcImg 512 512 "public\icon-512.png"
Resize-Image $srcImg 180 180 "public\apple-touch-icon.png"
Resize-Image $srcImg 64 64 "public\favicon.ico"

$srcImg.Dispose()
Write-Host "All icons generated successfully!"
