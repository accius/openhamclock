' OpenHamClock Roku channel entry point.
' Supports an ECP deep-link override, e.g.:
'   curl "http://ROKU_IP:8060/launch/dev?serverUrl=http%3A%2F%2F192.168.1.10%3A3000"
' so self-hosters can switch servers without repackaging.
sub main(args as object)
    launchUrl = invalid
    if args <> invalid and type(args) = "roAssociativeArray" then
        if args.DoesExist("serverUrl") and type(args["serverUrl"]) = "String" and args["serverUrl"].Trim() <> "" then
            launchUrl = args["serverUrl"]
        else if args.DoesExist("contentID") and type(args["contentID"]) = "String" and isHttpLike(args["contentID"]) then
            ' Allow deep links that stuff the URL into contentID.
            launchUrl = args["contentID"]
        end if
    end if
    if type(launchUrl) = "String" then
        sec = CreateObject("roRegistrySection", "OpenHamClock")
        if sec <> invalid then
            sec.Write("serverUrl", launchUrl.Trim())
            sec.Flush()
        end if
    end if
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.setMessagePort(port)
    scene = screen.CreateScene("MainScene")
    if type(launchUrl) = "String" then scene.serverUrl = launchUrl.Trim()
    screen.show()
    while true
        msg = wait(0, port)
        if type(msg) = "roSGScreenEvent" and msg.isScreenClosed() then return
    end while
end sub

function isHttpLike(v as dynamic) as boolean
    if v = invalid then return false
    s = v.Trim()
    return Left(s, 7) = "http://" or Left(s, 8) = "https://"
end function
