/*
    PEG.js Grammatik v2

    TODO: Add WS* everywhere to allow for "loose" parsing (or extended linting)?

    TODO: prose-text-killer

    TODO: strong *marks*

*/
{

    const documentName = '<documentName>';

    function normalizeWS( text ) {

        return text.replace( /[ \t\r\n]+/g, ' ' );

    }
    
    function locationAdjusted() {
    
    	const loc = location();
        
        loc.start.column --;
        loc.end.column --;
        
        return loc;
    	
    }

}

Content =
	(
    	( Tags / CodeTag ) /
        text:$( NonCodeTag / NonBracketsTag / Text)+ { return { type: "Text", text: text, location: locationAdjusted() } }
    )+

Tags = tag:( NameTag / Constructor / PathTag /
         PageTag / LinkTag / MPMTag /
         ExampleTag / ParamTag ) { return { ...tag, source:text() } };

RxW    = [a-zA-Z0-9_]
RxWDot = [a-zA-Z0-9_\.]
SP     = " "
WS     = [ \t]
WSLB   = [ \t\r\n]

OPB = "["
CLB = "]"
OPP = "("
CLP = ")"
COLON = ":"
COMMA = ","
COMMADOTS = ", ..."

LBLName = "name"i
LBLPath = "path"i
LBLExample = "example"i
LBLPage = "page"i
LBLProperty = "property"i
LBLMethod = "method"i
LBLLink = "link"i
LBLMember = "member"i
LBLParam = "param"i

TAGName = OPB LBLName CLB
TAGPath = OPB LBLPath CLB

STARTExample = OPB LBLExample COLON
STARTPage = OPB LBLPage COLON
STARTProperty = OPB LBLProperty COLON
STARTMethod = OPB LBLMethod COLON
STARTLink = OPB LBLLink COLON
STARTParam = OPB LBLParam COLON

ENDJavascript = ".js"

LABELS = ( LBLExample / LBLPage / LBLProperty / LBLMethod / LBLLink / LBLParam / LBLName / LBLPath )
LABELSneedingCOLON = ( LBLExample / LBLPage / LBLProperty / LBLMethod / LBLLink / LBLParam )
LABELSneedingnoCOLON = ( LBLPath / LBLName )


ExampleTagShort = STARTExample link:$RxW+ CLB {

	return { type: 'ExampleTag', link:link, title:link, location: locationAdjusted() }

}

ExampleTagLong = STARTExample link:$RxW+ SP title:$(RxWDot / [:\/\-] / WS)+ CLB {

	return { type: 'ExampleTag', link:link, title:normalizeWS( title ), location: locationAdjusted() }

}

ExampleTag = ( ExampleTagLong / ExampleTagShort )



LinkTagShort = STARTLink url:LinkTagUrlShort CLB {

	return { type: 'LinkTag', url:url.join(""), location: locationAdjusted() }

}

LinkTagLong = STARTLink url:$(LinkTagUrlFull (TAGPath / TAGName)? ENDJavascript? LinkTagUrlFull*) SP text:$( (RxWDot / [:\/\-] / WS)+ (TAGPath / TAGName)? ENDJavascript? (RxWDot / [:\/\-] / WS)*) CLB {

	return { type: 'LinkTag', url:url, text:normalizeWS( text ), location: locationAdjusted() }

}

