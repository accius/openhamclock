' OpenHamClock Roku channel scene.
' Layout: header + UTC clock, map-lite with day/night shading, DX spots
' list, solar indices strip, N0NBH band conditions, status line.

sub init()
    m.MAP_X = 48.0
    m.MAP_Y = 116.0
    m.MAP_W = 1152.0
    m.MAP_H = 576.0
    m.NIGHT = "9C0a0e14"

    m.clock = m.top.findNode("clock")
    m.spotsList = m.top.findNode("spotsList")
    m.solar = m.top.findNode("solar")
    m.bands = m.top.findNode("bands")
    m.status = m.top.findNode("status")
    m.nightGroup = m.top.findNode("nightGroup")
    m.sunMark = m.top.findNode("sunMark")

    m.apiTask = m.top.findNode("apiTask")
    m.apiTask.observeField("responses", "onApiResponses")

    clockTimer = m.top.findNode("clockTimer")
    clockTimer.observeField("fire", "onClockTick")
    refreshTimer = m.top.findNode("refreshTimer")
    refreshTimer.observeField("fire", "onRefreshTick")
    mapTimer = m.top.findNode("mapTimer")
    mapTimer.observeField("fire", "onMapTick")

    buildNightColumns()
    onClockTick()
    updateTerminator()
    refreshNow()
    m.spotsList.setFocus(true)
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    ' Unhandled keys (including Back) keep system default behavior.
    return false
end function

' --- timers ---------------------------------------------------------------

sub onClockTick()
    m.clock.text = clockStr(CreateObject("roDateTime")) + " UTC"
end sub

sub onRefreshTick()
    refreshNow()
end sub

sub onMapTick()
    updateTerminator()
end sub

function clockStr(dt as object) as string
    iso = dt.ToISOString() ' "2026-10-27T11:52:00" (1-based indexing)
    if type(iso) = "String" and len(iso) >= 19 then return iso.Mid(12, 8)
    return "--:--:--"
end function

' --- data refresh ----------------------------------------------------------

sub refreshNow()
    base = "https://openhamclock.com/api"
    m.apiTask.requests = [base + "/dxcluster/spots", base + "/solar-indices", base + "/n0nbh"]
    m.apiTask.control = "RUN"
end sub

sub onApiResponses()
    resps = m.apiTask.responses
    if resps = invalid or resps.count() < 3 then
        m.status.text = "openhamclock.com • fetch failed, retrying…"
        return
    end if
    updateSpots(resps[0])
    updateSolar(resps[1])
    updateBands(resps[2])
    m.status.text = "openhamclock.com • updated " + clockStr(CreateObject("roDateTime")) + " UTC • auto-refresh 60s • Back exits"
end sub

sub updateSpots(body as string)
    spots = ParseJson(body)
    content = CreateObject("roSGNode", "ContentNode")
    if type(spots) = "roArray" then
        max = spots.count()
        if max > 20 then max = 20
        for i = 0 to max - 1
            s = spots[i]
            if type(s) = "roAssociativeArray" then
                freq = strVal(s, "freq")
                call = strVal(s, "call")
                comment = strVal(s, "comment")
                title = freq + "  " + call
                if comment <> "" then title = title + "  " + left(comment, 28)
                item = content.createChild("ContentItem")
                item.title = title
            end if
        end for
    end if
    if content.getChildCount() = 0 then
        item = content.createChild("ContentItem")
        item.title = "No spots right now"
    end if
    m.spotsList.content = content
end sub

sub updateSolar(body as string)
    d = ParseJson(body)
    sfi = nestedVal(d, "sfi", "current")
    kp = nestedVal(d, "kp", "current")
    ssn = nestedVal(d, "ssn", "current")
    m.solar.text = "SFI " + sfi + "   •   Kp " + kp + "   •   SSN " + ssn
end sub

sub updateBands(body as string)
    d = ParseJson(body)
    parts = []
    if type(d) = "roAssociativeArray" and d.DoesExist("bandConditions") then
        bc = d["bandConditions"]
        if type(bc) = "roArray" then
            for each b in bc
                if type(b) = "roAssociativeArray" and b.DoesExist("time") and b["time"] = "Day" then
                    if b.DoesExist("name") and b.DoesExist("condition") then
                        parts.push(strOf(b["name"]) + ": " + strOf(b["condition"]))
                        if parts.count() >= 6 then exit for
                    end if
                end if
            end for
        end if
    end if
    if parts.count() = 0 then
        m.bands.text = "Band conditions unavailable"
    else
        text = "Daytime bands  " + parts[0]
        for i = 1 to parts.count() - 1
            text = text + "   •   " + parts[i]
        end for
        m.bands.text = text
    end if
