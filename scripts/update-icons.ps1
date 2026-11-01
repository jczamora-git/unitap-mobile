Add-Type -AssemblyName System.Drawing

function Resize-Image {
    param (
        [string]$sourcePath,
        [string]$destPath,
        [int]$width,
        [int]$height,
        [float]$scale = 1.0
    )

    $sourceImage = [System.Drawing.Image]::FromFile($sourcePath)
    $destBitmap = New-Object System.Drawing.Bitmap $width, $height
    $graphics = [System.Drawing.Graphics]::FromImage($destBitmap)

    $graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
    $graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
    $graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
    $graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality

    # Clear with transparent
    $graphics.Clear([System.Drawing.Color]::Transparent)

    $targetW = [int]($width * $scale)
    $targetH = [int]($height * $scale)
    $destX = [int](($width - $targetW) / 2)
    $destY = [int](($height - $targetH) / 2)

    $graphics.DrawImage($sourceImage, $destX, $destY, $targetW, $targetH)

    $destBitmap.Save($destPath, [System.Drawing.Imaging.ImageFormat]::Png)

    $graphics.Dispose()
    $destBitmap.Dispose()
    $sourceImage.Dispose()
    Write-Host "Created: $destPath ($width x $height)"
}

$logoPath = "public\unitap-logo.png"
$faviconSource = "public\unitap-favicon.png"

# 1. Update web favicons
Resize-Image -sourcePath $faviconSource -destPath "public\favicon.png" -width 64 -height 64
Resize-Image -sourcePath $faviconSource -destPath "public\favicon-192.png" -width 192 -height 192

# 2. Android Mipmap icons
$mipmaps = @(
    @{ folder = "mipmap-mdpi"; size = 48; fgSize = 108 },
    @{ folder = "mipmap-hdpi"; size = 72; fgSize = 162 },
    @{ folder = "mipmap-xhdpi"; size = 96; fgSize = 216 },
    @{ folder = "mipmap-xxhdpi"; size = 144; fgSize = 324 },
    @{ folder = "mipmap-xxxhdpi"; size = 192; fgSize = 432 }
)

$androidRes = "android\app\src\main\res"

foreach ($m in $mipmaps) {
    $dir = Join-Path $androidRes $m.folder
    if (Test-Path $dir) {
        $iconPath = Join-Path $dir "ic_launcher.png"
        $roundPath = Join-Path $dir "ic_launcher_round.png"
        $fgPath = Join-Path $dir "ic_launcher_foreground.png"

        # Standard launcher icon
        Resize-Image -sourcePath $logoPath -destPath $iconPath -width $m.size -height $m.size -scale 0.95
        # Round launcher icon
        Resize-Image -sourcePath $logoPath -destPath $roundPath -width $m.size -height $m.size -scale 0.95
        # Foreground icon (scaled into safe zone 0.72)
        Resize-Image -sourcePath $logoPath -destPath $fgPath -width $m.fgSize -height $m.fgSize -scale 0.72
    }
}

Write-Host "App icon generation completed successfully!"

