# Build-time snapshot. Each game/UI-language pair is loaded independently.
$ErrorActionPreference = 'Stop'
$sites = [ordered]@{ ko='poe.kakaogames.com'; en='www.pathofexile.com'; ja='jp.pathofexile.com';
    fr='fr.pathofexile.com'; de='de.pathofexile.com'; es='es.pathofexile.com'; pt='br.pathofexile.com';
    ru='ru.pathofexile.com'; th='th.pathofexile.com'; tw='pathofexile.tw' }
foreach ($game in 'poe1','poe2') {
    $api = if ($game -eq 'poe1') { 'trade' } else { 'trade2' }
    $dir = Join-Path $PSScriptRoot "../extension/src/assets/trade-filters/$game"
    [IO.Directory]::CreateDirectory($dir) | Out-Null
    foreach ($lang in $sites.Keys) {
        $base = "https://$($sites[$lang])/api/$api/data"
        $pack = [ordered]@{ stats=[ordered]@{}; fields=[ordered]@{}; options=[ordered]@{}; groups=[ordered]@{} }
        foreach ($kind in 'stats','filters') {
            $catalog = Invoke-RestMethod "$base/$kind" -TimeoutSec 40
            foreach ($group in $catalog.result) {
                if ($kind -eq 'stats' -and $group.entries.Count) {
                    $pack.groups[$group.id] = @{label=$group.label; type=$group.entries[0].type}
                }
                $entries = if ($kind -eq 'stats') { $group.entries } else { $group.filters }
                foreach ($entry in $entries) {
                    if (!$entry.id) { continue }
                    $key = if ($kind -eq 'stats') { $entry.id } else { "$($group.id).$($entry.id)" }
                    if ($entry.text) {
                        if ($kind -eq 'stats') { $pack.stats[$key] = $entry.text }
                        else { $pack.fields[$key] = $entry.text }
                    }
                    $options = [ordered]@{}
                    foreach ($opt in $entry.option.options) {
                        if ($null -ne $opt.id -and $opt.text) { $options[[string]$opt.id] = $opt.text }
                    }
                    if ($options.Count) { $pack.options[$key] = $options }
                }
            }
        }
        if (!$pack.stats.Count -or !$pack.fields.Count) { throw "Empty catalog at $base" }
        [IO.File]::WriteAllText((Join-Path $dir "$lang.json"), (ConvertTo-Json $pack -Depth 6 -Compress), [Text.UTF8Encoding]::new($false))
        Write-Output "$game/$lang"
    }
}
