from pathlib import Path
p=Path('./e2e/test_shelf.py');s=p.read_text()
a=s.index('    a.locator(\'[data-action="pair-accept"]\')');b=s.index('    a.locator(\'#app[data-connection="connected"]\')',a)
s=s[:a]+s[b:]
s=s.replace('    accept_one(b)\n','').replace('    accept_one(a)\n','')
a=s.index('def accept_one(');b=s.index('def test_responsive',a);s=s[:a]+s[b:]
s=s.replace("    a.locator('[data-action=\"end\"]').click();a.locator('#confirm-end').click()", "    a.locator('#connection-button').click();a.locator('[data-action=\"end\"]').click();a.locator('#confirm-end').click()")
a=s.index('def test_declining_cancelling');s=s[:a]+'''def test_unsafe_content_stays_inert_and_arrives_without_opening_anything(contexts,base_url):
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
    b.locator('[data-action="help"]').first.click()
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
    text='  A shared thought\\n\\n'+('Long notes, clear ideas. مرحباً 🌿\\n'*230)+'<img src=x onerror=alert(1)>\\n  '
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
'''
s=s.replace('            received=b.locator', '        received=b.locator')
p.write_text(s)
