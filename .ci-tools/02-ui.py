from pathlib import Path
root=Path('.');p=root/'src/main.ts';s=p.read_text()
def rep(old,new,count=1):
 global s
 assert s.count(old)==count,(s.count(old),old[:120]);s=s.replace(old,new)
rep("import { TransferEngine } from './lib/transfer.js';","import { TransferEngine } from './lib/transfer.js';\nimport { createDialog, desktopShortcuts, reconcileCards, reducedMotion } from './lib/ui.js';")
rep("ConnectionState, PairRequest, RoomState", "ConnectionState, RoomState")
rep("  private pending: PairRequest | null = null;\n  private joinWaiting = false;\n",'')
rep('''<button class="privacy-link" data-action="privacy">${icon('lock')}<span>${t('noAccount')}</span></button><span class="header-divider"></span>''','''<button type="button" id="connection-button" class="connection-trigger" data-action="connection" aria-haspopup="dialog"><i class="connection-dot" aria-hidden="true"></i><span class="connection-name">${t('connectDevice')}</span>${icon('chevronDown')}</button><span class="header-divider"></span>''')
rep('''        <div class="workspace-grid">''','''        <section class="active-intro" id="active-intro" aria-labelledby="active-title" hidden><div><span class="eyebrow">${t('connectedEyebrow')}</span><h1 id="active-title">${t('activeTitle')}</h1><p>${t('autoHint')}</p></div><span class="active-emblem" aria-hidden="true">${icon('check')}</span></section>
        <div class="workspace-grid">''')
rep('''<div class="paste-hint"><kbd>${/Mac|iPhone|iPad/.test(navigator.userAgent)?'⌘':'Ctrl'}</kbd><kbd>V</kbd><span>${t('pasteHint')}</span></div>''','''${desktopShortcuts()?`<div class="paste-hint desktop-only"><kbd>${/Mac/.test(navigator.platform)?'⌘':'Ctrl'}</kbd><kbd>V</kbd><span>${t('pasteHint')}</span></div>`:''}''')
rep('''<aside class="connection-space"><div id="pair-card" class="pair-card" aria-label="${e(t('connection'))}"></div>''','''<aside class="connection-space"><div id="pair-card-home"><div id="pair-card" class="pair-card" aria-label="${e(t('connection'))}"></div></div>''')
rep("this.bootError='';this.joinWaiting=false;this.pending=null;this.room={};", "this.bootError='';this.room={};this.connection='idle';")
a=s.index('      this.engine=new TransferEngine(');b=s.index('      this.peer=new PeerTransport(',a)
s=s[:a]+'''      this.engine=new TransferEngine(storage,session.config.maxFileBytes,()=>{
        this.root.dataset.transferring=String(this.engine?.active||false);this.renderShelf();void this.manageWake();
      },message=>this.toast(message),item=>{
        this.playSound();this.announce(this.t(item.direction==='received'?'completeReceived':'completeSent'));
        if(item.direction==='received')this.toast(this.t('itemReceived'),()=>this.viewShelf());
      });
'''+s[b:]
rep("this.room=event.state;this.pending=event.state.pending||null;", "this.room=event.state;")
rep("if(event.state.peer){this.joinWaiting=false;this.joining=false;this.peer?.connect", "if(event.state.peer){this.joining=false;this.peer?.connect")
rep("    }else if(event.type==='pair-request'&&event.request){this.pending=event.request;this.renderPair();this.toast(`${event.request.name} ${this.t('connectRequest')}`);}\n    else if(event.type==='pair-rejected'){this.joinWaiting=false;this.joining=false;this.pending=null;this.joinError=event.message||'';this.renderPair();}\n    else if(event.type==='signal'&&event.signal)","    }else if(event.type==='signal'&&event.signal)")
rep("this.expired=expired;this.pending=null;this.joinWaiting=false;this.room={};", "this.expired=expired;this.room={};this.connection='idle';")
rep("  private renderPair(): void {\n    const container", "  private renderPair(): void {\n    this.syncWorkspace();\n    const container")
a=s.index('      }else if(this.pending){');b=s.index('      }else{',a);s=s[:a]+s[b:]
rep("this.ended?'ended':this.room.peer?this.connection:this.pending?'pending':'waiting'", "this.ended?'ended':this.room.peer?this.connection:'waiting'")
rep('''    container.innerHTML=header+content;''','''    const warning=!this.room.peer&&!this.ended&&!this.starting&&!this.bootError?`<p class="pair-safety-hint">${icon('lock')}${t('invitePrivacy')}</p>`:'';
    container.innerHTML=header+content+warning;''')