LinkTag = ( LinkTagShort / LinkTagLong ) // oder so
LinkTagUrlShort = ( RxWDot / [:\/\-] )+
LinkTagUrlFull = ( RxWDot / [:\/\-\(\)#=] )+

PathTag = TAGPath {
	return { type: 'PathTag', location: locationAdjusted() }
}

PageShort = STARTPage name:$RxWDot+ CLB {

	const match = name.match( /^(\w+)\.(.*?)$/i );

    let main, anchor, extra;
    if ( match !== null ) {
    	main = match[ 1 ];
        anchor = match[ 2 ];
		extra = { name:main };
    } else if ( name.startsWith( '.' ) === true ) {
        anchor = name.replace( /^\./, '' );
		extra = {};
    } else {
    	main = name;
		anchor = '';
		extra = { name:main };
    }

	return { type: 'PageTag', anchor:anchor, text:name, location: locationAdjusted(), ...extra };

}

PageAnchor = STARTPage anchor:$("." RxWDot+) SP text:$(RxWDot / WSLB)+ CLB {

	return { type: 'PageTag', name:documentName, anchor:anchor.replace( /^\./, '' ), text:normalizeWS( text ), location: locationAdjusted() }

}

PageLong = STARTPage name:$RxWDot+ SP text:$(RxWDot / WSLB)+ CLB {

	const match = name.match( /^(\w+)\.(.*?)$/i );

    let main, anchor;
    if ( match !== null ) {
    	main = match[ 1 ];
        anchor = match[ 2 ];
    } else {
    	main = name;
		anchor = '';
    }

	return { type: 'PageTag', name:main, anchor:anchor, text:normalizeWS( text ), location: locationAdjusted() }

}

PageTag = ( PageShort / PageAnchor / PageLong )


ParamTag = ( ParamTagLong / ParamTagShort )

ParamTagShort = STARTParam retval:$RxW+ CLB {

	return { type: 'ParamTag', retval:retval, location: locationAdjusted() }

}

ParamTagLong = STARTParam retval:$RxWDot+ SP name:$(RxWDot / WS)+ CLB {

	return { type: 'ParamTag', retval:retval, name:normalizeWS( name ), location: locationAdjusted() }

}

MPMTag = ( MPMTagLong / MPMTagShort )

MPMTagShort = OPB tag:(LBLMember/LBLProperty/LBLMethod) COLON name:$RxW+ CLB {

    return { type: tag[0].toUpperCase() + tag.slice(1) + 'Tag', name:name, retval:name, location: locationAdjusted() }

}

MPMTagLong = OPB tag:(LBLMember/LBLProperty/LBLMethod) COLON retval:$RxW+ SP name:$(RxWDot / WS)+ CLB WS* params:(OPP ParamTagInList* CLP)? {

    if ( params !== null )
        params = params.filter( x => x !== "(" && x !== ")" )[ 0 ];

    return { type: tag[0].toUpperCase() + tag.slice(1) + 'Tag', retval:retval, name:normalizeWS( name ), params:params, location: locationAdjusted() }

}

ParamTagInList = WSLB* tag:(ParamTag / LinkTagLong / FakeParamTag) COMMADOTS? COMMA? WSLB* {

	return tag

}

FakeParamTag = tag:$RxWDot+ {

	return { type: 'ParamTag', retval:undefined, name:tag, location: locationAdjusted() }

}

NameTag = TAGName WSLB* !OPP {

	return { type: 'NameTag', location: locationAdjusted() }

}

Constructor = TAGName WSLB* params:(OPP ParamTagInList* CLP)? {

    if ( params !== null )
        params = params.filter( x => x !== "(" && x !== ")" )[ 0 ];

	return { type: 'Constructor', params:params, location: locationAdjusted() }

}

HTMLStart = "<"
HTMLEnd = ">"
HTMLClose = "/"
NotHTMLClose = ! "/"
LBLCode = "code"i
TAGCodeStart = HTMLStart LBLCode HTMLEnd
TAGCodeEnd = HTMLStart HTMLClose LBLCode HTMLEnd

RxNotStartHTML = [^<]
RxNotEndHTML = [^>]
RxNotCLB = [^\]]
RxNotOPBorStartHTML = [^\[<]

RxNoHTMLClose = [^/]
RxSingleBracketNoClose = HTMLStart RxNoHTMLClose+ WS*


CodeTag = TAGCodeStart code:$( ! TAGCodeEnd .)+ TAGCodeEnd {

	return { type: "CodeTag", code, location: locationAdjusted() };

}

NonCodeTag = WS* WSLB* tag:$(HTMLStart HTMLClose? !LBLCode RxNotEndHTML+ HTMLEnd) WS* WSLB* {

	return { type: "NonCodeTag", tag };

}

NonBracketsTag = WS* WSLB* tag:$(OPB !(LABELSneedingCOLON COLON / LABELSneedingnoCOLON) RxNotCLB* CLB) WS* WSLB* {

	return { type: "NonBracketsTag", tag };

}

Text = text:$(RxNotOPBorStartHTML+) {

	return { type: "Text", text, location: locationAdjusted() };

}
