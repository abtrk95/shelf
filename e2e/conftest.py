"""Real-browser tests. The app is started locally; no external network is needed."""
import os
import subprocess
import time
import urllib.request
from pathlib import Path

import pytest
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]

@pytest.fixture(scope="session")
def base_url():
    external = os.environ.get("SHELF_E2E_BASE_URL")
    if external:
        yield external.rstrip("/")
        return
    port = os.environ.get("E2E_PORT", "3077")
    url = f"http://localhost:{port}"
    env = {**os.environ, "PORT": port, "HOST": "127.0.0.1", "NODE_ENV": "development", "ALLOWED_ORIGINS": "", "STUN_URLS": "", "TURN_URLS": "", "ICE_TRANSPORT_POLICY": "all"}
    process = subprocess.Popen(["node", "server/index.mjs"], cwd=ROOT, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    for _ in range(100):
        try:
            urllib.request.urlopen(url + "/healthz", timeout=.2).close()
            break
        except Exception:
            time.sleep(.1)
    else:
        process.terminate()
        raise RuntimeError("Test server did not start. Run npm run build first.")
    yield url
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()

@pytest.fixture(scope="session")
def browser():
    with sync_playwright() as playwright:
        options = {"headless": True, "args": ["--no-sandbox", "--disable-dev-shm-usage"]}
        if os.environ.get("CHROMIUM_PATH"):
            options["executable_path"] = os.environ["CHROMIUM_PATH"]
        instance = playwright.chromium.launch(**options)
        yield instance
        instance.close()

@pytest.fixture
def contexts(browser):
    created = []
    def make(**options):
        context = browser.new_context(**options)
        created.append(context)
        return context
    yield make
    for context in created:
        context.close()
