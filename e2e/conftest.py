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
def contexts(browser, request):
    created = []
    def make(**options):
        context = browser.new_context(**options)
        created.append(context)
        return context
    yield make
    for index, context in enumerate(created):
        if getattr(request.node, 'rep_call', None) and request.node.rep_call.failed:
            for number, page in enumerate(context.pages):
                try:
                    folder = ROOT / 'test-results'
                    folder.mkdir(exist_ok=True)
                    page.screenshot(path=str(folder / f'failure-{request.node.name}-{index}-{number}.png'), full_page=True)
                except Exception:
                    pass
        context.close()

@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    setattr(item, 'rep_' + report.when, report)
