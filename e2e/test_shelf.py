"""The tests exercise the shipping client and server, not mocked transfer APIs."""
import hashlib
import re
import time
from pathlib import Path

from playwright.sync_api import expect

SCREENSHOTS = Path(__file__).resolve().parents[1] / "test-results"
SCREENSHOTS.mkdir(exist_ok=True)

# Observability only. The real RTCPeerConnection and send methods still run.
RTC_OBSERVER = """
window.__pcs = []; window.__frames = []; window.__cutAt = 0; window.__cutDone = false;
const NativePC = window.RTCPeerConnection;
window.RTCPeerConnection = class extends NativePC {
  constructor(...args) {
    super(...args); this.__number = window.__pcs.length; window.__pcs.push(this);
    this.addEventListener('datachannel', e => this.__observe(e.channel));
  }
  createDataChannel(...args) { const c = super.createDataChannel(...args); this.__observe(c); return c; }
  __observe(c) {
    const nativeSend = c.send.bind(c), pc = this;
    c.send = function(data) {
      nativeSend(data);
      if(data instanceof ArrayBuffer && data.byteLength >= 24) {
        const offset = Number(new DataView(data).getBigUint64(16));
        window.__frames.push({pc:pc.__number, offset});
        if(window.__cutAt && offset >= window.__cutAt && !window.__cutDone) {
          window.__cutDone = true; setTimeout(() => pc.close(), 0);
        }
      }
    }
  }
};
"""

def open_page(context, base_url):
    page = context.new_page()
    page.goto(base_url, wait_until="domcontentloaded")
    page.locator('[data-testid="pairing-code"]').wait_for(timeout=15000)
    return page

def pair(a, b):
    code = a.locator('[data-testid="pairing-code"]').inner_text()
    b.locator('[data-action="join-code"]').click()
    b.locator('#join-code').fill(code)
    b.locator('#join-form button[type="submit"]').click()
    a.locator('[data-action="pair-accept"]').wait_for(timeout=10000)
    # No WebRTC channel is established before the owner approves the new device.
    assert a.locator('#app').get_attribute('data-connection') != 'connected'
    a.locator('[data-action="pair-accept"]').click()
    a.locator('#app[data-connection="connected"]').wait_for(timeout=25000)
    b.locator('#app[data-connection="connected"]').wait_for(timeout=15000)
    expect(a.locator('[data-testid="safety-code"]')).to_have_text(re.compile(r"^[A-F0-9]{4} [A-F0-9]{4}$"))
    expect(b.locator('[data-testid="safety-code"]')).to_have_text(re.compile(r"^[A-F0-9]{4} [A-F0-9]{4}$"))
    assert a.locator('[data-testid="safety-code"]').inner_text() == b.locator('[data-testid="safety-code"]').inner_text()

def add_text(page, value):
    page.locator('.drop-buttons [data-action="text"]').click()
    page.locator('#text-content').fill(value)
    page.locator('#text-form button[type="submit"]').click()

def accept_one(page):
    page.locator('[data-item-action="accept"]').first.wait_for(timeout=15000)
    page.locator('[data-item-action="accept"]').first.click()

