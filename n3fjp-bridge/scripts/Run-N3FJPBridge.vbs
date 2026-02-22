Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "C:\N3FJP_Proxy"
cmd = """" & "C:\Users\Delerius\AppData\Local\Python\pythoncore-3.14-64\pythonw.exe" & """ """ & "C:\N3FJP_Proxy\n3fjp_bridge.py" & """"
sh.Run cmd, 0, False
