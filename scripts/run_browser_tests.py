"""Run the JavaScript tests and an app smoke test in a headless Chromium browser.

Usage (from the catapult-tool folder):

    python scripts/run_browser_tests.py [--browser PATH]

Needs Chrome, Chromium or Edge. Exit code 0 when everything passes.
"""

from __future__ import annotations

import argparse
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"

CANDIDATES = [
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "google-chrome",
    "chromium",
    "chromium-browser",
    "microsoft-edge",
]


def find_browser(explicit: str | None) -> str:
    for cand in [explicit] if explicit else CANDIDATES:
        path = cand if os.path.isfile(cand) else shutil.which(cand)
        if path:
            return path
    sys.exit("No Chrome/Chromium/Edge found; pass --browser PATH")


def dump_dom(browser: str, page: Path) -> str:
    """Load a page headless and return the DOM after its scripts have run."""
    cmd = [
        browser,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--virtual-time-budget=10000",
        "--window-size=1280,1600",
        "--dump-dom",
        page.as_uri(),
    ]
    proc = subprocess.run(cmd, capture_output=True, text=True, encoding="utf-8", timeout=120)
    return proc.stdout


def run_unit_tests(browser: str) -> bool:
    dom = dump_dom(browser, WEB / "tests" / "index.html")
    status = re.search(r'id="summary" data-status="(\w+)"[^>]*>([^<]*)<', dom)
    log = re.search(r'id="log">(.*?)</pre>', dom, re.S)
    if not status:
        print("Could not read test results; is the browser working?")
        return False
    if log:
        failures = [line for line in log.group(1).splitlines() if line.startswith(("FAIL", "     "))]
        print("\n".join(failures))
    print("JS unit tests:", status.group(2))
    return status.group(1) == "pass"


def run_smoke_test(browser: str) -> bool:
    """The app must boot and compute a landing distance from the default settings."""
    dom = dump_dom(browser, WEB / "index.html")
    landing = re.search(r'id="out-range">([^<]*)<', dom)
    speed = re.search(r'id="out-speed">([^<]*)<', dom)
    controls = dom.count('class="control"')
    ok = bool(landing and landing.group(1).endswith(" cm") and speed and "m/s" in speed.group(1) and controls >= 5)
    detail = f"landing={landing.group(1) if landing else None!r}, speed={speed.group(1) if speed else None!r}, controls={controls}"
    print("App smoke test:", "pass" if ok else "FAIL", f"({detail})")
    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--browser", help="path to a Chromium-based browser")
    args = parser.parse_args()
    browser = find_browser(args.browser)
    ok = run_unit_tests(browser)
    ok = run_smoke_test(browser) and ok
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
