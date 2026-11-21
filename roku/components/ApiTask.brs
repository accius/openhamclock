' One-shot fetcher: takes an array of URLs, returns an array of bodies.
' Runs on the Task thread so the render thread never blocks on network.
sub init()
    m.top.functionName = "doFetch"
end sub

sub doFetch()
    out = []
    reqs = m.top.requests
    if reqs <> invalid then
        for each url in reqs
            out.push(fetchUrl(url))
        end for
    end if
    m.top.responses = out
end sub

function fetchUrl(url as string) as string
    xfer = CreateObject("roUrlTransfer")
    xfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    xfer.AddHeader("User-Agent", "OpenHamClock-Roku/1.0")
    xfer.AddHeader("Accept", "application/json")
    xfer.SetUrl(url)
    body = xfer.GetToString()
    if xfer.GetResponseCode() = 200 and type(body) = "String" then return body
    return ""
end function
