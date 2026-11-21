' OpenHamClock Roku channel entry point.
sub main()
    screen = CreateObject("roSGScreen")
    port = CreateObject("roMessagePort")
    screen.setMessagePort(port)
    scene = screen.CreateScene("MainScene")
    screen.show()
    while true
        msg = wait(0, port)
        if type(msg) = "roSGScreenEvent" and msg.isScreenClosed() then return
    end while
end sub