end sub

function strVal(aa as object, key as string) as string
    if aa.DoesExist(key) then return strOf(aa[key])
    return ""
end function

function strOf(v as dynamic) as string
    if v = invalid then return ""
    t = type(v)
    if t = "String" or t = "roString" then return v
    if t = "Integer" or t = "Float" or t = "Double" then return Stri(v).trim()
    return ""
end function

function nestedVal(d as dynamic, k1 as string, k2 as string) as string
    if type(d) <> "roAssociativeArray" then return "--"
    if not d.DoesExist(k1) then return "--"
    sub = d[k1]
    if type(sub) <> "roAssociativeArray" or not sub.DoesExist(k2) then return "--"
    s = strOf(sub[k2])
    if s = "" then return "--"
    return s
end function

' --- map-lite day/night shading ---------------------------------------------

sub buildNightColumns()
    m.nightCols = []
    n = 48
    w = m.MAP_W / n + 1.0
    for i = 0 to n - 1
        r = m.nightGroup.createChild("Rectangle")
        r.translation = [i * (m.MAP_W / n), 0.0]
        r.width = w
        r.height = m.MAP_H
        r.color = m.NIGHT
        r.visible = false
        m.nightCols.push(r)
    end for
end sub

sub updateTerminator()
    pi = 3.14159265
    dt = CreateObject("roDateTime")
    iso = dt.ToISOString()
    utcHours = 12.0
    if type(iso) = "String" and len(iso) >= 16 then
        utcHours = iso.Mid(12, 2).ToInt() + iso.Mid(15, 2).ToInt() / 60.0
    end if
    doy = dt.GetDayOfYear()
    subLat = -23.44 * cos(2.0 * pi * (doy + 10) / 365.0)
    subLon = wrapLon(-15.0 * (utcHours - 12.0))
    decR = subLat * pi / 180.0
    tanDec = tan(decR)
    cols = m.nightCols
    n = cols.count()
    for i = 0 to n - 1
        lonC = -180.0 + (i + 0.5) * (360.0 / n)
        hR = wrapLon(lonC - subLon) * pi / 180.0
        x = i * (m.MAP_W / n)
        r = cols[i]
        if abs(tanDec) < 0.03 then
            if cos(hR) > 0.0 then
                r.visible = false
            else
                r.visible = true
                r.translation = [x, 0.0]
                r.height = m.MAP_H
            end if
        else
            phiT = atn(-cos(hR) / tanDec) * 180.0 / pi
            if isNightAbove(phiT, hR, decR) then
                yTop = 0.0
                yBot = latToY(phiT)
            else
                yTop = latToY(phiT)
                yBot = m.MAP_H
            end if
            if yBot - yTop < 1.0 then
                r.visible = false
            else
                r.visible = true
                r.translation = [x, yTop]
                r.height = yBot - yTop
            end if
        end if
    end for
    ' sun marker at the subsolar point
    m.sunMark.translation = [m.MAP_X + (subLon + 180.0) / 360.0 * m.MAP_W - 6.0, m.MAP_Y + latToY(subLat) - 6.0]
    m.sunMark.visible = true
end sub

function wrapLon(v as float) as float
    while v > 180.0
        v -= 360.0
    end while
    while v < -180.0
        v += 360.0
    end while
    return v
end function

function dayness(phiDeg as float, hR as float, decR as float) as float
    pi = 3.14159265
    pR = phiDeg * pi / 180.0
    return sin(pR) * sin(decR) + cos(pR) * cos(decR) * cos(hR)
end function

function isNightAbove(phiT as float, hR as float, decR as float) as boolean
    return dayness(phiT + 3.0, hR, decR) < 0.0
end function

function latToY(lat as float) as float
    if lat > 90.0 then lat = 90.0
    if lat < -90.0 then lat = -90.0
    return (90.0 - lat) / 180.0 * m.MAP_H
end function