def test_responsive_layout_dark_mode_rtl_and_keyboard(contexts, base_url):
    context = contexts(viewport={"width":1440,"height":1000})
    page = open_page(context,base_url)
    errors=[]
    page.on('pageerror',lambda error:errors.append(str(error)))
    for width in [1440,1024,768,390,320]:
        page.set_viewport_size({"width":width,"height":900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.set_viewport_size({"width":1440,"height":1000})
    page.keyboard.press('n');expect(page.locator('dialog')).to_be_visible()
    expect(page.locator('#text-content')).to_be_focused()
    page.keyboard.press('Escape');expect(page.locator('dialog')).to_have_count(0)
    page.locator('#settings-button').click()
    page.locator('input[name="theme"][value="dark"]').check()
    page.locator('#language').select_option('ar')
    page.locator('#preferences-form button[type="submit"]').click()
    expect(page.locator('html')).to_have_attribute('dir','rtl')
    expect(page.locator('html')).to_have_attribute('data-theme','dark')
    for width in [1440,390,320]:
        page.set_viewport_size({"width":width,"height":900})
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth')
    page.screenshot(path=str(SCREENSHOTS/'rtl-dark-mobile.png'),full_page=True)
    assert not errors

def test_content_first_bidirectional_transfers_and_exact_downloads(contexts, base_url, tmp_path):
    ca=contexts(viewport={"width":1440,"height":1100});cb=contexts(viewport={"width":390,"height":844},is_mobile=True,has_touch=True)
    a=open_page(ca,base_url);b=open_page(cb,base_url)
    errors=[]
    for page in [a,b]:page.on('pageerror',lambda error:errors.append(str(error)))
    add_text(a,'https://example.com/project-notes')
    expect(a.locator('.item-card')).to_have_count(1)
    expect(a.locator('.item-card')).to_have_class(re.compile(r'state-queued'))
    pair(a,b)
    accept_one(b)
    b.locator('.kind-link.state-complete').wait_for(timeout=10000)
    a.locator('.kind-link.state-complete').wait_for(timeout=10000)
    assert b.locator('.kind-link a').get_attribute('href')=='https://example.com/project-notes'
    add_text(b,'A thought from the other device. مرحباً')
    accept_one(a)
    a.locator('.kind-text.state-complete').wait_for(timeout=10000)
    assert 'مرحباً' in a.locator('.kind-text .content-preview').inner_text()
    payload=bytes(range(256))*8192
    for name,data in [('all-bytes.bin',payload),('empty.txt',b'')]:
        a.locator('#file-input').set_input_files({'name':name,'mimeType':'application/octet-stream','buffer':data})
        accept_one(b)
        received=b.locator('.item-card').filter(has=b.locator('h3',has_text=name))
        expect(received).to_have_class(re.compile('state-complete'),timeout=20000)
        with b.expect_download(timeout=10000) as download:
            received.locator('[data-item-action="download"]').click()
        target=tmp_path/name;download.value.save_as(target)
        assert target.read_bytes()==data
    a.screenshot(path=str(SCREENSHOTS/'real-transfer-desktop.png'),full_page=True)
    b.screenshot(path=str(SCREENSHOTS/'real-transfer-mobile.png'),full_page=True)
    a.locator('[data-action="end"]').click();a.locator('#confirm-end').click()
    expect(a.locator('#pair-card')).to_have_attribute('data-state','ended')
    expect(b.locator('#pair-card')).to_have_attribute('data-state','ended')
    expect(a.locator('.item-card')).to_have_count(0);expect(b.locator('.item-card')).to_have_count(0)
    assert not errors

def test_resume_after_forced_rtc_disconnect_verifies_final_bytes(contexts, base_url, tmp_path):
    ca=contexts();cb=contexts()
    ca.add_init_script(RTC_OBSERVER);cb.add_init_script(RTC_OBSERVER)
    a=open_page(ca,base_url);b=open_page(cb,base_url);pair(a,b)
    a.evaluate('window.__cutAt = 1024 * 1024')
    payload=bytes(range(256))*(65536) # 16 MB; many chunks and multiple ACK windows.
    a.locator('#file-input').set_input_files({'name':'resume-check.bin','mimeType':'application/octet-stream','buffer':payload})
    accept_one(b)
    deadline=time.monotonic()+15
    while not a.evaluate('window.__cutDone') and time.monotonic()<deadline:
        a.wait_for_timeout(50)
    assert a.evaluate('window.__cutDone'), 'The test must actually interrupt the transfer.'
    b.locator('.kind-file.state-complete').wait_for(timeout=45000)
    a.locator('.kind-file.state-complete').wait_for(timeout=15000)
    frames=a.evaluate('window.__frames')
    first_pc=frames[0]['pc'];resumed=[frame for frame in frames if frame['pc']!=first_pc]
    assert resumed and resumed[0]['offset']>0, 'Resume must start at acknowledged bytes, not byte zero.'
    with b.expect_download() as download:b.locator('[data-item-action="download"]').click()
    path=tmp_path/'resumed.bin';download.value.save_as(path)
    assert hashlib.sha256(path.read_bytes()).digest()==hashlib.sha256(payload).digest()

def test_declining_cancelling_and_unsafe_text_do_not_execute_content(contexts,base_url):
    a=open_page(contexts(),base_url);b=open_page(contexts(),base_url);pair(a,b)
    add_text(a,'javascript:alert("not a website")')
    expect(a.locator('.kind-text')).to_have_count(1)
    b.locator('[data-item-action="decline"]').click()
    a.locator('.state-declined').wait_for()
    assert b.locator('.item-card a').count()==0
    a.locator('#file-input').set_input_files({'name':'<img onerror=alert(1)>.txt','mimeType':'text/plain','buffer':b'not executable'})
    b.locator('[data-item-action="accept"]').wait_for()
    assert b.locator('.item-card img').count()==0
    b.locator('.state-incoming [data-item-action="remove"]').click()
    a.locator('.kind-file.state-cancelled').wait_for()
    assert b.locator('.state-incoming').count()==0

def test_qr_deep_link_removes_fragment_and_requires_approval(contexts,base_url):
    ca=contexts();cb=contexts();a=ca.new_page();captured=[]
    a.on('response',lambda response:captured.append(response.json()) if response.url.endswith('/api/session') and response.status==201 else None)
    a.goto(base_url,wait_until='domcontentloaded');a.locator('[data-testid="pairing-code"]').wait_for()
    assert captured
    state=captured[0]['state'];link=f"{base_url}/#join={state['roomId']}.{state['inviteSecret']}"
    b=cb.new_page();b.goto(link,wait_until='domcontentloaded')
    a.locator('[data-action="pair-accept"]').wait_for(timeout=10000)
    assert '#' not in b.url
    a.locator('[data-action="pair-decline"]').click()
    b.locator('#join-code').wait_for()
    expect(b.locator('#join-error')).not_to_be_empty()
