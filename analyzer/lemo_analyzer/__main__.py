import faulthandler
import signal
import socket
import sys

import uvicorn

from .config import CONFIG


def port_free(host: str, port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            s.bind((host, port))
            return True
        except OSError:
            return False


if __name__ == "__main__":
    if not port_free(CONFIG.host, CONFIG.port):
        print(
            f"\n  ✗ lemo analyzer: port {CONFIG.port} is already in use — another analyzer is probably running.\n"
            f"    stop it with:  lsof -ti tcp:{CONFIG.port} | xargs kill\n"
            f"    or pick another port with LEMO_PORT in analyzer/.env (and LEMO_ANALYZER_URL for the web app).\n",
            file=sys.stderr,
        )
        sys.exit(3)

    # `kill -USR1 <pid>` dumps every thread's stack to analyzer/data/analyzer.log — handy if a job ever stalls.
    log = open(CONFIG.data_dir / "analyzer.log", "a", buffering=1)
    faulthandler.register(signal.SIGUSR1, file=log, all_threads=True)
    print(
        f"lemo analyzer → http://{CONFIG.host}:{CONFIG.port}  (youtube: {CONFIG.enable_youtube}, log: {CONFIG.data_dir / 'analyzer.log'})",
        flush=True,
    )
    sys.stderr = log  # library warnings go to the log file, never block on a closed terminal
    uvicorn.run("lemo_analyzer.server:app", host=CONFIG.host, port=CONFIG.port, log_level="warning")
