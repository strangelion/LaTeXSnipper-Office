[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$ManifestPath,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
$maximumXmlPartBytes = 16MB
$maximumPackageEntries = 10000
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot ".."))

Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Resolve-RepositoryPath {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        throw "OOXML manifest contains an empty path."
    }
    if ([System.IO.Path]::IsPathRooted($Path)) {
        return [System.IO.Path]::GetFullPath($Path)
    }
    return [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot $Path))
}

function Get-RelativeRepositoryPath {
    param([string]$Path)

    $fullPath = [System.IO.Path]::GetFullPath($Path)
    $prefix = $repositoryRoot.TrimEnd('\', '/') + [System.IO.Path]::DirectorySeparatorChar
    if (-not $fullPath.StartsWith($prefix, [System.StringComparison]::OrdinalIgnoreCase)) {
        return $fullPath
    }
    return $fullPath.Substring($prefix.Length).Replace('\', '/')
}

function Get-FileSha256 {
    param([string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($algorithm.ComputeHash($stream))).Replace("-", "")
    }
    finally {
        $algorithm.Dispose()
        $stream.Dispose()
    }
}

function Get-StreamSha256 {
    param([System.IO.Stream]$Stream)

    $algorithm = [System.Security.Cryptography.SHA256]::Create()
    try {
        return ([System.BitConverter]::ToString($algorithm.ComputeHash($Stream))).Replace("-", "")
    }
    finally {
        $algorithm.Dispose()
    }
}

function Add-Matches {
    param(
        [hashtable]$Counts,
        [string]$Text,
        [string]$Name,
        [string]$Pattern
    )

    $Counts[$Name] += [regex]::Matches(
        $Text,
        $Pattern,
        [System.Text.RegularExpressions.RegexOptions]::IgnoreCase
    ).Count
}

function Get-PackageSnapshot {
    param([string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "OOXML package not found: $Path"
    }
    $extension = [System.IO.Path]::GetExtension($Path).ToLowerInvariant()
    if ($extension -notin @(".docx", ".xlsx", ".pptx")) {
        throw "Unsupported OOXML package extension '$extension': $Path"
    }

    $semanticCounts = @{
        bookmarks = 0
        contentControls = 0
        externalRelationships = 0
        fieldInstructions = 0
        formulaMetadataMarkers = 0
        mathObjects = 0
        pictures = 0
        relationshipElements = 0
        sequenceFields = 0
        referenceFields = 0
        pageReferenceFields = 0
        styleReferenceFields = 0
    }
    $parts = [System.Collections.Generic.List[object]]::new()
    $archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        if ($archive.Entries.Count -gt $maximumPackageEntries) {
            throw "OOXML package has too many entries ($($archive.Entries.Count)): $Path"
        }
        foreach ($entry in ($archive.Entries | Sort-Object FullName)) {
            if ([string]::IsNullOrEmpty($entry.Name)) {
                continue
            }
            $entryStream = $entry.Open()
            try {
                $entryHash = Get-StreamSha256 -Stream $entryStream
            }
            finally {
                $entryStream.Dispose()
            }

            $normalizedName = $entry.FullName.Replace('\', '/')
            $category = if ($normalizedName -match '(^|/)embeddings/') {
                "embedding"
            }
            elseif ($normalizedName -match '(^|/)media/') {
                "media"
            }
            elseif ($normalizedName.EndsWith(".rels", [System.StringComparison]::OrdinalIgnoreCase)) {
                "relationships"
            }
            elseif ($normalizedName.EndsWith(".xml", [System.StringComparison]::OrdinalIgnoreCase)) {
                "xml"
            }
            else {
                "binary"
            }
            $parts.Add([ordered]@{
                name = $normalizedName
                category = $category
                uncompressedBytes = [long]$entry.Length
                compressedBytes = [long]$entry.CompressedLength
                sha256 = $entryHash
            })

            if ($category -notin @("xml", "relationships") -or
                $entry.Length -gt $maximumXmlPartBytes) {
                continue
            }
            $xmlStream = $entry.Open()
            $reader = [System.IO.StreamReader]::new(
                $xmlStream,
                [System.Text.Encoding]::UTF8,
                $true,
                4096,
                $false
            )
            try {
                $text = $reader.ReadToEnd()
            }
            finally {
                $reader.Dispose()
                $xmlStream.Dispose()
            }
            Add-Matches $semanticCounts $text "mathObjects" '<m:oMath(?:\s|>)'
            Add-Matches $semanticCounts $text "contentControls" '<w:sdt(?:\s|>)'
            Add-Matches $semanticCounts $text "bookmarks" '<w:bookmarkStart(?:\s|>)'
            Add-Matches $semanticCounts $text "fieldInstructions" '<w:instrText(?:\s|>)'
            Add-Matches $semanticCounts $text "sequenceFields" '\bSEQ\s+LaTeXSnipperEquation\b'
            Add-Matches $semanticCounts $text "referenceFields" '(?<!PAGE)\bREF\s+LSNEq_'
            Add-Matches $semanticCounts $text "pageReferenceFields" '\bPAGEREF\s+LSNEq_'
            Add-Matches $semanticCounts $text "styleReferenceFields" '\bSTYLEREF\b'
            Add-Matches $semanticCounts $text "relationshipElements" '<Relationship(?:\s|>)'
            Add-Matches $semanticCounts $text "externalRelationships" 'TargetMode\s*=\s*["'']External["'']'
            Add-Matches $semanticCounts $text "pictures" '<(?:p:pic|xdr:pic|w:drawing)(?:\s|>)'
            Add-Matches $semanticCounts $text "formulaMetadataMarkers" 'LaTeXSnipper'
        }
    }
    finally {
        $archive.Dispose()
    }

    $embeddingCount = @($parts | Where-Object { $_.category -eq "embedding" }).Count
    $mediaCount = @($parts | Where-Object { $_.category -eq "media" }).Count
    $xmlCount = @($parts | Where-Object {
        $_.category -in @("xml", "relationships")
    }).Count
    return [ordered]@{
        path = Get-RelativeRepositoryPath $Path
        extension = $extension
        packageBytes = [long](Get-Item -LiteralPath $Path).Length
        packageSha256 = Get-FileSha256 $Path
        entryCount = $parts.Count
        xmlPartCount = $xmlCount
        mediaPartCount = $mediaCount
        embeddingPartCount = $embeddingCount
        semanticCounts = [ordered]@{
            mathObjects = $semanticCounts.mathObjects
            contentControls = $semanticCounts.contentControls
            bookmarks = $semanticCounts.bookmarks
            fieldInstructions = $semanticCounts.fieldInstructions
            sequenceFields = $semanticCounts.sequenceFields
            referenceFields = $semanticCounts.referenceFields
            pageReferenceFields = $semanticCounts.pageReferenceFields
            styleReferenceFields = $semanticCounts.styleReferenceFields
            pictures = $semanticCounts.pictures
            relationshipElements = $semanticCounts.relationshipElements
            externalRelationships = $semanticCounts.externalRelationships
            formulaMetadataMarkers = $semanticCounts.formulaMetadataMarkers
        }
        parts = @($parts)
    }
}

function Get-PackageDifference {
    param(
        [object]$Baseline,
        [object]$Candidate
    )

    $baselineParts = @{}
    foreach ($part in $Baseline.parts) {
        $baselineParts[$part.name] = $part
    }
    $candidateParts = @{}
    foreach ($part in $Candidate.parts) {
        $candidateParts[$part.name] = $part
    }

    $addedNames = @($candidateParts.Keys | Where-Object {
        -not $baselineParts.ContainsKey($_)
    } | Sort-Object)
    $removedNames = @($baselineParts.Keys | Where-Object {
        -not $candidateParts.ContainsKey($_)
    } | Sort-Object)
    $changedNames = @($candidateParts.Keys | Where-Object {
        $baselineParts.ContainsKey($_) -and
        $candidateParts[$_].sha256 -ne $baselineParts[$_].sha256
    } | Sort-Object)
    $unchanged = @($candidateParts.Keys | Where-Object {
        $baselineParts.ContainsKey($_) -and
        $candidateParts[$_].sha256 -eq $baselineParts[$_].sha256
    } | Sort-Object)
    $changed = @($changedNames | ForEach-Object {
        [ordered]@{
            name = $_
            baselineBytes = $baselineParts[$_].uncompressedBytes
            candidateBytes = $candidateParts[$_].uncompressedBytes
            baselineSha256 = $baselineParts[$_].sha256
            candidateSha256 = $candidateParts[$_].sha256
        }
    })
    return [ordered]@{
        addedParts = @($addedNames | ForEach-Object { $candidateParts[$_] })
        removedParts = @($removedNames | ForEach-Object { $baselineParts[$_] })
        changedParts = $changed
        unchangedPartCount = $unchanged.Count
    }
}

function Get-PublicSnapshot {
    param([object]$Snapshot)

    return [ordered]@{
        path = $Snapshot.path
        extension = $Snapshot.extension
        packageBytes = $Snapshot.packageBytes
        packageSha256 = $Snapshot.packageSha256
        entryCount = $Snapshot.entryCount
        xmlPartCount = $Snapshot.xmlPartCount
        mediaPartCount = $Snapshot.mediaPartCount
        embeddingPartCount = $Snapshot.embeddingPartCount
        semanticCounts = $Snapshot.semanticCounts
    }
}

$resolvedManifestPath = Resolve-RepositoryPath $ManifestPath
if (-not (Test-Path -LiteralPath $resolvedManifestPath -PathType Leaf)) {
    throw "OOXML comparison manifest not found: $resolvedManifestPath"
}
$manifest = Get-Content -LiteralPath $resolvedManifestPath -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne 1 -or @($manifest.comparisons).Count -eq 0) {
    throw "OOXML comparison manifest must use schemaVersion 1 and contain comparisons."
}

$comparisons = [System.Collections.Generic.List[object]]::new()
foreach ($comparison in $manifest.comparisons) {
    $baseline = Get-PackageSnapshot (Resolve-RepositoryPath $comparison.baseline)
    $candidate = Get-PackageSnapshot (Resolve-RepositoryPath $comparison.candidate)
    if ($baseline.extension -ne $candidate.extension) {
        throw "Comparison '$($comparison.id)' uses different package types."
    }
    $comparisons.Add([ordered]@{
        id = [string]$comparison.id
        evidenceDate = [string]$comparison.evidenceDate
        comparisonKind = [string]$comparison.comparisonKind
        note = [string]$comparison.note
        baseline = Get-PublicSnapshot $baseline
        candidate = Get-PublicSnapshot $candidate
        difference = Get-PackageDifference $baseline $candidate
    })
}

$report = [ordered]@{
    schemaVersion = 1
    generator = "scripts/summarize-office-openxml.ps1"
    manifest = Get-RelativeRepositoryPath $resolvedManifestPath
    comparisons = @($comparisons)
}
$resolvedOutputPath = Resolve-RepositoryPath $OutputPath
$outputDirectory = Split-Path -Parent $resolvedOutputPath
[System.IO.Directory]::CreateDirectory($outputDirectory) | Out-Null
$json = $report | ConvertTo-Json -Depth 12
$encoding = [System.Text.UTF8Encoding]::new($false)
[System.IO.File]::WriteAllText($resolvedOutputPath, $json + [Environment]::NewLine, $encoding)
Write-Host "Wrote $($comparisons.Count) OOXML comparisons to $resolvedOutputPath"
