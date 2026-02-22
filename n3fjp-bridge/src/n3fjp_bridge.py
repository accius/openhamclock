r"""
N3FJP UDP Bridge (N1MM contactinfo)
Version: 1.0.0

- Listens to N3FJP TCP API updates
- On ENTEREVENT, requests READBMF and sends exactly ONE UDP packet per logged QSO
- Loads config from:
    1) Defaults in this file
    2) config.json (UTF-8 with or without BOM) in the same folder OR C:\N3FJP_Proxy\config.json
    3) Optional environment variables (power users)

Config JSON example:
{
  "N3FJP_HOST": "192.168.1.43",
  "N3FJP_PORT": 1100,
  "MYCALL_FALLBACK": "YOURCALL",
  "UDP_DEST_IP": "127.0.0.1",
  "UDP_DEST_PORT": 12060,
  "LOG_PATH": "C:\\N3FJP_Proxy\\bridge.log"
}
"""

import socket
import time
import sys
import datetime as dt
import re
import os
import json
import urllib.request
import urllib.error

# ---------------- DEFAULT CONFIG (fallbacks) ----------------
N3FJP_HOST = "192.168.1.43"
N3FJP_PORT = 1100

UDP_DEST_IP = "127.0.0.1"
UDP_DEST_PORT = 12060

MYCALL_FALLBACK = ""

LOG_PATH = r"C:\N3FJP_Proxy\bridge.log"

ENABLE_OHC_HTTP   = False
OHC_BASE_URL      = "http://localhost:3000"
OHC_API_KEY       = ""   # optional later

# ------------------------------------------------------------

# Extract complete <CMD>...</CMD> blocks from a stream buffer
CMD_BLOCK_RE = re.compile(r"<CMD>.*?</CMD>", re.IGNORECASE | re.DOTALL)

def single_instance_guard(port=56789):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.bind(("127.0.0.1", port))
    except OSError:
        log("Another bridge instance is already running. Exiting.")
        sys.exit(1)
    return s

_instance_lock = single_instance_guard()

def _script_dir() -> str:
    try:
        return os.path.dirname(os.path.abspath(__file__))
    except Exception:
        return os.getcwd()


def _default_config_paths() -> list[str]:
    # Prefer config.json next to the script, but also allow the legacy fixed path.
    return [
        os.path.join(_script_dir(), "config.json"),
        r"C:\N3FJP_Proxy\config.json",
    ]

def post_ohc_qso(base_url: str, api_key: str, payload: dict, timeout_sec: float = 10.0) -> None:
    """
    POST a logged QSO to OpenHamClock.
    This is optional output; failures should never stop the bridge.
    """
    url = base_url.rstrip("/") + "/api/n3fjp/qso"
    data = json.dumps(payload).encode("utf-8")

    req = urllib.request.Request(url, data=data, method="POST")
    req.add_header("Content-Type", "application/json")
    if api_key:
        req.add_header("X-API-Key", api_key)

    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            resp.read()
        log(f"[OHC] POST ok -> {url}")
    except urllib.error.HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        log(f"[OHC] HTTPError {e.code} -> {url} :: {body}")
    except Exception as e:
        log(f"[OHC] POST failed -> {url} :: {e}")

        # Friendly fallback: try :3001 if :3000 refused
        if ":3000" in base_url:
            try:
                alt_base = base_url.replace(":3000", ":3001")
                alt_url = alt_base.rstrip("/") + "/api/n3fjp/qso"
                req2 = urllib.request.Request(alt_url, data=data, method="POST")
                req2.add_header("Content-Type", "application/json")
                if api_key:
                    req2.add_header("X-API-Key", api_key)
                with urllib.request.urlopen(req2, timeout=timeout_sec) as resp:
                    resp.read()
                log(f"[OHC] POST ok (fallback) -> {alt_url}")
            except Exception as e2:
                log(f"[OHC] POST failed (fallback) -> {alt_url} :: {e2}")

