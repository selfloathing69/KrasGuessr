
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8

$here     = $PSScriptRoot
$webRoot  = if (Test-Path (Join-Path $here 'web')) { Join-Path $here 'web' } else { $here }
$dataDir  = Join-Path $here 'data'
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }

$locationsFile   = Join-Path $dataDir 'locations.json'
$leaderboardFile = Join-Path $dataDir 'leaderboard.json'

if (-not (Test-Path $locationsFile)) {
    Write-Host ""
    Write-Host "ERROR: data/locations.json not found" -ForegroundColor Red
    Write-Host "Expected at: $locationsFile" -ForegroundColor Red
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

$script:Locations = [System.IO.File]::ReadAllText($locationsFile, [System.Text.Encoding]::UTF8) | ConvertFrom-Json

$script:CONFIG = @{
    RoundsPerGame     = 5
    MaxScore          = 5000
    KrasScoreK        = 2000.0
    KrasGraceM        = 35.0
    HintRadius        = 2000.0
    SessionTTLsec     = 3600
    MinSubmitInterval = 0.5
    HintPenalty       = @{ '1' = 0.85; '2' = 0.70; '3' = 0.50 }
    LeaderboardLimit  = 20
    LeaderboardMax    = 50
    DebugLogJson      = $false
}

$script:MODE_LABELS = @{
    krasnoyarsk = 'Красноярск'
    sfu         = 'СФУ'
    russia      = 'Россия'
}



$script:DEV_KEY = ([guid]::NewGuid().ToString('N').Substring(0, 12)).ToUpper()


$script:DISTRICTS = @{}

$script:DISTRICT_COLORS = @{
    'Октябрьский'      = @{ fillColor='#ef444433'; strokeColor='#dc2626' }
    'Железнодорожный'  = @{ fillColor='#4f46e533'; strokeColor='#4338ca' }
    'Центральный'      = @{ fillColor='#0d948833'; strokeColor='#0f766e' }
    'Советский'        = @{ fillColor='#0284c733'; strokeColor='#0369a1' }
    'Свердловский'     = @{ fillColor='#9333ea33'; strokeColor='#7e22ce' }
    'Кировский'        = @{ fillColor='#65a30d33'; strokeColor='#4d7c0f' }
    'Ленинский'        = @{ fillColor='#d9770633'; strokeColor='#b45309' }
}

function Convert-GeoRingToLatLon($ring, [double]$minDistDeg = 0.00025) {

    $n = @($ring).Count

    if ($n -lt 4) {
        $out0 = New-Object System.Collections.ArrayList
        foreach ($pt in $ring) {
            $lat = [Math]::Round([double]$pt[1], 5)
            $lon = [Math]::Round([double]$pt[0], 5)
            [void]$out0.Add(@($lat, $lon))
        }
        return ,$out0.ToArray()
    }

    $out = New-Object System.Collections.ArrayList
    $firstLat = [Math]::Round([double]$ring[0][1], 5)
    $firstLon = [Math]::Round([double]$ring[0][0], 5)
    [void]$out.Add(@($firstLat, $firstLon))

    $lastLat = $firstLat
    $lastLon = $firstLon
    for ($i = 1; $i -lt ($n - 1); $i++) {
        $lat = [Math]::Round([double]$ring[$i][1], 5)
        $lon = [Math]::Round([double]$ring[$i][0], 5)
        $dlat = $lat - $lastLat
        $dlon = $lon - $lastLon
        $d = [Math]::Sqrt($dlat * $dlat + $dlon * $dlon)
        if ($d -gt $minDistDeg) {
            [void]$out.Add(@($lat, $lon))
            $lastLat = $lat
            $lastLon = $lon
        }
    }
    [void]$out.Add(@($firstLat, $firstLon))
    return ,$out.ToArray()
}

function Load-Districts([string]$path) {
    if (-not (Test-Path $path -PathType Leaf)) {
        Write-Host "  districts.geojson not found — level-2 hints will not work" -ForegroundColor Yellow
        return
    }
    try {
        $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
        $geo = $raw | ConvertFrom-Json
    } catch {
        Write-Host "  Failed to parse districts.geojson: $_" -ForegroundColor Red
        return
    }

    $loaded = 0
    foreach ($f in $geo.features) {
        $rawName = [string]$f.properties.name
        if ([string]::IsNullOrEmpty($rawName)) { continue }
        $shortName = ($rawName -replace '\s*район\s*$', '').Trim()
        $color = $script:DISTRICT_COLORS[$shortName]
        if (-not $color) { continue }

        $polygons = New-Object System.Collections.ArrayList
        $geom = $f.geometry
        if ($geom.type -eq 'Polygon') {
            foreach ($ring in $geom.coordinates) {
                [void]$polygons.Add((Convert-GeoRingToLatLon $ring))
            }
        } elseif ($geom.type -eq 'MultiPolygon') {
            foreach ($poly in $geom.coordinates) {
                foreach ($ring in $poly) {
                    [void]$polygons.Add((Convert-GeoRingToLatLon $ring))
                }
            }
        }

        $script:DISTRICTS[$shortName] = @{
            polygons    = @($polygons.ToArray())
            fillColor   = $color.fillColor
            strokeColor = $color.strokeColor
        }
        $loaded++
    }

    if ($loaded -gt 0) {
        Write-Host "  Loaded $loaded districts from districts.geojson" -ForegroundColor Green
    } else {
        Write-Host "  districts.geojson: no districts recognized" -ForegroundColor Yellow
    }
}

$script:BANK_TO_DISTRICTS = @{
    left  = @('Центральный','Железнодорожный','Октябрьский','Советский')
    right = @('Свердловский','Кировский','Ленинский')
}

$script:BANK_STYLE = @{
    left  = @{ fillColor='#10b98133'; strokeColor='#059669'; name='Левом берегу' }
    right = @{ fillColor='#8b5cf633'; strokeColor='#7c3aed'; name='Правом берегу' }
}

$script:BANKS = @{}

function Build-Banks {
    foreach ($key in @('left','right')) {
        $districtNames = $script:BANK_TO_DISTRICTS[$key]
        $style = $script:BANK_STYLE[$key]
        $allRings = New-Object System.Collections.ArrayList
        $foundDistricts = @()

        foreach ($name in $districtNames) {
            $d = $script:DISTRICTS[$name]
            if (-not $d) { continue }
            foreach ($ring in @($d.polygons)) {
                [void]$allRings.Add($ring)
            }
            $foundDistricts += $name
        }

        if ($allRings.Count -eq 0) { continue }

        $script:BANKS[$key] = @{
            polygons    = @($allRings.ToArray())
            fillColor   = $style.fillColor
            strokeColor = $style.strokeColor
            name        = $style.name
        }
    }
}

$script:REGIONS = @{}
$script:FEDERALS = @{} 

$script:FEDERAL_NAMES = @{
    'ЦФО'  = 'Центральный'
    'СЗФО' = 'Северо-Западный'
    'ЮФО'  = 'Южный'
    'СКФО' = 'Северо-Кавказский'
    'ПФО'  = 'Приволжский'
    'УФО'  = 'Уральский'
    'СФО'  = 'Сибирский'
    'ДФО'  = 'Дальневосточный'
}

$script:REGION_NAME_MAP = @{
    'Moskva'              = 'Москва'
    'Moscow'              = 'Москва'
    'Saint Petersburg'    = 'Санкт-Петербург'
    'Sankt-Peterburg'     = 'Санкт-Петербург'
    'Moscow Oblast'       = 'Московская область'
    'Moskovskaya'         = 'Московская область'
    'Vladimir'            = 'Владимирская область'
    'Yaroslavl'           = 'Ярославская область'
    'Pskov'               = 'Псковская область'
    'Novgorod'            = 'Новгородская область'
    'Krasnodar'           = 'Краснодарский край'
    'Astrakhan'           = 'Астраханская область'
    'Chechen'             = 'Чеченская Республика'
    'Chechnya'            = 'Чеченская Республика'
    'Dagestan'            = 'Республика Дагестан'
    'Tatarstan'           = 'Республика Татарстан'
    'Nizhny Novgorod'     = 'Нижегородская область'
    'Bashkortostan'       = 'Республика Башкортостан'
    'Samara'              = 'Самарская область'
    'Sverdlovsk'          = 'Свердловская область'
    'Chelyabinsk'         = 'Челябинская область'
    'Novosibirsk'         = 'Новосибирская область'
    'Irkutsk'             = 'Иркутская область'
    'Omsk'                = 'Омская область'
    'Tomsk'               = 'Томская область'
    'Primorsky'           = 'Приморский край'
    'Primorskiy'          = 'Приморский край'
    'Khabarovsk'          = 'Хабаровский край'
    'Kamchatka'           = 'Камчатский край'
    'Kamtchatka'          = 'Камчатский край'
}

function Load-RegionsFile([string]$path, [string]$label, [hashtable]$target, [hashtable]$nameMap, [string]$nameField = 'name') {
    if (-not (Test-Path $path -PathType Leaf)) {
        Write-Host "  $label not found — hints will not draw region borders" -ForegroundColor Yellow
        return
    }
    try {
        $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
        $geo = $raw | ConvertFrom-Json
    } catch {
        Write-Host "  Failed to parse $label : $_" -ForegroundColor Red
        return
    }

    $loaded = 0
    $skipped = 0
    foreach ($f in $geo.features) {
        $rawName = [string]$f.properties.$nameField
        if ([string]::IsNullOrEmpty($rawName)) { $skipped++; continue }

        $key = $rawName
        if ($nameMap -and $nameMap.ContainsKey($rawName)) {
            $key = $nameMap[$rawName]
        }

        $polygons = New-Object System.Collections.ArrayList
        $geom = $f.geometry
        if ($geom.type -eq 'Polygon') {
            foreach ($ring in $geom.coordinates) {
                [void]$polygons.Add((Convert-GeoRingToLatLon $ring 0.002))
            }
        } elseif ($geom.type -eq 'MultiPolygon') {
            foreach ($poly in $geom.coordinates) {
                foreach ($ring in $poly) {
                    [void]$polygons.Add((Convert-GeoRingToLatLon $ring 0.002))
                }
            }
        }

        if ($polygons.Count -gt 0) {
            $target[$key] = @{ polygons = @($polygons.ToArray()) }
            $loaded++
        }
    }

    if ($skipped -gt 0) {
        Write-Host "  $label : skipped $skipped features (field '$nameField' empty)" -ForegroundColor DarkYellow
    }
    Write-Host "  Loaded $loaded entries from $label" -ForegroundColor Green
}

$districtsFile = Join-Path $dataDir 'districts.geojson'
$regionsFile   = Join-Path $dataDir 'regions.geojson'
$federalsFile  = Join-Path $dataDir 'federals.geojson'

Load-Districts $districtsFile
Build-Banks
Load-RegionsFile $regionsFile   'regions.geojson'   $script:REGIONS  $script:REGION_NAME_MAP 'name'
Load-RegionsFile $federalsFile  'federals.geojson'  $script:FEDERALS $null  'fo'


$script:Utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function ConvertTo-CleanJson($obj, [int]$depth = 20) {
    $json = $obj | ConvertTo-Json -Depth $depth
    if ($null -eq $json) { return 'null' }

    $evaluator = [System.Text.RegularExpressions.MatchEvaluator]{
        param($m)
        $hex = $m.Groups[1].Value
        $code = [Convert]::ToInt32($hex, 16)
        return [string][char]$code
    }
    return [System.Text.RegularExpressions.Regex]::Replace(
        $json,
        '\\u([0-9a-fA-F]{4})',
        $evaluator
    )
}

function Escape-JsonString([string]$s) {
    if ($null -eq $s) { return '""' }
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('"')
    foreach ($c in $s.ToCharArray()) {
        switch ($c) {
            '"'  { [void]$sb.Append('\"') }
            '\'  { [void]$sb.Append('\\') }
            "`n" { [void]$sb.Append('\n') }
            "`r" { [void]$sb.Append('\r') }
            "`t" { [void]$sb.Append('\t') }
            default {
                if ([int]$c -lt 32) {
                    [void]$sb.Append('\u' + ([int]$c).ToString('x4'))
                } else {
                    [void]$sb.Append($c)
                }
            }
        }
    }
    [void]$sb.Append('"')
    return $sb.ToString()
}

function Build-LeaderboardJson([string]$mode, $entries, $yourScore) {
    $sb = New-Object System.Text.StringBuilder
    [void]$sb.Append('{')
    [void]$sb.Append('"mode":' + (Escape-JsonString $mode))
    [void]$sb.Append(',"entries":[')
    $first = $true
    foreach ($e in @($entries)) {
        if ($null -eq $e) { continue }
        if (-not $first) { [void]$sb.Append(',') }
        $first = $false
        [void]$sb.Append('{')
        [void]$sb.Append('"name":'  + (Escape-JsonString ([string]$e.name)) + ',')
        [void]$sb.Append('"score":' + [int]$e.score)
        if ($e.date) {
            [void]$sb.Append(',"date":' + (Escape-JsonString ([string]$e.date)))
        }
        [void]$sb.Append('}')
    }
    [void]$sb.Append(']')
    if ($null -ne $yourScore) {
        [void]$sb.Append(',"yourScore":' + [int]$yourScore)
    }
    [void]$sb.Append('}')
    return $sb.ToString()
}

function Write-JsonFile([string]$path, $obj) {
    $json = ConvertTo-CleanJson $obj
    [System.IO.File]::WriteAllText($path, $json, $script:Utf8NoBom)
}

function Read-JsonFile([string]$path) {
    if (-not (Test-Path $path -PathType Leaf)) { return $null }
    try {
        $raw = [System.IO.File]::ReadAllText($path, [System.Text.Encoding]::UTF8)
        if ([string]::IsNullOrWhiteSpace($raw)) { return $null }
        return $raw | ConvertFrom-Json
    } catch {
        Write-Host "Failed to parse JSON at ${path}: $_" -ForegroundColor Yellow
        return $null
    }
}


function Send-Bytes($res, [int]$status, [byte[]]$bytes, [string]$contentType) {
    $res.StatusCode = $status
    $res.ContentType = $contentType
    $res.AddHeader('X-Content-Type-Options', 'nosniff')
    $res.AddHeader('X-Frame-Options', 'DENY')
    $res.ContentLength64 = $bytes.Length
    $res.OutputStream.Write($bytes, 0, $bytes.Length)
    $res.Close()
}

function Send-Json($res, [int]$status, $obj, [string]$debugTag = '') {
    try {
        $json = ConvertTo-CleanJson $obj
    } catch {
        Write-Host "ConvertTo-Json failed: $_" -ForegroundColor Red
        $json = '{"error":"Serialization failed"}'
        $status = 500
    }

    if ($script:CONFIG.DebugLogJson -and $debugTag) {
        Write-Host "--- JSON [${debugTag}] ---" -ForegroundColor DarkCyan
        Write-Host $json -ForegroundColor DarkGray
        Write-Host "--- /JSON ---" -ForegroundColor DarkCyan
    }

    $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
    Send-Bytes $res $status $bytes 'application/json; charset=utf-8'
}

function Read-JsonBody($req) {
    if ($req.ContentLength64 -gt 262144) { return @{} }
    $reader = New-Object System.IO.StreamReader($req.InputStream, [System.Text.Encoding]::UTF8)
    $body   = $reader.ReadToEnd()
    $reader.Close()
    if ([string]::IsNullOrWhiteSpace($body)) { return @{} }
    try { return $body | ConvertFrom-Json } catch { return @{} }
}


function Get-Haversine([double]$lat1, [double]$lon1, [double]$lat2, [double]$lon2) {
    $R = 6371000.0
    $toRad = [Math]::PI / 180.0
    $dLat = ($lat2 - $lat1) * $toRad
    $dLon = ($lon2 - $lon1) * $toRad
    $sinLat = [Math]::Sin($dLat / 2.0)
    $sinLon = [Math]::Sin($dLon / 2.0)
    $a = $sinLat * $sinLat +
         [Math]::Cos($lat1 * $toRad) * [Math]::Cos($lat2 * $toRad) * $sinLon * $sinLon
    if ($a -lt 0) { $a = 0 }
    if ($a -gt 1) { $a = 1 }
    return 2.0 * $R * [Math]::Asin([Math]::Sqrt($a))
}

function Get-Score([string]$mode, [double]$distance) {
    if ($mode -eq 'russia') {
        if ($distance -le 5000)    { return 5000 }
        if ($distance -le 50000)   { return 3000 }
        if ($distance -le 300000)  { return 1000 }
        if ($distance -le 1000000) { return 300 }
        return 0
    }
    if ($distance -le $script:CONFIG.KrasGraceM) { return $script:CONFIG.MaxScore }
    $s = [Math]::Round($script:CONFIG.MaxScore * [Math]::Exp(-$distance / $script:CONFIG.KrasScoreK))
    if ($s -lt 0) { $s = 0 }
    if ($s -gt $script:CONFIG.MaxScore) { $s = $script:CONFIG.MaxScore }
    return [int]$s
}


function Test-PointInPolygon([double]$lat, [double]$lon, $polygon) {
    $pts = @($polygon)
    $n = $pts.Count
    if ($n -lt 3) { return $false }
    $inside = $false
    $j = $n - 1
    for ($i = 0; $i -lt $n; $i++) {
        $xi = [double]$pts[$i][1]
        $yi = [double]$pts[$i][0]
        $xj = [double]$pts[$j][1]
        $yj = [double]$pts[$j][0]
        if ((($yi -gt $lat) -ne ($yj -gt $lat)) -and
            ($lon -lt ($xj - $xi) * ($lat - $yi) / ($yj - $yi) + $xi)) {
            $inside = -not $inside
        }
        $j = $i
    }
    return $inside
}

function Get-ClosestPointOnSegment([double]$plat, [double]$plon, [double]$alat, [double]$alon, [double]$blat, [double]$blon) {
    $R = 6371000.0
    $toRad = [Math]::PI / 180.0
    $cosLat = [Math]::Cos($plat * $toRad)
    if ([Math]::Abs($cosLat) -lt 1e-6) { $cosLat = 1e-6 }

    $ax = ($alon - $plon) * $toRad * $R * $cosLat
    $ay = ($alat - $plat) * $toRad * $R
    $bx = ($blon - $plon) * $toRad * $R * $cosLat
    $by = ($blat - $plat) * $toRad * $R

    $dx = $bx - $ax
    $dy = $by - $ay
    $lenSq = $dx * $dx + $dy * $dy

    if ($lenSq -lt 1e-9) {
        return @{ Lat = $alat; Lon = $alon; Dist = [Math]::Sqrt($ax * $ax + $ay * $ay) }
    }

    $t = -($ax * $dx + $ay * $dy) / $lenSq
    if ($t -lt 0) { $t = 0.0 }
    if ($t -gt 1) { $t = 1.0 }

    $cLat = $alat + $t * ($blat - $alat)
    $cLon = $alon + $t * ($blon - $alon)
    $cx = $ax + $t * $dx
    $cy = $ay + $t * $dy
    $dist = [Math]::Sqrt($cx * $cx + $cy * $cy)

    return @{ Lat = $cLat; Lon = $cLon; Dist = $dist }
}

function Get-PolygonClosest([double]$lat, [double]$lon, $polygon) {
    $pts = @($polygon)
    $n = $pts.Count
    $bestDist = [double]::MaxValue
    $bestLat = 0.0
    $bestLon = 0.0
    for ($i = 0; $i -lt $n; $i++) {
        $j = ($i + 1) % $n
        $alat = [double]$pts[$i][0]
        $alon = [double]$pts[$i][1]
        $blat = [double]$pts[$j][0]
        $blon = [double]$pts[$j][1]
        $r = Get-ClosestPointOnSegment $lat $lon $alat $alon $blat $blon
        if ($r.Dist -lt $bestDist) {
            $bestDist = $r.Dist
            $bestLat  = $r.Lat
            $bestLon  = $r.Lon
        }
    }
    return @{ Lat = $bestLat; Lon = $bestLon; Dist = $bestDist }
}

function Pick-RandomItems($arr, [int]$n) {
    $copy = @($arr)
    for ($i = $copy.Count - 1; $i -gt 0; $i--) {
        $j = Get-Random -Minimum 0 -Maximum ($i + 1)
        $tmp = $copy[$i]; $copy[$i] = $copy[$j]; $copy[$j] = $tmp
    }
    if ($n -gt $copy.Count) { $n = $copy.Count }
    return ,$copy[0..($n - 1)]
}

function Find-Location([string]$mode, [string]$id) {
    $pool = $script:Locations.$mode
    if (-not $pool) { return $null }
    foreach ($loc in $pool) { if ($loc.id -eq $id) { return $loc } }
    return $null
}


$script:Sessions = @{}

function New-Session([string]$mode) {
    if (-not $script:MODE_LABELS.ContainsKey($mode)) {
        throw "Invalid mode: $mode"
    }
    $pool = $script:Locations.$mode
    if (-not $pool -or @($pool).Count -eq 0) {
        throw "Unknown or empty mode: $mode"
    }
    $picked = Pick-RandomItems $pool $script:CONFIG.RoundsPerGame
    $roundIds = @()
    foreach ($loc in $picked) { $roundIds += $loc.id }

    $id = [System.Guid]::NewGuid().ToString('N')
    $session = [PSCustomObject]@{
        Id                   = $id
        Mode                 = $mode
        RoundIds             = $roundIds
        CurrentIndex         = 0
        HintsUsed            = @{}
        NextHint             = 1
        HintPayloads         = @()
        Submitted            = $false
        LeaderboardSubmitted = $false
        SubmitResult         = $null
        Results              = @()
        CreatedAt            = (Get-Date).Ticks
        LastActionAt         = (Get-Date).Ticks
        LastSubmitAt         = 0
    }
    $script:Sessions[$id] = $session
    return $session
}

function Get-Session([string]$id) {
    if ([string]::IsNullOrEmpty($id)) { return $null }
    if (-not $script:Sessions.ContainsKey($id)) { return $null }
    $s = $script:Sessions[$id]
    $now = (Get-Date).Ticks
    $ageSec = ($now - $s.LastActionAt) / 10000000.0
    if ($ageSec -gt $script:CONFIG.SessionTTLsec) {
        $script:Sessions.Remove($id)
        return $null
    }
    $s.LastActionAt = $now
    return $s
}

function Reset-RoundState($session) {
    $session.HintsUsed    = @{}
    $session.NextHint     = 1
    $session.HintPayloads = @()
    $session.Submitted    = $false
    $session.SubmitResult = $null
}

function Get-RoundPublicView($session) {
    $roundId = $session.RoundIds[$session.CurrentIndex]
    $loc = Find-Location $session.Mode $roundId
    $rawImages = @($loc.images)
    $safeImages = @()
    for ($i = 0; $i -lt $rawImages.Count; $i++) {
        $img = [string]$rawImages[$i]
        if ($img -and -not ($img -match '^https?://')) {
            $safeImages += "/api/photo?s=$($session.Id)&r=$($session.CurrentIndex)&i=$i"
        } else {
            $safeImages += $img
        }
    }
    return [PSCustomObject]@{
        roundNumber   = $session.CurrentIndex + 1
        totalRounds   = $session.RoundIds.Count
        images        = @($safeImages)
        hintsApplied  = @($session.HintPayloads)
        submitted     = [bool]$session.Submitted
        submitResult  = $session.SubmitResult
    }
}


function Build-HintPayload($session, [int]$level) {
    $roundId = $session.RoundIds[$session.CurrentIndex]
    $loc = Find-Location $session.Mode $roundId
    $mode = $session.Mode

    if ($mode -eq 'russia') { return $null }  # Stage 4

    if ($level -eq 1) {
        $key = if ($loc.bank -eq 'right') { 'right' } else { 'left' }
        $b = $script:BANKS[$key]
        if (-not $b) { return $null }
        return [PSCustomObject]@{
            level       = 1
            type        = 'polygon'
            polygons    = @($b.polygons)
            fillColor   = $b.fillColor
            strokeColor = $b.strokeColor
            title       = $b.name
            html        = "Место на <strong>$($b.name.ToLower())</strong> Енисея."
        }
    }

    if ($level -eq 2) {
        $name = if ($loc.district) { $loc.district } else { 'Центральный' }
        $d = $script:DISTRICTS[$name]
        if (-not $d) { $d = $script:DISTRICTS['Центральный'] }
        if (-not $d) {
            return $null
        }
        return [PSCustomObject]@{
            level       = 2
            type        = 'polygon'
            polygons    = @($d.polygons)
            fillColor   = $d.fillColor
            strokeColor = $d.strokeColor
            title       = $name
            html        = "Район: <strong>$name</strong>."
        }
    }

    if ($level -eq 3) {
        $lat = [double]$loc.coords[0]
        $lon = [double]$loc.coords[1]
        $radius = [double]$script:CONFIG.HintRadius

        $angle = [double](Get-Random -Minimum 0 -Maximum 360000) * 2.0 * [Math]::PI / 360000.0
        $distFactor = 0.55 + ([double](Get-Random -Minimum 0 -Maximum 10000) / 10000.0) * 0.30
        $dist = $radius * $distFactor

        $cosLat = [Math]::Cos($lat * [Math]::PI / 180.0)
        if ([Math]::Abs($cosLat) -lt 1e-6) { $cosLat = 1e-6 }
        $dLat = ($dist * [Math]::Cos($angle)) / 111320.0
        $dLon = ($dist * [Math]::Sin($angle)) / (111320.0 * $cosLat)

        $cLat = $lat + $dLat
        $cLon = $lon + $dLon

        return [PSCustomObject]@{
            level       = 3
            type        = 'circle'
            center      = @($cLat, $cLon)
            radius      = $radius
            fillColor   = '#e4483a2d'
            strokeColor = '#e4483a'
            html        = "Место внутри зоны <strong>2 км</strong> на карте."
        }
    }

    return $null
}

function Build-RussiaHint($session, [int]$level) {
    $roundId = $session.RoundIds[$session.CurrentIndex]
    $loc = Find-Location $session.Mode $roundId
    if (-not $loc) { return $null }

    if ($level -eq 1) {
        $westCodes = @('ЦФО','СЗФО','ЮФО','СКФО','ПФО')
        $eastCodes = @('УФО','СФО','ДФО')
        $isWest = $westCodes -contains $loc.federal
        $codes  = if ($isWest) { $westCodes } else { $eastCodes }
        $partName = if ($isWest) { 'Европейской' } else { 'Азиатской' }

        $allPolygons = New-Object System.Collections.ArrayList
        foreach ($code in $codes) {
            $fdata = $script:FEDERALS[$code]
            if (-not $fdata) { continue }
            foreach ($ring in @($fdata.polygons)) {
                [void]$allPolygons.Add($ring)
            }
        }

        return [PSCustomObject]@{
            level       = 1
            type        = 'polygon'
            polygons    = @($allPolygons.ToArray())
            fillColor   = '#8b5cf618'
            strokeColor = '#7c3aed'
            html        = "Место в <strong>$partName части России</strong> (западнее/восточнее Урала)."
        }
    }

    if ($level -eq 2) {
        $fed = [string]$loc.federal
        $fedFull = if ($script:FEDERAL_NAMES[$fed]) { $script:FEDERAL_NAMES[$fed] } else { $fed }
        $payload = [PSCustomObject]@{
            level       = 2
            type        = 'polygon'
            polygons    = @()
            fillColor   = '#0284c722'
            strokeColor = '#0369a1'
            html        = "Федеральный округ: <strong>$fedFull ($fed)</strong>."
        }
        $fdata = $script:FEDERALS[$fed]
        if ($fdata) { $payload.polygons = @($fdata.polygons) }
        return $payload
    }

    if ($level -eq 3) {
        $region = [string]$loc.region
        $payload = [PSCustomObject]@{
            level       = 3
            type        = 'polygon'
            polygons    = @()
            fillColor   = '#e4483a22'
            strokeColor = '#e4483a'
            html        = "Субъект РФ: <strong>$region</strong>."
        }
        $rdata = $script:REGIONS[$region]
        if ($rdata) { $payload.polygons = @($rdata.polygons) }
        return $payload
    }

    return $null
}


function Get-LeaderboardData {
    $data = Read-JsonFile $leaderboardFile
    if (-not $data) {
        $data = [PSCustomObject]@{
            krasnoyarsk = @()
            sfu         = @()
            russia      = @()
        }
    }
    foreach ($k in @('krasnoyarsk','sfu','russia')) {
        $val = $data.$k
        if ($null -eq $val) {
            $data | Add-Member -NotePropertyName $k -NotePropertyValue @() -Force
        }
    }
    return $data
}

function Get-Leaderboard([string]$mode, [int]$limit = 20) {
    $data = Get-LeaderboardData
    $raw = $data.$mode
    $list = New-Object System.Collections.ArrayList
    if ($null -ne $raw) {
        foreach ($e in @($raw)) {
            if ($null -ne $e -and $null -ne $e.name -and $null -ne $e.score) {
                [void]$list.Add($e)
            }
        }
    }
    $sorted = @($list | Sort-Object -Property @{Expression = {[int]$_.score}} -Descending)
    if ($sorted.Count -gt $limit) { $sorted = $sorted[0..($limit - 1)] }
    return $sorted
}

function Add-LeaderboardEntry([string]$mode, [string]$name, [int]$score) {
    $data = Get-LeaderboardData

    $existing = New-Object System.Collections.ArrayList
    if ($null -ne $data.$mode) {
        foreach ($e in @($data.$mode)) {
            if ($null -ne $e -and $null -ne $e.name) {
                [void]$existing.Add($e)
            }
        }
    }
    [void]$existing.Add([PSCustomObject]@{
        name  = $name
        score = $score
        date  = (Get-Date).ToString('yyyy-MM-ddTHH:mm:ss')
    })

    $sorted = @($existing | Sort-Object -Property @{Expression = {[int]$_.score}} -Descending)
    if ($sorted.Count -gt $script:CONFIG.LeaderboardMax) {
        $sorted = $sorted[0..($script:CONFIG.LeaderboardMax - 1)]
    }

    $newData = [PSCustomObject]@{
        krasnoyarsk = @()
        sfu         = @()
        russia      = @()
    }
    foreach ($k in @('krasnoyarsk','sfu','russia')) {
        if ($k -eq $mode) { continue }
        $val = $data.$k
        if ($null -ne $val) { $newData.$k = @($val) }
    }
    $newData.$mode = $sorted

    try {
        Write-JsonFile $leaderboardFile $newData
    } catch {
        Write-Host "Failed to save leaderboard: $_" -ForegroundColor Yellow
    }
}

function Handle-Api($ctx) {
    $req = $ctx.Request
    $res = $ctx.Response
    $path   = $req.Url.LocalPath
    $method = $req.HttpMethod

    if ($method -eq 'GET' -and $path -eq '/api/leaderboard') {
        $mode = [string]$req.QueryString['mode']
        if ([string]::IsNullOrEmpty($mode) -or -not $script:MODE_LABELS.ContainsKey($mode)) {
            $mode = 'krasnoyarsk'
        }
        $entries = Get-Leaderboard $mode $script:CONFIG.LeaderboardLimit
        $json = Build-LeaderboardJson $mode $entries $null
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        Send-Bytes $res 200 $bytes 'application/json; charset=utf-8'
        return
    }

    if ($method -eq 'GET' -and $path -eq '/api/photo') {
        $sid = [string]$req.QueryString['s']
        $rIdx = -1
        $iIdx = -1
        [void][int]::TryParse([string]$req.QueryString['r'], [ref]$rIdx)
        [void][int]::TryParse([string]$req.QueryString['i'], [ref]$iIdx)
        $session = Get-Session $sid
        if (-not $session -or $rIdx -ne $session.CurrentIndex -or $iIdx -lt 0) {
            Send-Bytes $res 403 ([System.Text.Encoding]::UTF8.GetBytes("403 Forbidden")) 'text/plain; charset=utf-8'
            return
        }
        $roundId = $session.RoundIds[$session.CurrentIndex]
        $loc = Find-Location $session.Mode $roundId
        $imgs = @($loc.images)
        if ($iIdx -ge $imgs.Count) {
            Send-Bytes $res 404 ([System.Text.Encoding]::UTF8.GetBytes("404 Not Found")) 'text/plain; charset=utf-8'
            return
        }
        $relImg = ([string]$imgs[$iIdx]).TrimStart('/')
        $webRootFull = [System.IO.Path]::GetFullPath($webRoot)
        try {
            $imgPath = [System.IO.Path]::GetFullPath((Join-Path $webRootFull $relImg))
        } catch {
            Send-Bytes $res 400 ([System.Text.Encoding]::UTF8.GetBytes("400 Bad Request")) 'text/plain; charset=utf-8'
            return
        }
        if (-not $imgPath.StartsWith($webRootFull, [System.StringComparison]::OrdinalIgnoreCase) -or -not (Test-Path $imgPath -PathType Leaf)) {
            Send-Bytes $res 404 ([System.Text.Encoding]::UTF8.GetBytes("404 Not Found")) 'text/plain; charset=utf-8'
            return
        }
        $bytes = [System.IO.File]::ReadAllBytes($imgPath)
        $ext = [System.IO.Path]::GetExtension($imgPath).ToLower()
        $ct = if ($MIME.ContainsKey($ext)) { $MIME[$ext] } else { 'application/octet-stream' }
        Send-Bytes $res 200 $bytes $ct
        return
    }

    if ($method -ne 'POST') {
        Send-Json $res 405 @{ error = 'Method not allowed' }
        return
    }

    $body = Read-JsonBody $req

    if ($path -eq '/api/dev/locations') {
        $key = [string]$body.key
        if ([string]::IsNullOrEmpty($key) -or $key.Trim().ToUpper() -ne $script:DEV_KEY) {
            Send-Json $res 403 @{ error = 'Forbidden' }
            return
        }
        Send-Json $res 200 @{
            krasnoyarsk = @($script:Locations.krasnoyarsk)
            sfu         = @($script:Locations.sfu)
            russia      = @($script:Locations.russia)
            banks       = $script:BANKS
            districts   = $script:DISTRICTS
        }
        return
    }

    if ($path -eq '/api/dev/update-location') {
        $key = [string]$body.key
        if ([string]::IsNullOrEmpty($key) -or $key.Trim().ToUpper() -ne $script:DEV_KEY) {
            Send-Json $res 403 @{ error = 'Forbidden' }
            return
        }
        $mode  = [string]$body.mode
        $id    = [string]$body.id
        $patch = $body.patch
        if (-not $mode -or -not $id -or -not $patch) {
            Send-Json $res 400 @{ error = 'mode, id, patch required' }
            return
        }
        $pool = $script:Locations.$mode
        if (-not $pool) { Send-Json $res 400 @{ error = "unknown mode: $mode" }; return }

        $found = $null
        foreach ($loc in $pool) {
            if ($loc.id -eq $id) { $found = $loc; break }
        }
        if (-not $found) { Send-Json $res 404 @{ error = "location not found: $id" }; return }


        foreach ($field in @('name','address','district','federal','bank','region')) {
            if ($patch.PSObject.Properties.Name -contains $field) {
                $val = [string]$patch.$field
                $found | Add-Member -NotePropertyName $field -NotePropertyValue $val -Force
            }
        }

        if ($patch.PSObject.Properties.Name -contains 'coords') {
            $c = $patch.coords
            if (@($c).Count -eq 2) {
                $lat = [double]$c[0]
                $lon = [double]$c[1]
                if (-not [double]::IsNaN($lat) -and -not [double]::IsNaN($lon) -and
                    [Math]::Abs($lat) -le 90 -and [Math]::Abs($lon) -le 180) {
                    $found | Add-Member -NotePropertyName 'coords' -NotePropertyValue @($lat, $lon) -Force
                } else {
                    Send-Json $res 400 @{ error = 'Invalid coords' }
                    return
                }
            }
        }

        if ($patch.PSObject.Properties.Name -contains 'images') {
            $imgs = @()
            foreach ($u in @($patch.images)) {
                $str = [string]$u
                if (-not [string]::IsNullOrWhiteSpace($str)) {
                    $imgs += $str.Trim()
                }
            }
            if ($imgs.Count -eq 0) { $imgs = @('') }
            $found | Add-Member -NotePropertyName 'images' -NotePropertyValue @($imgs) -Force
        }

        if ($patch.PSObject.Properties.Name -contains 'polygon') {
            $poly = $patch.polygon
            if ($null -eq $poly) {
                $found | Add-Member -NotePropertyName 'polygon' -NotePropertyValue $null -Force
            } else {
                $pts = @($poly)
                if ($pts.Count -eq 0) {
                    $found | Add-Member -NotePropertyName 'polygon' -NotePropertyValue $null -Force
                } else {
                    $validPts = @()
                    $ok = $true
                    foreach ($pt in $pts) {
                        $pArr = @($pt)
                        if ($pArr.Count -ne 2) { $ok = $false; break }
                        $plat = [double]$pArr[0]
                        $plon = [double]$pArr[1]
                        if ([double]::IsNaN($plat) -or [double]::IsNaN($plon) -or
                            [Math]::Abs($plat) -gt 90 -or [Math]::Abs($plon) -gt 180) {
                            $ok = $false; break
                        }
                        $validPts += ,@($plat, $plon)
                    }
                    if (-not $ok) {
                        Send-Json $res 400 @{ error = 'Invalid polygon point' }
                        return
                    }
                    $found | Add-Member -NotePropertyName 'polygon' -NotePropertyValue @($validPts) -Force
                }
            }
        }

        try {
            Write-JsonFile $locationsFile $script:Locations
        } catch {
            Write-Host "Save locations failed: $_" -ForegroundColor Red
            Send-Json $res 500 @{ error = "Save failed: $($_.Exception.Message)" }
            return
        }

        Send-Json $res 200 @{ ok = $true; location = $found }
        return
    }

    if ($path -eq '/api/session') {
        $mode = [string]$body.mode
        try {
            $session = New-Session $mode
            $label = if ($script:MODE_LABELS[$mode]) { $script:MODE_LABELS[$mode] } else { $mode }
            Send-Json $res 200 @{
                sessionId   = $session.Id
                mode        = $mode
                modeLabel   = $label
                totalRounds = $session.RoundIds.Count
            }
        } catch {
            Send-Json $res 400 @{ error = "$_" }
        }
        return
    }

    if ($path -eq '/api/dev/add-location') {
        $key = [string]$body.key
        if ([string]::IsNullOrEmpty($key) -or $key.Trim().ToUpper() -ne $script:DEV_KEY) {
            Send-Json $res 403 @{ error = 'Forbidden' }
            return
        }
        $mode = [string]$body.mode
        $loc  = $body.location
        if (-not $mode -or -not $loc) {
            Send-Json $res 400 @{ error = 'mode, location required' }
            return
        }
        $pool = $script:Locations.$mode
        if (-not $pool) { Send-Json $res 400 @{ error = "unknown mode: $mode" }; return }

        $id = [string]$loc.id
        if ([string]::IsNullOrWhiteSpace($id)) {
            $prefix = switch ($mode) {
                'krasnoyarsk' { 'kras' }
                'sfu'         { 'sfu'  }
                'russia'      { 'rus'  }
                default       { 'loc'  }
            }
            $maxN = 0
            foreach ($l in $pool) {
                $lid = [string]$l.id
                if ($lid -match '(\d+)$') {
                    $n = [int]$matches[1]
                    if ($n -gt $maxN) { $maxN = $n }
                }
            }
            $id = "$prefix-" + ("{0:D3}" -f ($maxN + 1))
        }

        foreach ($l in $pool) {
            if ($l.id -eq $id) {
                Send-Json $res 400 @{ error = "id already exists: $id" }
                return
            }
        }

        $coords = @($loc.coords)
        if ($coords.Count -ne 2) { Send-Json $res 400 @{ error = 'coords required' }; return }
        $lat = [double]$coords[0]
        $lon = [double]$coords[1]
        if ([double]::IsNaN($lat) -or [double]::IsNaN($lon) -or
            [Math]::Abs($lat) -gt 90 -or [Math]::Abs($lon) -gt 180) {
            Send-Json $res 400 @{ error = 'Invalid coords' }
            return
        }

        $newLoc = [PSCustomObject]@{
            id      = $id
            name    = if ($loc.name) { [string]$loc.name } else { 'Новая локация' }
            coords  = @($lat, $lon)
            address = if ($loc.address) { [string]$loc.address } else { '' }
        }

        $imgs = @()
        if ($loc.images) {
            foreach ($u in @($loc.images)) {
                $s = [string]$u
                if (-not [string]::IsNullOrWhiteSpace($s)) { $imgs += $s.Trim() }
            }
        }
        if ($imgs.Count -eq 0) { $imgs = @('') }
        $newLoc | Add-Member -NotePropertyName images -NotePropertyValue @($imgs) -Force

        if ($mode -eq 'russia') {
            $newLoc | Add-Member -NotePropertyName federal -NotePropertyValue ([string]$loc.federal) -Force
            $newLoc | Add-Member -NotePropertyName region  -NotePropertyValue ([string]$loc.region) -Force
        } else {
            $newLoc | Add-Member -NotePropertyName district -NotePropertyValue ([string]$loc.district) -Force
            $newLoc | Add-Member -NotePropertyName bank     -NotePropertyValue ([string]$loc.bank) -Force
        }

        $script:Locations | Add-Member -NotePropertyName $mode -NotePropertyValue @(@($pool) + $newLoc) -Force

        try {
            Write-JsonFile $locationsFile $script:Locations
        } catch {
            Send-Json $res 500 @{ error = "Save failed: $($_.Exception.Message)" }
            return
        }

        Send-Json $res 200 @{ ok = $true; location = $newLoc }
        return
    }

    if ($path -eq '/api/dev/delete-location') {
        $key = [string]$body.key
        if ([string]::IsNullOrEmpty($key) -or $key.Trim().ToUpper() -ne $script:DEV_KEY) {
            Send-Json $res 403 @{ error = 'Forbidden' }
            return
        }
        $mode = [string]$body.mode
        $id   = [string]$body.id
        if (-not $mode -or -not $id) {
            Send-Json $res 400 @{ error = 'mode, id required' }
            return
        }
        $pool = $script:Locations.$mode
        if (-not $pool) { Send-Json $res 400 @{ error = "unknown mode: $mode" }; return }

        $newPool = @()
        $found = $false
        foreach ($l in $pool) {
            if ($l.id -eq $id) { $found = $true; continue }
            $newPool += $l
        }
        if (-not $found) { Send-Json $res 404 @{ error = "not found: $id" }; return }

        $script:Locations | Add-Member -NotePropertyName $mode -NotePropertyValue @($newPool) -Force

        try {
            Write-JsonFile $locationsFile $script:Locations
        } catch {
            Send-Json $res 500 @{ error = "Save failed: $($_.Exception.Message)" }
            return
        }

        Send-Json $res 200 @{ ok = $true }
        return
    }

    $sid = [string]$body.sessionId
    $session = Get-Session $sid
    if (-not $session) {
        Send-Json $res 401 @{ error = 'Invalid or expired session' }
        return
    }

    if ($path -eq '/api/round') {
        if ($session.CurrentIndex -ge $session.RoundIds.Count) {
            Send-Json $res 200 @{ finished = $true }
            return
        }
        Send-Json $res 200 (Get-RoundPublicView $session)
        return
    }

    if ($path -eq '/api/hint') {
        if ($session.Submitted) { Send-Json $res 400 @{ error = 'Round already submitted' }; return }
        $level = [int]$body.level
        if ($level -lt 1 -or $level -gt 3) { Send-Json $res 400 @{ error = 'Invalid level' }; return }
        if ($session.HintsUsed.ContainsKey("$level")) { Send-Json $res 400 @{ error = 'Hint already used' }; return }
        if ($level -gt $session.NextHint) { Send-Json $res 400 @{ error = 'Previous hint required first' }; return }

        $payload = $null
        try {
            if ($session.Mode -eq 'russia') {
                $payload = Build-RussiaHint $session $level
            } else {
                $payload = Build-HintPayload $session $level
            }
        } catch {
            Write-Host "Build-HintPayload error: $_" -ForegroundColor Red
            Write-Host $_.ScriptStackTrace -ForegroundColor Red
            Send-Json $res 500 @{ error = "Hint build failed: $($_.Exception.Message)" }
            return
        }

        if (-not $payload) { Send-Json $res 400 @{ error = 'Hint not available' }; return }

        for ($i = 1; $i -le $level; $i++) { $session.HintsUsed["$i"] = $true }
        $session.NextHint = $level + 1
        $session.HintPayloads = @($session.HintPayloads) + $payload

        Send-Json $res 200 @{ hint = $payload; nextHint = $session.NextHint } "hint-lvl$level"
        return
    }

if ($path -eq '/api/submit') {
        if ($session.Submitted -or $session.Results.Count -ge $session.RoundIds.Count) {
            Send-Json $res 400 @{ error = 'Already submitted' }
            return
        }

        $nowTicks = (Get-Date).Ticks
        $deltaSec = ($nowTicks - $session.LastSubmitAt) / 10000000.0
        if ($session.LastSubmitAt -gt 0 -and $deltaSec -lt $script:CONFIG.MinSubmitInterval) {
            Send-Json $res 429 @{ error = 'Too fast' }
            return
        }
        $session.LastSubmitAt = $nowTicks

        $g = $body.guess
        if ($null -eq $g -or @($g).Count -ne 2 -or $null -eq $g[0] -or $null -eq $g[1] -or
            $g[0] -is [bool] -or $g[1] -is [bool]) {
            Send-Json $res 400 @{ error = 'Invalid guess coordinates' }
            return
        }
        try {
            $gLat = [double]$g[0]
            $gLon = [double]$g[1]
        } catch {
            Send-Json $res 400 @{ error = 'Invalid guess coordinates' }
            return
        }
        if ([double]::IsNaN($gLat) -or [double]::IsNaN($gLon) -or
            [double]::IsInfinity($gLat) -or [double]::IsInfinity($gLon) -or
            [Math]::Abs($gLat) -gt 90 -or [Math]::Abs($gLon) -gt 180) {
            Send-Json $res 400 @{ error = 'Invalid guess coordinates' }
            return
        }

        $roundId = $session.RoundIds[$session.CurrentIndex]
        $loc = Find-Location $session.Mode $roundId
        $tLat = [double]$loc.coords[0]
        $tLon = [double]$loc.coords[1]
        $distance = Get-Haversine $tLat $tLon $gLat $gLon

        $basePoints = Get-Score $session.Mode $distance

        $mult = 1.0
        foreach ($k in $session.HintsUsed.Keys) {
            $p = $script:CONFIG.HintPenalty[$k]
            if ($p -and $p -lt $mult) { $mult = $p }
        }
        $points = [Math]::Round($basePoints * $mult)
        if ($points -gt $script:CONFIG.MaxScore) { $points = $script:CONFIG.MaxScore }
        if ($points -lt 0) { $points = 0 }

        $hintsArr = @()
        foreach ($k in $session.HintsUsed.Keys) { $hintsArr += [int]$k }
        $hintsArr = @($hintsArr | Sort-Object)

        $target = [PSCustomObject]@{
            name    = $loc.name
            address = $loc.address
            coords  = @($tLat, $tLon)
            polygon = $loc.polygon
        }

        $result = [PSCustomObject]@{
            roundNumber = $session.CurrentIndex + 1
            target      = $target
            guess       = @($gLat, $gLon)
            distance    = [Math]::Round($distance, 2)
            basePoints  = $basePoints
            multiplier  = $mult
            hintsUsed   = $hintsArr
            points      = [int]$points
        }

        $session.Submitted = $true
        $session.SubmitResult = $result
        $session.Results = @($session.Results) + $result

        Send-Json $res 200 @{ result = $result } "submit"
        return
    }

    if ($path -eq '/api/next') {
        if (-not $session.Submitted) { Send-Json $res 400 @{ error = 'Round not submitted yet' }; return }
        $session.CurrentIndex = $session.CurrentIndex + 1
        if ($session.CurrentIndex -ge $session.RoundIds.Count) {
            Send-Json $res 200 @{ finished = $true }
            return
        }
        Reset-RoundState $session
        Send-Json $res 200 (Get-RoundPublicView $session)
        return
    }

    if ($path -eq '/api/final') {
        $total = 0
        foreach ($r in $session.Results) { $total += $r.points }
        $max = $session.RoundIds.Count * $script:CONFIG.MaxScore
        $label = if ($script:MODE_LABELS[$session.Mode]) { $script:MODE_LABELS[$session.Mode] } else { $session.Mode }

        $results = @()
        $idx = 0
        foreach ($r in $session.Results) {
            $results += [PSCustomObject]@{
                roundNumber = $idx + 1
                name        = $r.target.name
                address     = $r.target.address
                distance    = $r.distance
                points      = $r.points
                hintsUsed   = @($r.hintsUsed).Count
                multiplier  = $r.multiplier
            }
            $idx++
        }

        Send-Json $res 200 @{
            total     = $total
            max       = $max
            mode      = $session.Mode
            modeLabel = $label
            results   = $results
        }
        return
    }

if ($path -eq '/api/leaderboard/submit') {
        if ($session.Results.Count -lt $session.RoundIds.Count) {
            Send-Json $res 400 @{ error = 'Game not finished' }
            return
        }
        if ($session.LeaderboardSubmitted) {
            Send-Json $res 400 @{ error = 'Score already saved for this session' }
            return
        }
        $rawName = [string]$body.name
        # Удаляем HTML-теги, кавычки и управляющие символы
        $name = ($rawName -replace '[<>"''&\x00-\x1F\x7F]', '').Trim()
        if ([string]::IsNullOrWhiteSpace($name)) {
            Send-Json $res 400 @{ error = 'Name required' }
            return
        }
        if ($name.Length -gt 20) { $name = $name.Substring(0, 20) }

        $maxPossible = $session.RoundIds.Count * $script:CONFIG.MaxScore
        $total = 0
        foreach ($r in $session.Results) {
            $pts = [Math]::Max(0, [Math]::Min($script:CONFIG.MaxScore, [int]$r.points))
            $total += $pts
        }
        $total = [Math]::Max(0, [Math]::Min($maxPossible, [int]$total))

        $session.LeaderboardSubmitted = $true
        Add-LeaderboardEntry $session.Mode $name $total
        $entries = Get-Leaderboard $session.Mode $script:CONFIG.LeaderboardLimit

        $json = Build-LeaderboardJson $session.Mode $entries $total
        if ($script:CONFIG.DebugLogJson) {
            Write-Host "--- JSON [leaderboard:submit] ---" -ForegroundColor DarkCyan
            Write-Host $json -ForegroundColor DarkGray
        }
        $bytes = [System.Text.Encoding]::UTF8.GetBytes($json)
        Send-Bytes $res 200 $bytes 'application/json; charset=utf-8'
        return
    }

    Send-Json $res 404 @{ error = 'Not found' }
}


$MIME = @{
    '.html' = 'text/html; charset=utf-8'
    '.css'  = 'text/css; charset=utf-8'
    '.js'   = 'application/javascript; charset=utf-8'
    '.mjs'  = 'application/javascript; charset=utf-8'
    '.json' = 'application/json; charset=utf-8'
    '.webp' = 'image/webp'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.png'  = 'image/png'
    '.svg'  = 'image/svg+xml'
    '.ico'  = 'image/x-icon'
    '.woff' = 'font/woff'
    '.woff2'= 'font/woff2'
}

function Serve-Static($ctx) {
    $req = $ctx.Request
    $res = $ctx.Response
    $urlPath = $req.Url.LocalPath
    if ($urlPath -eq '/') { $urlPath = '/index.html' }

    $rel = $urlPath.TrimStart('/')
    $webRootFull = [System.IO.Path]::GetFullPath($webRoot)
    try {
        $filePath = [System.IO.Path]::GetFullPath((Join-Path $webRootFull $rel))
    } catch {
        Send-Bytes $res 400 ([System.Text.Encoding]::UTF8.GetBytes("400 Bad Request")) 'text/plain; charset=utf-8'
        return
    }

    if (-not $filePath.StartsWith($webRootFull, [System.StringComparison]::OrdinalIgnoreCase)) {
        Send-Bytes $res 403 ([System.Text.Encoding]::UTF8.GetBytes("403 Forbidden")) 'text/plain; charset=utf-8'
        return
    }
    $fileName = [System.IO.Path]::GetFileName($filePath).ToLower()
    if ($fileName -in @('locations.json', 'leaderboard.json', 'start.ps1', 'start.bat')) {
        Send-Bytes $res 403 ([System.Text.Encoding]::UTF8.GetBytes("403 Forbidden")) 'text/plain; charset=utf-8'
        return
    }

    if (-not (Test-Path $filePath -PathType Leaf)) {
        $bytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
        Send-Bytes $res 404 $bytes 'text/plain; charset=utf-8'
        return
    }
    try {
        $bytes = [System.IO.File]::ReadAllBytes($filePath)
    } catch {
        Send-Bytes $res 500 ([System.Text.Encoding]::UTF8.GetBytes("500")) 'text/plain; charset=utf-8'
        return
    }
    $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
    $ct = if ($MIME.ContainsKey($ext)) { $MIME[$ext] } else { 'application/octet-stream' }
    Send-Bytes $res 200 $bytes $ct
}



$port = 8000
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Prefixes.Add("http://127.0.0.1:$port/")

try {
    $listener.Start()
} catch {
    Write-Host ""
    Write-Host "Failed to start HTTP listener: $_" -ForegroundColor Red
    Write-Host "Возможно, порт $port занят." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "  KrasnoyarskGuesser — server is running" -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "  URL:  http://localhost:$port"
Write-Host "  Root: $webRoot"
Write-Host "  Data: $dataDir"
Write-Host ""
Write-Host "  DEV MODE KEY: $script:DEV_KEY" -ForegroundColor Magenta
Write-Host "  (Ctrl+Shift+D в игре → ввести этот ключ один раз)" -ForegroundColor DarkMagenta
Write-Host ""
Write-Host "  Don't close this window while playing." -ForegroundColor Yellow
Write-Host "  Press Ctrl+C to stop the server." -ForegroundColor Yellow
Write-Host ""

Start-Process "http://localhost:$port"

try {
    while ($listener.IsListening) {
        $ctx = $listener.GetContext()
        try {
            if ($ctx.Request.Url.LocalPath.StartsWith('/api/')) {
                Handle-Api $ctx
            } else {
                Serve-Static $ctx
            }
        } catch {
            Write-Host "Request error: $_" -ForegroundColor Red
            Write-Host $_.ScriptStackTrace -ForegroundColor DarkRed
            try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch {}
        }
    }
}
finally {
    $listener.Stop()
    $listener.Close()
}