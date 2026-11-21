# Generates build/icon.ico for the packaged Windows app.
# Run: pwsh -File build/make-icon.ps1
param(
  [string]$OutFile = (Join-Path $PSScriptRoot 'icon.ico'),
  [string]$PreviewPath = ''
)

Add-Type -AssemblyName System.Drawing

$sizes = @(16, 24, 32, 48, 64, 128, 256)
$images = @()

function New-IconBitmap([int]$size) {
  $bmp = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
  $g.Clear([System.Drawing.Color]::Transparent)

  # Rounded dark background.
  $radius = [single]([Math]::Max(3, $size * 0.22))
  $diameter = $radius * 2
  $edge = $size - 1
  $path = New-Object System.Drawing.Drawing2D.GraphicsPath
  $path.AddArc(0, 0, $diameter, $diameter, 180, 90)
  $path.AddArc($edge - $diameter, 0, $diameter, $diameter, 270, 90)
  $path.AddArc($edge - $diameter, $edge - $diameter, $diameter, $diameter, 0, 90)
  $path.AddArc(0, $edge - $diameter, $diameter, $diameter, 90, 90)
  $path.CloseFigure()

  $gradient = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    (New-Object System.Drawing.Rectangle(0, 0, $size, $size)),
    [System.Drawing.Color]::FromArgb(255, 38, 46, 66),
    [System.Drawing.Color]::FromArgb(255, 13, 16, 24),
    90)
  $g.FillPath($gradient, $path)

  if ($size -ge 32) {
    $border = New-Object System.Drawing.Pen([System.Drawing.Color]::FromArgb(80, 108, 140, 200), [single]([Math]::Max(1, $size * 0.012)))
    $g.DrawPath($border, $path)
  }

  # White "M" mark.
  $family = [System.Drawing.FontFamily]::new('Segoe UI')
  $emSize = [single]($size * 0.60)
  $font = New-Object System.Drawing.Font($family, $emSize, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel)
  $format = New-Object System.Drawing.StringFormat
  $format.Alignment = [System.Drawing.StringAlignment]::Center
  $format.LineAlignment = [System.Drawing.StringAlignment]::Center
  $textRect = New-Object System.Drawing.RectangleF(0, [single]($size * -0.05), $size, $size)
  $g.DrawString('M', $font, [System.Drawing.Brushes]::White, $textRect, $format)

  # Blue "revision" bar under the mark.
  $barWidth = [single]($size * 0.46)
  $barHeight = [single]([Math]::Max(2, $size * 0.085))
  $barX = [single]($size * 0.27)
  $barY = [single]($size * 0.73)
  $barRect = New-Object System.Drawing.RectangleF($barX, $barY, $barWidth, $barHeight)
  $barBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
    $barRect,
    [System.Drawing.Color]::FromArgb(255, 92, 164, 255),
    [System.Drawing.Color]::FromArgb(255, 86, 214, 199),
    0)
  $g.FillRectangle($barBrush, $barRect)

  $g.Dispose()
  $font.Dispose()
  $format.Dispose()
  return $bmp
}

foreach ($size in $sizes) {
  $bmp = New-IconBitmap $size
  $rect = New-Object System.Drawing.Rectangle(0, 0, $size, $size)
  $locked = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $stride = $locked.Stride
  $pixels = New-Object byte[] ($stride * $size)
  [System.Runtime.InteropServices.Marshal]::Copy($locked.Scan0, $pixels, 0, $pixels.Length)
  $bmp.UnlockBits($locked)

  # Build a 32bpp DIB entry: header + bottom-up BGRA pixels + empty AND mask.
  $maskRowBytes = [int]([Math]::Floor(($size + 31) / 32) * 4)
  $maskBytes = $maskRowBytes * $size
  $imageBytes = 40 + ($size * $size * 4) + $maskBytes
  $ms = New-Object System.IO.MemoryStream
  $bw = New-Object System.IO.BinaryWriter($ms)

  $bw.Write([UInt32]40)            # biSize
  $bw.Write([Int32]$size)          # biWidth
  $bw.Write([Int32]($size * 2))    # biHeight (XOR + AND)
  $bw.Write([UInt16]1)             # biPlanes
  $bw.Write([UInt16]32)            # biBitCount
  $bw.Write([UInt32]0)             # biCompression
  $bw.Write([UInt32]($size * $size * 4 + $maskBytes))
  $bw.Write([Int32]0)
  $bw.Write([Int32]0)
  $bw.Write([UInt32]0)
  $bw.Write([UInt32]0)

  for ($y = $size - 1; $y -ge 0; $y--) {
    $bw.Write($pixels, ($y * $stride), ($size * 4))
  }
  for ($i = 0; $i -lt $maskBytes; $i++) { $bw.Write([Byte]0) }

  $bw.Flush()
  $images += ,@($size, $ms.ToArray())
  $ms.Dispose()
  if ($PreviewPath -and $size -eq 256) {
    $bmp.Save($PreviewPath, [System.Drawing.Imaging.ImageFormat]::Png)
  }
  $bmp.Dispose()
}

$fs = [System.IO.File]::Create($OutFile)
$bw = New-Object System.IO.BinaryWriter($fs)
$bw.Write([UInt16]0)               # reserved
$bw.Write([UInt16]1)               # type: icon
$bw.Write([UInt16]$images.Count)   # image count
$offset = 6 + (16 * $images.Count)
foreach ($image in $images) {
  $size = [int]$image[0]
  $data = [byte[]]$image[1]
  $dim = if ($size -ge 256) { 0 } else { $size }
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]$dim)
  $bw.Write([Byte]0)               # palette count
  $bw.Write([Byte]0)               # reserved
  $bw.Write([UInt16]1)             # color planes
  $bw.Write([UInt16]32)            # bits per pixel
  $bw.Write([UInt32]$data.Length)
  $bw.Write([UInt32]$offset)
  $offset += $data.Length
}
foreach ($image in $images) { $bw.Write([byte[]]$image[1]) }
$bw.Flush()
$fs.Close()

Write-Host "Wrote $OutFile ($((Get-Item $OutFile).Length) bytes, $($sizes.Count) sizes)"