rep("!this.room.peer&&!this.pending&&this.room.inviteExpiresAt", "!this.room.peer&&this.room.inviteExpiresAt")
rep("try{await this.client.post('/api/join',invite||{code});this.joinWaiting=true;this.pairingTab='join';}","try{const result=await this.client.post<{paired:boolean;state:RoomState}>('/api/join',invite||{code});if(result.state)this.handleEvent({type:'snapshot',state:result.state});}")
a=s.index('  private status(item: ShelfItem)')
s=s[:a]+'''  private syncWorkspace(): void {
    const paired=!!this.room.peer&&!this.ended,wasPaired=this.root.dataset.paired==='true';
    this.root.dataset.paired=String(paired);this.root.dataset.connection=this.connection;
    const intro=this.root.querySelector<HTMLElement>('#active-intro');if(intro)intro.hidden=!paired;
    const button=this.root.querySelector<HTMLButtonElement>('#connection-button');
    if(button){
      const name=paired?this.room.peer!.name:this.t('connectDevice');
      const status=paired?this.t(this.connection==='connected'?'connectedShort':this.connection==='blocked'?'blocked':'connecting'):this.t('connectDevice');
      const label=button.querySelector('.connection-name');if(label)label.textContent=name;
      button.setAttribute('aria-label',paired?`${status}: ${name}. ${this.t('connectionTitle')}`:this.t('connectDevice'));
      button.title=paired?`${status} · ${this.t('connectionTitle')}`:this.t('connectDevice');
      button.dataset.state=this.connection;
    }
    const mobile=this.root.querySelector<HTMLButtonElement>('[data-action="mobile-connect"]');
    if(mobile){const label=mobile.querySelector('span');if(label)label.textContent=this.t(paired?'connectionTitle':'connectDevice');}
    const subtitle=this.root.querySelector('.drop-foot-note');if(subtitle)subtitle.textContent=this.t(paired?'keepOpen':'queuedHint');
    if(paired&&!wasPaired){
      if(this.dialog?.classList.contains('connection-dialog')||this.dialog?.classList.contains('qr-dialog'))this.dialog.close();
      // Pairing may finish while the user is reading lower on the page. Return to
      // the now-compact sender once, never on every signal or progress update.
      if(!this.dialog?.open||this.dialog.dataset.closing)window.scrollTo({top:0,behavior:'instant'});
    }
    if(this.connection==='blocked'){
      const note=this.root.querySelector<HTMLElement>('#active-intro p');if(note)note.textContent=this.t('blockedHint');
    }else if(paired){
      const note=this.root.querySelector<HTMLElement>('#active-intro p');if(note)note.textContent=this.t(this.connection==='connected'?'autoHint':'reconnectHint');
    }
  }
  private openConnection(): void {
    if(this.dialog?.classList.contains('connection-dialog'))return;
    const card=document.querySelector<HTMLElement>('#pair-card'),home=this.root.querySelector('#pair-card-home');
    if(!card||!home)return;
    const dialog=this.openDialog(this.t('connectionTitle'),`<div class="connection-panel-slot"></div><p class="connection-dialog-note">${this.t('keepOpen')}</p>`,'connection-dialog');
    dialog.querySelector('.connection-panel-slot')!.append(card);
    dialog.addEventListener('close',()=>{if(home.isConnected)home.append(card);},{once:true});
    this.renderPair();
  }
  private viewShelf():void {
    this.filter='all';this.renderShelf();
    document.querySelector('#shelf-title')?.scrollIntoView({behavior:reducedMotion()?'instant':'smooth',block:'start'});
  }
'''+s[a:]
rep("    container.innerHTML=filtered.map(item=>this.itemCard(item)).join('');","    reconcileCards(container,filtered.map(item=>({id:item.id,html:this.itemCard(item)})));")
rep('''if(kind==='image'&&item.url&&localContent)body=`<div class="image-preview"><img src="${e(item.url)}" alt="${e(item.name)}" loading="lazy"></div>`;''','''if(kind==='image'&&item.url&&localContent)body=`<button type="button" class="preview-trigger image-trigger" data-item="${item.id}" data-item-action="preview" aria-label="${e(t('preview'))}: ${e(item.name)}" aria-haspopup="dialog"><span class="image-preview"><img src="${e(item.url)}" alt="${e(item.name)}" loading="lazy"></span><span class="preview-caption">${t('preview')}${icon('expand')}</span></button>`;''')
rep('''else if(item.kind!=='file'&&localContent&&item.text)body=`<p class="content-preview ${item.kind==='link'?'url-preview':''}" dir="auto">${e(item.text.slice(0,260))}</p>`;''','''else if(item.kind!=='file'&&localContent&&item.text)body=`<button type="button" class="preview-trigger text-trigger" data-item="${item.id}" data-item-action="preview" aria-label="${e(t('readText'))}" aria-haspopup="dialog"><span class="content-preview ${item.kind==='link'?'url-preview':''}" dir="auto">${e(item.text.slice(0,320))}</span><span class="preview-caption">${t('readText')}${icon('expand')}</span></button>`;''')
rep("if(item.state==='incoming')actions=action('decline',t('decline'),'close')+action('accept',t('receive'),'arrowDown','item-button primary',!this.engine?.connected);", "if(item.state==='incoming')actions=action('cancel',t('cancel'),'close');")
a=s.index('  private openDialog(');b=s.index('  private openText():',a)
s=s[:a]+'''  private openDialog(title:string,body:string,classes=''):HTMLDialogElement {
    this.dialog?.close();
    const dialog=createDialog({title,body,classes,closeLabel:this.t('close'),onClose:()=>{
      if(this.dialog===dialog)this.dialog=null;void this.manageWake();
    }});
    this.dialog=dialog;return dialog;
  }
'''+s[b:]
rep('''<h3 class="dialog-section-title">${t('shortcuts')}</h3><div class="shortcuts">${[['Ctrl / ⌘ + V','shortcutPaste'],['Ctrl / ⌘ + O','shortcutFiles'],['N','shortcutNote'],['J','shortcutJoin']].map(([key,label])=>`<div><span>${t(label as TranslationKey)}</span><kbd dir="ltr">${key}</kbd></div>`).join('')}</div>''','''${desktopShortcuts()?`<div class="desktop-only"><h3 class="dialog-section-title">${t('shortcuts')}</h3><div class="shortcuts">${[['Ctrl / ⌘ + V','shortcutPaste'],['Ctrl / ⌘ + O','shortcutFiles'],['N','shortcutNote'],['J','shortcutJoin']].map(([key,label])=>`<div><span>${t(label as TranslationKey)}</span><kbd dir="ltr">${key}</kbd></div>`).join('')}</div></div>`:''}''')
a=s.index('  private async itemAction(')
s=s[:a]+'''  private showPreview(item:ShelfItem):void {
    const t=this.t,isText=item.kind!=='file';
    const content=isText?`<div class="reader-content" tabindex="0" aria-label="${e(t('fullText'))}"><p dir="auto">${e(item.text||'')}</p></div>`:`<div class="reader-image"><img src="${e(item.url||'')}" alt="${e(item.name)}"></div>`;
    const label=isText?t('readText'):t('preview');
    const dialog=this.openDialog(label,`<div class="reader-meta"><span dir="auto">${e(isText?t(item.kind==='link'?'links':'note'):item.name)}</span><span>${formatBytes(item.size)}</span></div>${content}<div class="reader-footer"><span class="small-muted">${icon('lock')}${t('onlyHere')}</span><button type="button" class="button primary" data-reader-action>${icon(isText?'copy':'download')}${t(isText?'copy':'download')}</button></div>`,'reader-dialog');
    dialog.querySelector('[data-reader-action]')!.addEventListener('click',()=>{void this.itemAction(item.id,isText?'copy':'download');});
  }
'''+s[a:]
rep("else if(action==='details')this.showDetails(item);","else if(action==='details')this.showDetails(item);\n      else if(action==='preview')this.showPreview(item);")
rep("case 'settings':this.openSettings();break;", "case 'connection':this.openConnection();break;\n        case 'settings':this.openSettings();break;")
rep("        case 'pair-accept':case 'pair-decline':if(this.pending)await this.client?.post('/api/pair/decision',{requestId:this.pending.id,accept:action==='pair-accept'});break;\n        case 'cancel-join':await this.client?.post('/api/pair/cancel',{});this.joinWaiting=false;this.renderPair();break;\n",'')
rep("case 'mobile-connect':document.querySelector('#pair-card')?.scrollIntoView({behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth',block:'center'});break;", "case 'mobile-connect':this.openConnection();break;")
rep("this.root.addEventListener('click',event=>{", "document.addEventListener('click',event=>{")
rep("this.root.addEventListener('submit',event=>", "document.addEventListener('submit',event=>")
rep("this.root.addEventListener('input',event=>", "document.addEventListener('input',event=>")
rep("event.preventDefault();void this.action('join-code');", "event.preventDefault();this.openConnection();if(!this.room.peer)void this.action('join-code');")
rep("    const el=document.querySelector<HTMLDivElement>('#toast')!;if(this.toastTimer)clearTimeout(this.toastTimer);", "    const inline=this.dialog?.open&&!this.dialog.dataset.closing?this.dialog.querySelector<HTMLElement>('.dialog-status'):null;\n    if(inline){inline.textContent=message;inline.hidden=false;return;}\n    const el=document.querySelector<HTMLDivElement>('#toast')!;if(this.toastTimer)clearTimeout(this.toastTimer);")
p.write_text(s)
p=root/'public/index.html';s=p.read_text().replace('Connect two browsers. No account. No installation.','Connect two browsers. Share instantly.').replace('<link rel="stylesheet" href="/styles.css">','<link rel="stylesheet" href="/styles.css">\n  <link rel="stylesheet" href="/workspace.css">');p.write_text(s)
print('Main UI integration applied.')
