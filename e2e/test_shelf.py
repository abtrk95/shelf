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
    a.locator('#app[data-connection="connected"]').wait_for(timeout=25000)
    b.locator('#app[data-connection="connected"]').wait_for(timeout=15000)
    expect(a.locator('[data-testid="safety-code"]')).to_have_text(re.compile(r"^[A-F0-9]{4} [A-F0-9]{4}$"))
    expect(b.locator('[data-testid="safety-code"]')).to_have_text(re.compile(r"^[A-F0-9]{4} [A-F0-9]{4}$"))
    assert a.locator('[data-testid="safety-code"]').inner_text() == b.locator('[data-testid="safety-code"]').inner_text()

def add_text(page, value):
    page.locator('.drop-buttons [data-action="text"]').click()
    page.locator('#text-content').fill(value)
    page.locator('#text-form button[type="submit"]').click()

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
    b.locator('.kind-link.state-complete').wait_for(timeout=10000)
    a.locator('.kind-link.state-complete').wait_for(timeout=10000)
    assert b.locator('.kind-link a').get_attribute('href')=='https://example.com/project-notes'
    add_text(b,'A thought from the other device. مرحباً')
    a.locator('.kind-text.state-complete').wait_for(timeout=10000)
    assert 'مرحباً' in a.locator('.kind-text .content-preview').inner_text()
    payload=bytes(range(256))*8192
    for name,data in [('all-bytes.bin',payload),('empty.txt',b'')]:
        a.locator('#file-input').set_input_files({'name':name,'mimeType':'application/octet-stream','buffer':data})
        received=b.locator('.item-card').filter(has=b.locator('h3',has_text=name))
        expect(received).to_have_class(re.compile('state-complete'),timeout=20000)
        with b.expect_download(timeout=10000) as download:
            received.locator('[data-item-action="download"]').click()
        target=tmp_path/name;download.value.save_as(target)
        assert target.read_bytes()==data
    a.screenshot(path=str(SCREENSHOTS/'real-transfer-desktop.png'),full_page=True)
    b.screenshot(path=str(SCREENSHOTS/'real-transfer-mobile.png'),full_page=True)
    a.locator('#connection-button').click();a.locator('[data-action="end"]').click();a.locator('#confirm-end').click()
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

def test_unsafe_content_stays_inert_and_arrives_without_opening_anything(contexts,base_url):
    a=open_page(contexts(),base_url);b=open_page(contexts(),base_url);pair(a,b)
    dialogs=[];downloads=[]
    b.on('dialog',lambda d:(dialogs.append(d.message),d.dismiss()))
    b.on('download',lambda d:downloads.append(d.suggested_filename))
    add_text(a,'javascript:alert("not a website")')
    b.locator('.kind-text.state-complete').wait_for()
    assert b.locator('.item-card a').count()==0
    a.locator('#file-input').set_input_files({'name':'<img onerror=alert(1)>.txt','mimeType':'text/plain','buffer':b'not executable'})
    b.locator('.kind-file.state-complete').wait_for()
    assert b.locator('.kind-file img').count()==0
    assert b.locator('[data-item-action="accept"]').count()==0
    assert not dialogs and not downloads
    assert b.url==base_url+'/'


def test_qr_deep_link_pairs_directly_and_removes_fragment(contexts,base_url):
    ca=contexts();cb=contexts();a=ca.new_page();captured=[]
    a.on('response',lambda response:captured.append(response.json()) if response.url.endswith('/api/session') and response.status==201 else None)
    a.goto(base_url,wait_until='domcontentloaded');a.locator('[data-testid="pairing-code"]').wait_for()
    assert captured
    state=captured[0]['state'];link=f"{base_url}/#join={state['roomId']}.{state['inviteSecret']}"
    a.locator('[data-action="expand-qr"]').click()
    b=cb.new_page();b.goto(link,wait_until='domcontentloaded')
    a.locator('#app[data-connection="connected"]').wait_for(timeout=25000)
    b.locator('#app[data-connection="connected"]').wait_for(timeout=15000)
    assert '#' not in b.url
    expect(a.locator('dialog')).to_have_count(0)
    assert a.locator('[data-action="pair-accept"]').count()==0
    assert b.locator('[data-action="pair-accept"]').count()==0


