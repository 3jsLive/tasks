ALL_LINES = diff:GIT_DIFF* { return diff }

TEMP_HUNK_LINES = "@@ " /*change:$( !" @@" .)+*/ change:TEMP_CHANGE " @@" section:[^\n]* { return change }
TEMP_CODE = type:( " " / LBLPlus / LBLMinus ) line:$[^\n]* { return { type, line } }
EMPTY_LINE = ( LINEBREAK / LBLNoNewline )

TEMP_CHANGE = MINUS linePre:$RxCounter+ counterPre:(COMMA cnt:$RxCounter+ { return cnt })? WS PLUS linePost:$RxCounter+ counterPost:(COMMA cnt:$RxCounter+ { return cnt })? { return { linePre, counterPre, linePost, counterPost } }

// diff git
GIT_DIFF =
	command:LineDiffGit WSLB
    meta: MetaData
    hunks:(
    	header:TEMP_HUNK_LINES WSLB
        changes:(code:TEMP_CODE WSLB (EMPTY_LINE WSLB)? { return code })*
        { return { ...header, changes } }
    )*
	{ return { command, meta, hunks } }

MetaData = meta:(
	line:ValidMetaLines WSLB { return line }
)+ { return meta }

ValidMetaLines =
	LineBinaryFilesDiffer
    / LineDeleted
    / LineNewFile
    / LineNoNewline
    / LineModeChange
    / LineRenameDouble
    / LineSimIndex
    / LineIndex
    / LineOverviewDouble

LineBinaryFilesDiffer = "Binary files" WS "a"? fileA:$(! " and " .)+ " and " "b"? fileB:$(! " differ" .)+ " differ" { return { type: "BinaryFilesDiffer", fileA, fileB } }
LineDeleted = LBLDeleted WS LBLFilemode WS $RxFileMode { return { type: "FileDeleted" } }
LineNewFile = LBLNew WS LBLFilemode WS mode:$RxFileMode { return { type: "FileNew" } }
LineModeChange = ( LBLOldMode / LBLNewMode ) WS $RxFileMode { return { type: "FileModeChange" } }
LineRename = LBLRename WS direction:$( LBLFrom / LBLTo ) WS filename:$[^\n]+ { return { type: "FileRename", direction, filename } }
LineSimIndex = LBLSimilarityIndex WS $RxPercent { return { type: "SimilarityIndex" } }
LineNoNewline = LBLNoNewline { return { type: "NoNewline" } }
LineRenameDouble = LBLRename WS LBLFrom WS from:$[^\n]+ WSLB LBLRename WS LBLTo WS to:$[^\n]+ { return { type: "FileRename", from, to } }
LineIndex = LBLIndex WS from:$RxSHA LBLDots to:$RxSHA ( WS $RxFileMode )? { return { type: "Index", from, to } }
LineOverviewDouble = LBLMinuses WS "a"? fileA:$[^\n]+ WSLB LBLPluses WS "b"? fileB:$[^\n]+ { return { type: "Overview", fileA, fileB } }

LineShortSummary = direction:( LBLMinuses / LBLPluses ) WS ( LBLPrefixA / LBLPrefixB )? file:$[^\n]* { return { direction, file } }
LineDiffGit = LBLCommand WS LBLPrefixA fileA:$( !" b/" . )+ WS LBLPrefixB fileB:$[^\n]+ { return { fileA, fileB } }
LineGITBinaryPatch = LBLGITBinaryPatch WSLB ( $RxLiteral WSLB $RxBinary / $RxDelta WSLB $RxBinary )+

WS = [ \t]
WSLB = [ \t\n\r]

LBLMinus = "-"
LBLPlus = "+"
LBLMinuses = "---"
LBLPluses = "+++"

LBLFilesChanged = $("file" "s"?) " changed"
LBLInsertions = $("insertion" "s"?) "(+)"
LBLDeletions = $("deletion" "s"?) "(-)"
LBLFilemode = "file mode"
LBLDevNull = "/dev/null"
LBLCommand = "diff --git"
LBLIndex = "index"
LBLDots = ".."
LBLSimilarityIndex = "similarity index"
LBLDeleted = "deleted"
LBLNew = "new"
LBLRename = "rename"
LBLFrom = "from"
LBLTo = "to"
LBLPrefixA = "a/"
LBLPrefixB = "b/"
LBLNoNewline = "\\ No newline at end of file"
LBLGITBinaryPatch = "GIT binary patch"
LBLLiteral = "literal"
LBLDelta = "delta"
LBLOldMode = "old mode"
LBLNewMode = "new mode"

OPB = "["
CLB = "]"
SLASH = "/"
COLON = ":"
PLUS = "+"
MINUS = "-"
COMMA = ","
LINEBREAK = "\n"
DBLLINEBREAK = "\n\n"

RxFileMode = [0-9]+
RxSHA = [a-fA-F0-9]+
RxPercent = [0-9]+ "%"
RxLiteral = LBLLiteral WS [0-9]+
RxDelta = LBLDelta WS [0-9]+
RxBinary = (!DBLLINEBREAK .)+ DBLLINEBREAK
RxCounter = [0-9]+