def log(msg: str) -> None:
    global LOG_PATH
    ts = dt.datetime.now().isoformat(timespec="seconds")
    line = f"{ts} {msg}"
    print(line)
    try:
        os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
        with open(LOG_PATH, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def read_config_json(path: str) -> dict:
    """Loads JSON config safely, tolerating UTF-8 BOM (utf-8-sig). Returns {} if missing."""
    if not path or not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8-sig") as f:
        return json.load(f)


def apply_config() -> None:
    """
    Load config in this order:
      1) Defaults in the script
      2) config.json overrides (if exists)
      3) Environment overrides (optional)
    """
    global N3FJP_HOST, N3FJP_PORT, UDP_DEST_IP, UDP_DEST_PORT, MYCALL_FALLBACK, LOG_PATH
    global ENABLE_OHC_HTTP, OHC_BASE_URL, OHC_API_KEY
    loaded_from = None

    # 1) JSON config override (first config.json found)
    try:
        for p in _default_config_paths():
            if os.path.exists(p):
                cfg = read_config_json(p)
                loaded_from = p
                break
        else:
            cfg = {}

        if loaded_from:
            N3FJP_HOST = str(cfg.get("N3FJP_HOST", N3FJP_HOST)).strip() or N3FJP_HOST
            N3FJP_PORT = int(cfg.get("N3FJP_PORT", N3FJP_PORT))

            UDP_DEST_IP = str(cfg.get("UDP_DEST_IP", UDP_DEST_IP)).strip() or UDP_DEST_IP
            UDP_DEST_PORT = int(cfg.get("UDP_DEST_PORT", UDP_DEST_PORT))

            MYCALL_FALLBACK = str(cfg.get("MYCALL_FALLBACK", MYCALL_FALLBACK)).strip()

            LOG_PATH = str(cfg.get("LOG_PATH", LOG_PATH)).strip() or LOG_PATH

            ENABLE_OHC_HTTP = bool(cfg.get("ENABLE_OHC_HTTP", ENABLE_OHC_HTTP))
            OHC_BASE_URL    = str(cfg.get("OHC_BASE_URL", OHC_BASE_URL)).strip() or OHC_BASE_URL
            OHC_API_KEY     = str(cfg.get("OHC_API_KEY", OHC_API_KEY)).strip() or OHC_API_KEY

            log(f"Loaded config.json from {loaded_from}")
            log(f"Config: ENABLE_OHC_HTTP={ENABLE_OHC_HTTP} OHC_BASE_URL={OHC_BASE_URL}")
        else:
            log(f"No config.json found (using defaults). Looked in: {', '.join(_default_config_paths())}")
    except Exception as e:
        log(f"WARNING: Failed to load config.json: {e} (using defaults)")

    # 2) Optional environment overrides (power users)
    try:
        if os.getenv("N3FJP_HOST"):
            N3FJP_HOST = os.getenv("N3FJP_HOST").strip() or N3FJP_HOST
        if os.getenv("N3FJP_PORT"):
            N3FJP_PORT = int(os.getenv("N3FJP_PORT"))

        if os.getenv("UDP_DEST_IP"):
            UDP_DEST_IP = os.getenv("UDP_DEST_IP").strip() or UDP_DEST_IP
        if os.getenv("UDP_DEST_PORT"):
            UDP_DEST_PORT = int(os.getenv("UDP_DEST_PORT"))

        if os.getenv("MYCALL_FALLBACK") is not None:
            MYCALL_FALLBACK = os.getenv("MYCALL_FALLBACK").strip()

        if os.getenv("LOG_PATH"):
            LOG_PATH = os.getenv("LOG_PATH").strip() or LOG_PATH
    except Exception as e:
        log(f"WARNING: Failed processing environment overrides: {e}")

    log(
        f"EFFECTIVE CONFIG: N3FJP={N3FJP_HOST}:{N3FJP_PORT} "
        f"UDP={UDP_DEST_IP}:{UDP_DEST_PORT} MYCALL='{MYCALL_FALLBACK}' "
        f"LOG='{LOG_PATH}'"
    )

    log(f"[CONFIG] Loaded from: {os.path.abspath(loaded_from) if loaded_from else '(defaults/no config.json)'}")
    log(f"[CONFIG] OHC_BASE_URL={OHC_BASE_URL}")


def send_cmd(sock: socket.socket, xml: str) -> None:
    """N3FJP requires CR+LF line termination."""
    sock.sendall((xml + "\r\n").encode("ascii", errors="ignore"))


def detect_cmd_type(cmd_xml: str) -> str:
    """
    Return the command name immediately under <CMD>, e.g.:
      <CMD><READBMFRESPONSE>...
      <CMD><SETUPDATESTATERESPONSE>...
    """
    m = re.search(r"<CMD>\s*<([A-Z0-9_]+)>", cmd_xml, re.IGNORECASE)
    return m.group(1).upper() if m else ""


def get_tag_value(xml: str, tag: str) -> str:
    """Extract <TAG>value</TAG> from within a CMD block."""
    m = re.search(rf"<{tag}>(.*?)</{tag}>", xml, re.IGNORECASE | re.DOTALL)
    return m.group(1).strip() if m else ""


def band_to_mhz(band_str: str):
    """N3FJP returns BAND like '20' or '40'. Convert to representative MHz value."""
    s = (band_str or "").strip().upper().replace("M", "")
    mapping = {
        "160": 1.8,
        "80": 3.5,
        "60": 5.3,
        "40": 7.0,
        "30": 10.1,
        "20": 14.0,
        "17": 18.1,
        "15": 21.0,
        "12": 24.9,
        "10": 28.0,
        "6": 50.0,
        "2": 144.0,
    }
    return mapping.get(s)

def normalize_mode(n3fjp_mode: str) -> str:
    """
    Normalize N3FJP modes to a friendlier set for downstream consumers.
    N3FJP commonly uses: PH, CW, DI, FM, AM, RTTY, etc.
    """
    m = (n3fjp_mode or "").strip().upper()
    if m in ("PH", "USB", "LSB", "SSB"):
        return "SSB"
    if m == "DI":
        return "DIGI"
    return m or "UNKNOWN"


def mhz_to_khz(mhz: float) -> int:
    """Convert MHz float (e.g. 7.188) to integer kHz (7188)."""
    try:
        return int(round(float(mhz) * 1000.0))
    except Exception:
        return 0

def n1mm_contactinfo_xml(mycall: str, call: str, mode: str, band_mhz: float, freq_mhz: float) -> bytes:
    """
    Minimal N1MM-style <contactinfo> packet.
    N1MM commonly uses rxfreq/txfreq as integer in 10 Hz units: MHz * 100000
    """
    now = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    freq_10hz = str(int(round(freq_mhz * 100000)))

    return (
        '<?xml version="1.0" encoding="utf-8"?>'
        "<contactinfo>"
        "<app>N3FJP-BRIDGE</app>"
        "<contestname>N3FJP</contestname>"
        "<contestnr>1</contestnr>"
        f"<timestamp>{now}</timestamp>"
        f"<mycall>{mycall}</mycall>"
        f"<band>{band_mhz}</band>"
        f"<rxfreq>{freq_10hz}</rxfreq>"
        f"<txfreq>{freq_10hz}</txfreq>"
        "<operator></operator>"
        f"<mode>{mode}</mode>"
        f"<call>{call}</call>"
        "</contactinfo>"
    ).encode("utf-8")


def main():
    apply_config()

    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)

    backoff = 2
    while True:
        sock = None
        try:
            log(f"Connecting to N3FJP {N3FJP_HOST}:{N3FJP_PORT} ...")
            sock = socket.create_connection((N3FJP_HOST, N3FJP_PORT), timeout=5)
            sock.settimeout(1.0)
            log("Connected.")
            backoff = 2  # reset backoff after successful connect

            send_cmd(sock, "<CMD><SETUPDATESTATE><VALUE>TRUE</VALUE></CMD>")
            log("Sent SETUPDATESTATE TRUE")

            last_nonempty_call = ""
            last_mode = "SSB"
            last_freq = 0.0
            last_band_mhz = None
            last_dx_grid = ""

            pending_send = False
            pending_call = ""

            buf = ""

            while True:
                try:
                    data = sock.recv(8192)
                    if not data:
                        raise ConnectionError("Socket closed by server")
                    buf += data.decode("utf-8", errors="replace")
                except socket.timeout:
                    pass

                if len(buf) > 300000:
                    buf = buf[-80000:]

                blocks = CMD_BLOCK_RE.findall(buf)
                if not blocks:
                    continue

                last_end = buf.lower().rfind("</cmd>")
                if last_end != -1:
                    buf = buf[last_end + len("</CMD>") :]

                for block in blocks:
                    block = block.strip()
                    cmd = detect_cmd_type(block)
                    if not cmd:
                        continue

                    if cmd == "SETUPDATESTATERESPONSE":
                        val = get_tag_value(block, "VALUE")
                        log(f"RX SETUPDATESTATERESPONSE VALUE={val}")

                    elif cmd == "UPDATERESPONSE":
                        control = get_tag_value(block, "CONTROL").upper()
                        value   = get_tag_value(block, "VALUE")

                        if control == "TXTENTRYCALL":
                            call = value.strip().upper()
                            if call:
                                last_nonempty_call = call
                            log(f"RX UPDATERESPONSE TXTENTRYCALL={call}")

                        if control == "TXTENTRYGRID":
                            v = (value or "").strip()
                            if v:
                                last_dx_grid = v
                            log(f"RX UPDATERESPONSE TXTENTRYGRID={v}")
                            
                    elif cmd == "ENTEREVENT":
                        pending_call = last_nonempty_call
                        pending_send = True

                        last_band_mhz = None
                        last_freq = 0.0
                        last_mode = last_mode or "SSB"
                        
                        log(f"RX ENTEREVENT (arm send) CALL={pending_call}")
                        send_cmd(sock, "<CMD><READBMF></CMD>")

                    elif cmd == "READBMFRESPONSE":
                        band = get_tag_value(block, "BAND")
                        mode = (get_tag_value(block, "MODETEST") or get_tag_value(block, "MODE")).strip().upper()
                        freq_s = get_tag_value(block, "FREQ").strip()

                        try:
                            last_freq = float(freq_s)
                        except Exception:
                            last_freq = 0.0

                        last_mode = mode or last_mode
                        last_band_mhz = band_to_mhz(band)

                        if pending_send:
                            log(f"RX READBMFRESPONSE BAND={band} MODE={last_mode} FREQ={last_freq}")

                            if pending_call and last_band_mhz and last_freq:
                                pkt = n1mm_contactinfo_xml(
                                    mycall=MYCALL_FALLBACK,
                                    call=pending_call,
                                    mode=last_mode or "SSB",
                                    band_mhz=last_band_mhz,
                                    freq_mhz=last_freq,
                                )
                                udp.sendto(pkt, (UDP_DEST_IP, UDP_DEST_PORT))
                                log(f"HTTP check: ENABLE_OHC_HTTP={ENABLE_OHC_HTTP}")
                                if ENABLE_OHC_HTTP:
                                    ohc_mode = normalize_mode(last_mode)
                                    ohc_freq_khz = mhz_to_khz(last_freq)

                                    ohc_payload = {
                                        "ts_utc": dt.datetime.utcnow().isoformat(timespec="seconds") + "Z",
                                        "dx_call": pending_call,
                                        "band_mhz": last_band_mhz,
                                        "freq_khz": ohc_freq_khz if ohc_freq_khz > 0 else None,
                                        "mode": ohc_mode,
                                        "source": "n3fjp_to_timemapper_udp",
                                    }

                                    # Only include de_call if it is set (prevents empty-string issues)
                                    if (MYCALL_FALLBACK or "").strip():
                                        ohc_payload["de_call"] = MYCALL_FALLBACK.strip().upper()

                                    if last_dx_grid:
                                        ohc_payload["dx_grid"] = last_dx_grid

                                    post_ohc_qso(OHC_BASE_URL, OHC_API_KEY, ohc_payload)

                                log(
                                    f"SENT UDP -> {UDP_DEST_IP}:{UDP_DEST_PORT} "
                                    f"CALL={pending_call} BAND={last_band_mhz} "
                                    f"FREQ={last_freq} MODE={last_mode}"
                                )
                            else:
                                log(
                                    f"SKIP UDP (missing) CALL={pending_call} "
                                    f"BAND={last_band_mhz} FREQ={last_freq}"
                                )
                            
                            pending_send = False
                            pending_call = ""
                            last_dx_grid = ""
        except Exception as e:
            log(f"ERROR: {e}")
            time.sleep(backoff)
            backoff = min(backoff * 2, 30)
        finally:
            try:
                if sock:
                    sock.close()
            except Exception:
                pass


if __name__ == "__main__":
    main()