def test_mobile_connected_workspace_keeps_sender_visible_and_details_in_dialog(contexts,base_url):
    a=open_page(contexts(),base_url)
    b=open_page(contexts(viewport={"width":390,"height":844},is_mobile=True,has_touch=True),base_url)
    pair(a,b)
    expect(b.locator('.connection-space')).to_be_hidden()
    expect(b.locator('#active-intro')).to_be_visible()
    assert b.evaluate('scrollY')==0
    box=b.locator('#dropzone').bounding_box()
    assert box['y']>=72 and box['y']+box['height']<700
    assert b.locator('.paste-hint').count()==0
    assert 'No account. No installation.' not in b.locator('body').inner_text()
    b.locator('#connection-button').click()
    expect(b.locator('.connection-dialog')).to_be_visible()
    expect(b.locator('.connection-dialog [data-action="end"]')).to_be_visible()
    assert b.locator('#pair-card').count()==1
    b.keyboard.press('Escape')
    expect(b.locator('dialog')).to_have_count(0)
    expect(b.locator('#connection-button')).to_be_focused()
    expect(b.locator('.connection-space')).to_be_hidden()
    b.screenshot(path=str(SCREENSHOTS/'connected-mobile-v11.png'),full_page=True)
    b.locator('footer [data-action="help"]').click()
    expect(b.locator('dialog')).to_be_visible()
    assert b.locator('dialog kbd').count()==0


def test_connection_dialog_code_form_connects_without_duplicate_ids(contexts,base_url):
    a=open_page(contexts(),base_url);b=open_page(contexts(),base_url)
    code=a.locator('[data-testid="pairing-code"]').inner_text()
    b.locator('#connection-button').click()
    b.locator('[data-action="join-code"]').click()
    assert b.locator('#join-code').count()==1
    b.locator('#join-code').fill(code)
    b.locator('#join-form button[type="submit"]').click()
    b.locator('#app[data-connection="connected"]').wait_for(timeout=25000)
    expect(b.locator('dialog')).to_have_count(0)
    expect(b.locator('.connection-space')).to_be_hidden()


def test_full_text_reader_preserves_text_scrolls_and_returns_focus(contexts,base_url):
    context=contexts(viewport={"width":390,"height":844},is_mobile=True,has_touch=True)
    a=open_page(contexts(),base_url);b=open_page(context,base_url);pair(a,b)
    text='  A shared thought\n\n'+('Long notes, clear ideas. مرحباً 🌿\n'*230)+'<img src=x onerror=alert(1)>\n  '
    add_text(a,text)
    b.locator('.kind-text.state-complete').wait_for()
    preview=b.locator('.text-trigger')
    preview.click()
    expect(b.locator('.reader-dialog')).to_be_visible()
    assert b.locator('.reader-content p').text_content()==text
    assert b.locator('.reader-content img, .reader-content script').count()==0
    assert b.locator('.reader-content').evaluate('(e)=>e.scrollHeight>e.clientHeight')
    assert b.evaluate('document.documentElement.scrollWidth<=innerWidth')
    b.locator('.reader-content').evaluate('(e)=>{e.scrollTop=e.scrollHeight}')
    assert b.locator('.reader-content').evaluate('(e)=>e.scrollTop>0')
    # Keep action controls visible even when reading the end of a long note.
    expect(b.locator('[data-reader-action]')).to_be_visible()
    for _ in range(8):
        b.keyboard.press('Tab')
        assert b.evaluate('document.activeElement.closest("dialog")!==null')
    b.screenshot(path=str(SCREENSHOTS/'text-reader-mobile-v11.png'),full_page=True)
    b.keyboard.press('Escape')
    expect(b.locator('dialog')).to_have_count(0)
    expect(preview).to_be_focused()
    assert 'modal-open' not in b.locator('html').get_attribute('class')


def test_card_nodes_survive_progress_and_reduced_motion_is_respected(contexts,base_url):
    a=open_page(contexts(),base_url);b=open_page(contexts(),base_url);pair(a,b)
    a.emulate_media(reduced_motion='reduce');b.emulate_media(reduced_motion='reduce')
    add_text(a,'First note')
    a.locator('.kind-text.state-complete').wait_for()
    a.evaluate('window.__card=document.querySelector(".item-card")')
    add_text(a,'Second note')
    expect(a.locator('.kind-text.state-complete')).to_have_count(2)
    assert a.evaluate('window.__card.isConnected')
    assert a.evaluate('document.getAnimations().filter(a=>a.playState==="running").length')==0
    assert b.evaluate('document.getAnimations().filter(a=>a.playState==="running").length')==0


def test_received_image_opens_in_local_preview_without_external_requests(contexts,base_url):
    import base64
    a=open_page(contexts(),base_url);b=open_page(contexts(),base_url);pair(a,b)
    png=base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jDfsAAAAASUVORK5CYII=')
    a.locator('#file-input').set_input_files({'name':'sample.png','mimeType':'image/png','buffer':png})
    b.locator('.kind-image.state-complete').wait_for()
    b.locator('.image-trigger').click()
    expect(b.locator('.reader-image img')).to_be_visible()
    assert b.locator('.reader-image img').get_attribute('src').startswith('blob:')
    b.keyboard.press('Escape')
    expect(b.locator('.image-trigger')).to_be_focused()
