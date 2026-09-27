import { icon, logo } from './components/icons.js';
import { translator, type TranslationKey, type Language } from './lib/i18n.js';
import { escapeHTML as e, safeURL, safeFilename, formatBytes, formatClock, deviceName, isMobileDevice, errorMessage } from './lib/utils.js';
import { qrSVG } from './lib/qr.js';
import { SignalingClient } from './lib/signaling.js';
import { PeerTransport } from './lib/peer.js';
import { TemporaryStorage } from './lib/storage.js';
import { TransferEngine } from './lib/transfer.js';
import { createDialog, desktopShortcuts, reconcileCards, reducedMotion } from './lib/ui.js';
import type { ConnectionState, RoomState, SecurityState, ServerEvent, Session, ShelfItem } from './lib/types.js';

type Theme = 'system' | 'light' | 'dark';
interface Preferences { theme: Theme; language: Language; name: string; sound: boolean }
const DEFAULTS: Preferences = { theme:'system',language:'en',name:'',sound:false };
function loadPreferences(): Preferences {
  try {
    const value=JSON.parse(localStorage.getItem('shelf.preferences.v1')||'{}');
    return {theme:['system','light','dark'].includes(value.theme)?value.theme:'system',language:value.language==='ar'?'ar':'en',name:typeof value.name==='string'?value.name.slice(0,40):'',sound:value.sound===true};
  }catch{return {...DEFAULTS};}
}
class ShelfApp {
  private root = document.querySelector<HTMLDivElement>('#app')!;
  private prefs = loadPreferences();
  private t = translator(this.prefs.language);
  private client: SignalingClient | null = null;
  private peer: PeerTransport | null = null;
  private engine: TransferEngine | null = null;
  private session: Session | null = null;
  private room: RoomState = {};
  private security: SecurityState = {route:'encrypted',safetyCode:''};
  private connection: ConnectionState = 'idle';
  private serviceOnline = false;
  private joining = false;
  private joinCode = '';
  private joinError = '';
  private pairingTab: 'show' | 'join' = 'show';
  private filter: 'all' | 'file' | 'link' | 'text' = 'all';
  private view: 'grid' | 'list' = 'grid';
  private starting = true;
  private ended = false;
  private expired = false;
  private bootError = '';
  private generation = 0;
  private invitation: { roomId:string;secret:string } | null = null;
  private rotating = false;
  private dragDepth = 0;
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private wake: WakeLockSentinel | null = null;
  private wakeRequest = false;
  private audio: AudioContext | null = null;
  private dialog: HTMLDialogElement | null = null;
  private lastNotice = '';
  constructor() {
    const hash=new URLSearchParams(location.hash.slice(1));const invite=hash.get('join');
    if(invite){const match=/^([\w-]{16})\.([\w-]{32})$/.exec(invite);if(match)this.invitation={roomId:match[1],secret:match[2]};history.replaceState(null,'',location.pathname+location.search);}
    this.applyPreferences();this.renderFrame();this.bind();
    setInterval(()=>this.tick(),1000);
    void this.start();
  }
  private applyPreferences(): void {
    const dark=this.prefs.theme==='dark'||(this.prefs.theme==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.dataset.theme=dark?'dark':'light';document.documentElement.lang=this.prefs.language;document.documentElement.dir=this.prefs.language==='ar'?'rtl':'ltr';
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content',dark?'#181e19':'#f7f8f2');this.t=translator(this.prefs.language);
    try{localStorage.setItem('shelf.preferences.v1',JSON.stringify(this.prefs));}catch{/* A private or restricted browser may deny preference storage. */}
  }
  private button(action: string, text: string, glyph = '', classes = 'button', extra = ''): string {
    return `<button type="button" class="${classes}" data-action="${action}" ${extra}>${glyph?icon(glyph):''}<span>${e(text)}</span></button>`;
  }
  private iconButton(action: string, label: string, glyph: string, extra = ''): string {
    return `<button type="button" class="icon-button" data-action="${action}" aria-label="${e(label)}" title="${e(label)}" ${extra}>${icon(glyph)}</button>`;
  }
  private renderFrame(): void {
    const t=this.t;
    this.root.innerHTML=`
      <header class="header"><div class="header-inner">
        <a class="brand" href="/" aria-label="Shelf home"><span class="brand-mark">${logo}</span><span>shelf<span class="brand-dot">.</span></span></a>
        <nav class="nav" aria-label="Main"><span class="nav-current">${t('workspace')}</span><button data-action="help">${t('how')}</button></nav>
        <div class="header-actions"><button type="button" id="connection-button" class="connection-trigger" data-action="connection" aria-haspopup="dialog"><i class="connection-dot" aria-hidden="true"></i><span class="connection-name">${t('connectDevice')}</span>${icon('chevronDown')}</button><span class="header-divider"></span>${this.iconButton('theme',t('theme'),'sun','id="theme-button"')}${this.iconButton('settings',t('settings'),'settings','id="settings-button"')}</div>
      </div></header>
      <main class="main" id="workspace" tabindex="-1">
        <div id="notice" class="notice" hidden></div>
        <section class="active-intro" id="active-intro" aria-labelledby="active-title" hidden><div><span class="eyebrow">${t('connectedEyebrow')}</span><h1 id="active-title">${t('activeTitle')}</h1><p>${t('autoHint')}</p></div><span class="active-emblem" aria-hidden="true">${icon('check')}</span></section>
        <div class="workspace-grid">
          <section class="send-space" aria-labelledby="hero-title">
            <div class="intro"><div class="eyebrow"><span class="tiny-spark">${icon('sparkle')}</span>${t('eyebrow')}</div><h1 id="hero-title">${t('title1')}<br><span>${t('title2')}</span></h1><p>${t('intro')}</p></div>
            <div class="dropzone" id="dropzone" aria-label="${e(t('dropTitle'))}">
              <div class="drop-art" aria-hidden="true"><div class="art-orbit"></div><div class="art-card art-document">${icon('file')}</div><div class="art-card art-picture">${icon('image')}</div><div class="art-link">${icon('link')}</div><span class="art-spark spark-one">+</span><span class="art-spark spark-two">+</span></div>
              <h2 id="drop-title">${t('dropTitle')}</h2><p>${t('dropSubtitle')}</p>
              <div class="drop-buttons">${this.button('files',t('chooseFiles'),'plus','button primary')}${this.button('text',t('addText'),'link','button secondary')}</div>
              ${desktopShortcuts()?`<div class="paste-hint desktop-only"><kbd>${/Mac/.test(navigator.platform)?'⌘':'Ctrl'}</kbd><kbd>V</kbd><span>${t('pasteHint')}</span></div>`:''}
              ${this.iconButton('folder',t('chooseFolder'),'folder','id="folder-button"')}
            </div>
            <div class="drop-foot"><span>${icon('checkCircle')}${t('original')}</span><span>${icon('lock')}${t('noUploads')}</span><span class="drop-foot-note">${t('queuedHint')}</span></div>
          </section>
          <aside class="connection-space"><div id="pair-card-home"><div id="pair-card" class="pair-card" aria-label="${e(t('connection'))}"></div></div><p class="connection-note">${icon('lock')}<span>${t('keepOpen')}</span></p></aside>
        </div>
        <section class="shelf-section" aria-labelledby="shelf-title">
          <div class="shelf-heading"><div><h2 id="shelf-title">${t('shelf')} <span id="shelf-count" class="count-badge">0</span></h2><span class="shelf-subtitle">${t('temporary')}</span></div><div class="shelf-tools">${this.button('clear',t('clear'),'trash','text-button','id="clear-button" disabled')}<div class="view-toggle">${this.iconButton('grid',t('grid'),'grid','aria-pressed="true"')}${this.iconButton('list',t('list'),'list','aria-pressed="false"')}</div></div></div>
          <div class="shelf-filters" role="group" aria-label="Content type">${(['all','file','link','text'] as const).map(key=>`<button class="filter ${key===this.filter?'selected':''}" data-filter="${key}" aria-pressed="${key===this.filter}">${t(({all:'all',file:'files',link:'links',text:'text'} as const)[key])}</button>`).join('')}</div>
          <div id="shelf-items"></div>
        </section>
        <section class="how-strip" aria-label="${e(t('how'))}">${[1,2,3].map((n)=>`<div class="how-step"><span class="step-number">0${n}</span><div><h3>${t(`step${n}` as TranslationKey)}</h3><p>${t(`step${n}Body` as TranslationKey)}</p></div></div>`).join('')}</section>
      </main>
      <footer class="footer"><div><span class="footer-brand">${logo}</span><span>${t('footer')}</span></div><div><button data-action="privacy">${t('privacy')}</button><span class="footer-dot">·</span><button data-action="help">${t('help')}</button></div></footer>
      <div class="mobile-bar">${this.button('files',t('files'),'plus','mobile-action')}${this.button('text',t('text'),'text','mobile-action')}${this.button('mobile-connect',t('connectDevice'),'phone','mobile-action')}</div>
      <input type="file" id="file-input" class="sr-only" multiple tabindex="-1" aria-label="${e(t('chooseFiles'))}">
      <input type="file" id="folder-input" class="sr-only" multiple webkitdirectory tabindex="-1" aria-label="${e(t('chooseFolder'))}">
    `;
    this.renderPair();this.renderShelf();this.renderNotice();this.updateThemeIcon();
  }
  private updateThemeIcon(): void {const button=document.querySelector('#theme-button');if(button)button.innerHTML=icon(document.documentElement.dataset.theme==='dark'?'moon':'sun');}
  private async start(): Promise<void> {
    const generation=++this.generation;this.starting=true;this.ended=false;this.expired=false;this.bootError='';this.room={};this.connection='idle';this.security={route:'encrypted',safetyCode:''};
    this.client?.close();this.peer?.close();const old=this.engine;this.engine=null;await old?.destroy();this.session=null;this.serviceOnline=false;this.renderPair();this.renderShelf();
    if(!window.isSecureContext){this.starting=false;this.bootError=this.t('insecureBody');this.renderPair();return;}
    if(!('RTCPeerConnection' in window)||!crypto.subtle){this.starting=false;this.bootError=this.t('unsupportedBody');this.renderPair();return;}
    const storage=new TemporaryStorage();
    try{
      await storage.initialize();
      const client=new SignalingClient(event=>{if(this.generation===generation)this.handleEvent(event);},online=>{
        if(this.generation!==generation)return;this.serviceOnline=online;if(online)this.peer?.online();this.renderPair();this.renderNotice();
      });this.client=client;
      const session=await client.start(this.prefs.name||deviceName());if(this.generation!==generation){client.close();return;}
      this.session=session;this.room=session.state;
      this.engine=new TransferEngine(storage,session.config.maxFileBytes,()=>{
        this.root.dataset.transferring=String(this.engine?.active||false);this.renderShelf();void this.manageWake();
      },message=>this.toast(message),item=>{
        this.playSound();this.announce(this.t(item.direction==='received'?'completeReceived':'completeSent'));
        if(item.direction==='received')this.toast(this.t('itemReceived'),()=>this.viewShelf());
      });
      this.peer=new PeerTransport(session.config,signal=>client.signal(signal),{
        state:state=>{const was=this.connection;this.connection=state;this.root.dataset.connection=state;this.renderPair();if(state==='connected'&&was!=='connected')this.toast(this.t('connectionApproved'));},
        channel:channel=>this.engine?.setChannel(channel),security:security=>{this.security=security;this.renderPair();},
      });
      this.starting=false;this.renderPair();this.renderShelf();this.renderNotice();
      if(this.invitation){const invite=this.invitation;this.invitation=null;await this.join(invite);}
    }catch(error){if(generation!==this.generation)return;this.starting=false;this.bootError=errorMessage(error);await storage.dispose();this.renderPair();}
  }
  private handleEvent(event: ServerEvent): void {
    if(event.type==='snapshot'&&event.state){
      this.room=event.state;
      if(event.state.ended){this.endLocal(false);return;}
      if(event.state.peer){this.joining=false;this.peer?.connect(event.state.peer.id,!!event.state.initiator);}
      this.renderPair();
    }else if(event.type==='signal'&&event.signal)this.peer?.handle(event.signal);
    else if(event.type==='peer-online')this.peer?.online();
    else if(event.type==='ended')this.endLocal(event.reason==='expired');
  }
  private endLocal(expired: boolean): void {
    if(this.ended)return;this.ended=true;this.expired=expired;this.room={};this.connection='idle';this.dialog?.close();
    this.client?.close();this.peer?.close();const engine=this.engine;this.engine=null;void engine?.destroy();this.serviceOnline=false;
    this.renderPair();this.renderShelf();this.renderNotice();void this.manageWake();
  }
  private invitationURL(): string | null {
    return this.room.roomId&&this.room.inviteSecret?`${location.origin}/#join=${this.room.roomId}.${this.room.inviteSecret}`:null;
  }
  private renderPair(): void {
    this.syncWorkspace();
    const container=document.querySelector<HTMLDivElement>('#pair-card');if(!container)return;
    const focused=document.activeElement instanceof HTMLInputElement&&document.activeElement.id==='join-code';
    const t=this.t;const localName=this.session?.name||this.prefs.name||deviceName();
    const device=(name:string,local=false)=>`<div class="device-row"><span class="device-icon ${local?'':'remote'}">${icon(isMobileDevice(name)?'phone':'laptop')}</span><div><span class="mini-label">${local?t('thisDevice'):t('otherDevice')}</span><strong><bdi>${e(name)}</bdi></strong></div>${local?this.iconButton('settings',t('rename'),'edit'):icon('checkCircle','device-check')}</div>`;
    const header=`<div class="pair-header"><span class="eyebrow">${t('connection')}</span><span class="ready-badge ${this.serviceOnline?'online':''}"><i></i>${this.serviceOnline?t('ready'):t('offline')}</span></div>`;
    let content='';
    if(this.starting)content=`<div class="pair-loading"><span class="spinner"></span><h3>${t('starting')}</h3><div class="skeleton"></div><div class="skeleton short"></div></div>`;
    else if(this.bootError)content=`<div class="pair-error">${icon('alert')}<h3>${!window.isSecureContext?t('insecureTitle'):t('startFailed')}</h3><p>${e(this.bootError)}</p>${this.button('restart',t('reload'),'refresh','button primary full')}</div>`;
    else if(this.ended)content=`<div class="session-ended"><div class="ended-icon">${icon('check')}</div><h3>${this.expired?t('expiredTitle'):t('endedTitle')}</h3><p>${t('endedBody')}</p>${this.button('restart',t('newSession'),'plus','button primary full')}</div>`;
    else{
      content=device(localName,true);
      if(this.room.peer){
        const connected=this.connection==='connected';
        content+=`<div class="connection-bridge ${connected?'connected':''}"><span></span><i>${icon(connected?'lock':'refresh')}</i><span></span>${connected?'<b class="bridge-packet"></b>':''}</div>${device(this.room.peer.name)}
          <div class="connected-copy"><h3>${connected?t('connectedTitle'):this.connection==='blocked'?t('blocked'):this.connection==='reconnecting'?t('reconnecting'):t('connecting')}</h3><p>${connected?t('connectedHint'):this.connection==='blocked'?t('blockedHint'):t('reconnectHint')}</p></div>
          ${connected?`<button class="security-pill" data-action="privacy">${icon('lock')}${t(this.security.route==='direct'?'direct':this.security.route==='relay'?'relay':'encrypted')}</button><div class="safety-mark"><span class="mini-label">${t('safety')}</span><strong dir="ltr" data-testid="safety-code">${e(this.security.safetyCode)||'···· ····'}</strong><p>${t('safetyHint')}</p></div>`:`<div class="reconnecting-art">${this.connection==='blocked'?icon('alert'):'<span class="spinner"></span>'}</div>${this.button('retry-connection',t('retryConnection'),'refresh','button secondary full')}`}
          <div class="session-time"><span>${icon('clock')}${t('sessionLeft')}</span><strong dir="ltr" data-clock="session"></strong>${this.iconButton('extend',t('extend'),'plus')}</div>${this.button('end',t('endSession'),'disconnect','button end-button full')}`;
      }else{
        content+=`<div class="waiting-divider"><span></span>${t('waiting')}<span></span></div><div class="pair-tabs" role="group" aria-label="Pairing method"><button data-action="show-code" aria-pressed="${this.pairingTab==='show'}">${t('myCode')}</button><button data-action="join-code" aria-pressed="${this.pairingTab==='join'}">${t('enterCode')}</button></div>`;
        if(this.pairingTab==='show'){
          let qr='';const url=this.invitationURL();
          if(url)try{qr=qrSVG(url,t('qrLabel'));}catch{qr=`<p>${t('codeHint')}</p>`;}
          content+=`<div class="qr-content"><h3>${t('connectDevice')}</h3><p>${t('scanHint')}</p><div class="qr-wrap">${qr}${this.iconButton('expand-qr',t('expandQR'),'expand')}</div><div class="pairing-code"><strong dir="ltr" data-testid="pairing-code">${e((this.room.code||'').replace(/(.{4})(.{4})/,'$1 $2'))}</strong>${this.iconButton('copy-code',t('copyCode'),'copy')}</div><p class="code-hint">${t('codeHint')}</p></div><div class="pair-card-footer"><span>${icon('clock')}${t('refreshIn')} <b dir="ltr" data-clock="invite"></b></span>${this.iconButton('refresh-code',t('refreshCode'),'refresh')}</div>`;
        }else{
          content+=`<form id="join-form" class="join-form"><div class="join-glyph">${icon('link')}</div><h3>${t('codeHeading')}</h3><p>${t('codeDescription')}</p><label for="join-code" class="sr-only">${t('codeLabel')}</label><input id="join-code" name="code" class="code-input" value="${e(this.joinCode)}" placeholder="ABCD EFGH" maxlength="11" autocapitalize="characters" autocomplete="off" spellcheck="false" dir="ltr" required aria-describedby="join-error"><p id="join-error" class="field-error" role="alert">${e(this.joinError)}</p><button class="button primary full" type="submit" ${this.joining?'disabled':''}>${this.joining?'<span class="spinner small"></span>':icon('arrow')}<span>${this.joining?t('joining'):t('connect')}</span></button></form>`;
        }
      }
    }
    container.dataset.state=this.ended?'ended':this.room.peer?this.connection:'waiting';
    const warning=!this.room.peer&&!this.ended&&!this.starting&&!this.bootError?`<p class="pair-safety-hint">${icon('lock')}${t('invitePrivacy')}</p>`:'';
    container.innerHTML=header+content+warning;
    if(focused){const input=document.querySelector<HTMLInputElement>('#join-code');input?.focus({preventScroll:true});input?.setSelectionRange(input.value.length,input.value.length);}
    this.tickClocks();
  }
  private syncWorkspace(): void {
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
  private status(item: ShelfItem): string {return this.t(item.state==='complete'?(item.direction==='sent'?'completeSent':'completeReceived'):item.state);}
  private renderShelf(): void {
    const container=document.querySelector<HTMLDivElement>('#shelf-items');if(!container)return;
    const t=this.t,items=this.engine?.items||[],filtered=items.filter(item=>this.filter==='all'||item.kind===this.filter);
    const count=document.querySelector('#shelf-count');if(count)count.textContent=String(items.length);
    const clear=document.querySelector<HTMLButtonElement>('#clear-button');if(clear)clear.disabled=!items.some(i=>['complete','error','cancelled','declined'].includes(i.state));
    document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach(b=>{const active=b.dataset.filter===this.filter;b.classList.toggle('selected',active);b.setAttribute('aria-pressed',String(active));});
    document.querySelectorAll<HTMLButtonElement>('.view-toggle button').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.action===this.view)));
    if(!filtered.length){container.className='';container.innerHTML=`<div class="empty-shelf"><div class="empty-symbol">${icon('shelf')}<span>+</span></div><h3>${this.filter==='all'?t('emptyTitle'):t('emptyFiltered')}</h3><p>${t('emptyBody')}</p></div>`;return;}
    const focus=document.activeElement instanceof HTMLButtonElement?document.activeElement:null;const focusedId=focus?.dataset.item,focusedAction=focus?.dataset.itemAction;
    container.className=`items ${this.view}-view`;
    reconcileCards(container,filtered.map(item=>({id:item.id,html:this.itemCard(item)})));
    if(focusedId&&focusedAction)container.querySelector<HTMLButtonElement>(`[data-item="${focusedId}"][data-item-action="${focusedAction}"]`)?.focus({preventScroll:true});
    container.querySelectorAll<HTMLImageElement>('img').forEach(image=>{image.onerror=()=>{image.hidden=true;};});
  }
  private itemCard(item: ShelfItem): string {
    const t=this.t,active=['preparing','sending','receiving','verifying','paused'].includes(item.state),done=item.state==='complete';
    const kind=item.kind==='file'?/^image\/(png|jpeg|gif|webp|avif)$/.test(item.mime)?'image':'file':item.kind;
    const localContent=item.direction==='sent'||done;
    const action=(key:string,label:string,glyph:string,classes='item-icon',disabled=false)=>`<button type="button" class="${classes}" data-item="${item.id}" data-item-action="${key}" aria-label="${e(label)}" title="${e(label)}" ${disabled?'disabled':''}>${icon(glyph)}${classes.includes('item-button')?`<span>${e(label)}</span>`:''}</button>`;
    let body='';
    if(kind==='image'&&item.url&&localContent)body=`<button type="button" class="preview-trigger image-trigger" data-item="${item.id}" data-item-action="preview" aria-label="${e(t('preview'))}: ${e(item.name)}" aria-haspopup="dialog"><span class="image-preview"><img src="${e(item.url)}" alt="${e(item.name)}" loading="lazy"></span><span class="preview-caption">${t('preview')}${icon('expand')}</span></button>`;
    else if(item.kind!=='file'&&localContent&&item.text)body=`<button type="button" class="preview-trigger text-trigger" data-item="${item.id}" data-item-action="preview" aria-label="${e(t('readText'))}" aria-haspopup="dialog"><span class="content-preview ${item.kind==='link'?'url-preview':''}" dir="auto">${e(item.text.slice(0,320))}</span><span class="preview-caption">${t('readText')}${icon('expand')}</span></button>`;
    else if(item.kind!=='file')body=`<p class="content-preview pending-preview">${t('availableAfter')}</p>`;
    else body=`<div class="file-body"><span>${e(item.name.split('.').pop()?.slice(0,8).toUpperCase()||'FILE')}</span><p>${formatBytes(item.size)}<span> · </span>${t('original')}</p></div>`;
    let actions='';
    if(item.state==='incoming')actions=action('cancel',t('cancel'),'close');
    else if(done&&item.kind==='file')actions=action('details',t('details'),'help')+action('download',t('download'),'download','item-button secondary');
    else if(localContent&&item.kind!=='file'){
      const url=item.kind==='link'&&item.text?safeURL(item.text):null;
      actions=(url?`<a class="item-button secondary" href="${e(url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${icon('external')}<span>${t('open')}</span></a>`:'')+action('copy',t('copy'),'copy',item.kind==='text'?'item-button secondary':'item-icon');
    }
    if(['error','cancelled','declined'].includes(item.state)&&item.direction==='sent')actions=action('retry',t('retry'),'refresh','item-button secondary');
    if(done&&typeof navigator.share==='function')actions+=action('share',t('share'),'share');
    const pct=Math.min(item.state==='complete'?100:99,Math.round(item.progress*100));
    return `<article class="item-card kind-${kind} state-${item.state}" data-item-id="${item.id}" aria-label="${e(item.name)}">
      <div class="item-top"><span class="content-icon">${icon(kind)}</span><span class="direction">${icon(item.direction==='sent'?'arrowUp':'arrowDown')}${t(item.direction==='sent'?'sent':'received')}</span>${action('remove',t('remove'),'close')}</div>
      <h3 title="${e(item.name)}"><bdi>${e(item.kind==='text'?t('note'):item.name)}</bdi></h3>${body}
      ${active?`<div class="transfer-progress"><div class="progress-label"><span>${this.status(item)}</span><strong>${pct}%</strong></div><div class="progress-track" role="progressbar" aria-label="${e(this.status(item))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:${pct}%"></span></div><div class="progress-meta"><span>${formatBytes(item.bytes)} / ${formatBytes(item.size)}</span>${item.speed>0&&['sending','receiving'].includes(item.state)?`<span>${formatBytes(item.speed)}/s</span>`:''}${action('cancel',t('cancel'),'close')}</div></div>`:''}
      ${item.error?`<p class="item-error">${e(item.error)}</p>`:''}
      <div class="item-bottom"><span class="item-status ${done?'is-complete':''}">${icon(done?'checkCircle':item.state==='error'?'alert':'clock')}<span>${this.status(item)}</span></span><div class="item-actions">${actions}</div></div>
    </article>`;
  }
  private renderNotice(): void {
    const node=document.querySelector<HTMLDivElement>('#notice');if(!node)return;
    let message='';
    if(!this.ended&&!this.starting){if(!navigator.onLine)message=this.t('offlineNotice');else if(this.session&&!this.serviceOnline)message=this.t('signalingNotice');else if(this.room.expiresAt&&this.room.expiresAt-Date.now()<90000)message=this.t('expiresSoon');}
    if(message===this.lastNotice)return;this.lastNotice=message;node.hidden=!message;node.innerHTML=message?`${icon('alert')}<span>${e(message)}</span>${message===this.t('expiresSoon')?this.button('extend',this.t('extend'),'plus','text-button'):''}`:'';
  }
  private tickClocks(): void {
    document.querySelectorAll<HTMLElement>('[data-clock="invite"]').forEach(el=>el.textContent=formatClock((this.room.inviteExpiresAt||Date.now())-Date.now()));
    document.querySelectorAll<HTMLElement>('[data-clock="session"]').forEach(el=>el.textContent=formatClock((this.room.expiresAt||Date.now())-Date.now()));
  }
  private tick(): void {
    this.tickClocks();this.renderNotice();
    if(!this.ended&&this.room.expiresAt&&Date.now()>=this.room.expiresAt){this.endLocal(true);return;}
    if(this.room.owner&&!this.room.peer&&this.room.inviteExpiresAt&&Date.now()>=this.room.inviteExpiresAt&&!this.rotating&&this.serviceOnline){void this.refreshInvite();}
  }
  private async refreshInvite(): Promise<void> {
    if(this.rotating)return;this.rotating=true;
    try{await this.client?.post('/api/invite',{});}catch(error){this.toast(errorMessage(error));}finally{setTimeout(()=>this.rotating=false,2000);}
  }
  private async join(invite?: {roomId:string;secret:string}): Promise<void> {
    if(!this.client||this.joining||this.room.peer)return;
    const code=this.joinCode.replace(/[\s-]/g,'').toUpperCase();
    if(!invite&&!/^[A-Z2-9]{8}$/.test(code)){this.joinError=this.t('codeDescription');this.renderPair();return;}
    this.joining=true;this.joinError='';this.renderPair();
    try{const result=await this.client.post<{paired:boolean;state:RoomState}>('/api/join',invite||{code});if(result.state)this.handleEvent({type:'snapshot',state:result.state});}
    catch(error){this.joinError=errorMessage(error);this.pairingTab='join';}
    finally{this.joining=false;this.renderPair();}
  }
  private toast(message: string, viewShelf?: () => void): void {
    const inline=this.dialog?.open&&!this.dialog.dataset.closing?this.dialog.querySelector<HTMLElement>('.dialog-status'):null;
    if(inline){inline.textContent=message;inline.hidden=false;return;}
    const el=document.querySelector<HTMLDivElement>('#toast')!;if(this.toastTimer)clearTimeout(this.toastTimer);
    el.innerHTML=`${icon('checkCircle')}<span>${e(message)}</span>${viewShelf?`<button type="button">${e(this.t('viewShelf'))}</button>`:''}`;el.hidden=false;
    if(viewShelf)el.querySelector('button')!.onclick=()=>{viewShelf();el.hidden=true;};
    this.toastTimer=setTimeout(()=>el.hidden=true,viewShelf?9000:4500);
  }
  private announce(message:string):void{document.querySelector('#announcer')!.textContent=message;}
  private async copy(text: string): Promise<void> {
    try{await navigator.clipboard.writeText(text);this.toast(this.t('copied'));}
    catch{const dialog=this.openDialog(this.t('copyManual'),`<p class="dialog-intro">${this.t('copyManualBody')}</p><textarea class="text-area" readonly autofocus aria-label="${e(this.t('copy'))}">${e(text)}</textarea>`);const area=dialog.querySelector<HTMLTextAreaElement>('textarea')!;area.select();}
  }
  private openDialog(title:string,body:string,classes=''):HTMLDialogElement {
    this.dialog?.close();
    const dialog=createDialog({title,body,classes,closeLabel:this.t('close'),onClose:()=>{
      if(this.dialog===dialog)this.dialog=null;void this.manageWake();
    }});
    this.dialog=dialog;return dialog;
  }
  private openText(): void {
    if(!this.engine){this.toast(this.t('contentGone'));return;}
    const t=this.t;const dialog=this.openDialog(t('textTitle'),`<p class="dialog-intro">${t('textBody')}</p><form id="text-form"><label class="field-label" for="text-content">${t('textLabel')}</label><textarea id="text-content" class="text-area" placeholder="${e(t('textPlaceholder'))}" maxlength="100000" required autofocus dir="auto"></textarea><div class="dialog-bottom"><span class="small-muted">${icon('lock')}${t('noUploads')}</span><button class="button primary" type="submit">${icon('plus')}${t('addToShelf')}</button></div></form>`);
    dialog.querySelector('form')!.addEventListener('submit',event=>{event.preventDefault();try{this.engine?.addText(dialog.querySelector<HTMLTextAreaElement>('textarea')!.value);dialog.close();this.filter='all';this.renderShelf();}catch(error){this.toast(errorMessage(error));}});
  }
  private openSettings():void {
    const t=this.t;const dialog=this.openDialog(t('settingsTitle'),`
      <form id="preferences-form">
        <div class="form-field"><label class="field-label" for="device-name">${t('deviceLabel')}</label><input id="device-name" class="text-input" maxlength="40" value="${e(this.session?.name||this.prefs.name||deviceName())}" required><p class="field-help">${t('nameHelp')}</p></div>
        <fieldset class="form-field"><legend class="field-label">${t('appearance')}</legend><div class="theme-options">${(['light','dark','system'] as const).map(theme=>`<label class="theme-option"><input type="radio" name="theme" value="${theme}" ${this.prefs.theme===theme?'checked':''}>${icon(theme==='system'?'laptop':theme==='dark'?'moon':'sun')}<span>${t(theme)}</span></label>`).join('')}</div></fieldset>
        <div class="form-field"><label class="field-label" for="language">${t('language')}</label><select id="language" class="text-input"><option value="en" ${this.prefs.language==='en'?'selected':''}>English</option><option value="ar" ${this.prefs.language==='ar'?'selected':''}>العربية</option></select></div>
        <label class="toggle-field"><span><strong>${t('sound')}</strong><small>${t('soundHelp')}</small></span><input type="checkbox" id="sound" role="switch" ${this.prefs.sound?'checked':''}></label>
        <button type="submit" class="button primary full">${t('saveSettings')}${icon('check')}</button>
      </form>`);
    dialog.querySelector('form')!.addEventListener('submit',async event=>{
      event.preventDefault();const name=dialog.querySelector<HTMLInputElement>('#device-name')!.value.trim().slice(0,40)||deviceName();
      this.prefs={name,theme:dialog.querySelector<HTMLInputElement>('input[name="theme"]:checked')!.value as Theme,language:dialog.querySelector<HTMLSelectElement>('#language')!.value as Language,sound:dialog.querySelector<HTMLInputElement>('#sound')!.checked};
      try{if(this.session&&!this.ended){const response=await this.client!.post<{name:string}>('/api/name',{name});this.session.name=response.name;}}
      catch(error){this.toast(errorMessage(error));}
      this.applyPreferences();dialog.close();this.renderFrame();this.toast(this.t('savedPrefs'));document.querySelector<HTMLButtonElement>('#settings-button')?.focus();
      if(this.prefs.sound){this.audio ||= new AudioContext();void this.audio.resume();}
    });
  }
  private openPrivacy():void {
    const t=this.t;this.openDialog(t('privacyTitle'),`<p class="dialog-intro">${t('privacyIntro')}</p><div class="privacy-features">${[1,2,3,4].map((n)=>`<section><span class="feature-icon">${icon(['lock','globe','clock','checkCircle'][n-1])}</span><div><h3>${t(`privacy${n}Title` as TranslationKey)}</h3><p>${t(`privacy${n}` as TranslationKey)}</p></div></section>`).join('')}</div>${this.room.peer?`<div class="privacy-current"><span>${t('routeLabel')}</span><strong>${t(this.security.route==='direct'?'direct':this.security.route==='relay'?'relay':'encrypted')}</strong></div>`:''}`);
  }
  private openHelp():void {
    const t=this.t;this.openDialog(t('helpTitle'),`<p class="dialog-intro">${t('helpIntro')}</p><div class="help-steps">${[1,2,3].map(n=>`<div><span class="step-number">0${n}</span><p>${t(`help${n}` as TranslationKey)}</p></div>`).join('')}</div>${desktopShortcuts()?`<div class="desktop-only"><h3 class="dialog-section-title">${t('shortcuts')}</h3><div class="shortcuts">${[['Ctrl / ⌘ + V','shortcutPaste'],['Ctrl / ⌘ + O','shortcutFiles'],['N','shortcutNote'],['J','shortcutJoin']].map(([key,label])=>`<div><span>${t(label as TranslationKey)}</span><kbd dir="ltr">${key}</kbd></div>`).join('')}</div></div>`:''}<div class="storage-info"><p><span>${t('storageHint')}</span><strong>${t(this.engine?.storage.mode==='disk'?'diskStorage':'memoryStorage')}</strong></p><p><span>${t('fileLimit')}</span><strong>${formatBytes(this.engine?.limit||128*1024*1024)}</strong></p><small>${t('helpLimits')}</small></div>${['localhost','127.0.0.1','[::1]'].includes(location.hostname)?`<p class="local-tip">${icon('help')}${t('localHint')}</p>`:''}`,'help-dialog');
  }
  private expandQR():void {
    const url=this.invitationURL();if(!url)return;const t=this.t;
    const dialog=this.openDialog(t('fullQRTitle'),`<p class="dialog-intro">${t('fullQRHint')}</p><div class="large-qr">${qrSVG(url,t('qrLabel'))}</div><strong class="large-code" dir="ltr">${e(this.room.code?.replace(/(.{4})(.{4})/,'$1 $2'))}</strong><p class="large-qr-footer">${e(location.host)}</p>`,'qr-dialog');
    dialog.dataset.wake='true';void this.manageWake();
  }
  private confirmEnd():void {
    const t=this.t;const dialog=this.openDialog(t('confirmEndTitle'),`<p class="dialog-intro">${t('confirmEndBody')}</p><div class="confirm-actions"><button class="button secondary" id="keep-session">${t('keepSession')}</button><button class="button danger" id="confirm-end">${t('endSession')}${icon('disconnect')}</button></div>`);
    dialog.querySelector('#keep-session')!.addEventListener('click',()=>dialog.close());
    dialog.querySelector('#confirm-end')!.addEventListener('click',()=>{void this.client?.post('/api/end',{}).catch(error=>{if(!this.ended)this.toast(errorMessage(error));});});
  }
  private showDetails(item:ShelfItem):void {
    const t=this.t;this.openDialog(t('details'),`<div class="details-icon">${icon(item.kind==='file'?'file':item.kind)}</div><dl class="details-list"><dt>${t('filename')}</dt><dd dir="auto">${e(item.name)}</dd><dt>${t('size')}</dt><dd>${formatBytes(item.size)}</dd><dt>${t('integrity')}</dt><dd class="digest" dir="ltr">${e(item.digest||'—')}</dd></dl><div class="verified-note">${icon('checkCircle')}${t('completeReceived')}</div>`);
  }
  private showPreview(item:ShelfItem):void {
    const t=this.t,isText=item.kind!=='file';
    const content=isText?`<div class="reader-content" tabindex="0" aria-label="${e(t('fullText'))}"><p dir="auto">${e(item.text||'')}</p></div>`:`<div class="reader-image"><img src="${e(item.url||'')}" alt="${e(item.name)}"></div>`;
    const label=isText?t('readText'):t('preview');
    const dialog=this.openDialog(label,`<div class="reader-meta"><span dir="auto">${e(isText?t(item.kind==='link'?'links':'note'):item.name)}</span><span>${formatBytes(item.size)}</span></div>${content}<div class="reader-footer"><span class="small-muted">${icon('lock')}${t('onlyHere')}</span><button type="button" class="button primary" data-reader-action>${icon(isText?'copy':'download')}${t(isText?'copy':'download')}</button></div>`,'reader-dialog');
    dialog.querySelector('[data-reader-action]')!.addEventListener('click',()=>{void this.itemAction(item.id,isText?'copy':'download');});
  }
  private async itemAction(id:string,action:string):Promise<void> {
    const item=this.engine?.items.find(i=>i.id===id);if(!item)return;
    try{
      if(action==='accept')await this.engine?.accept(id);
      else if(action==='decline')this.engine?.decline(id);
      else if(action==='cancel')await this.engine?.cancel(id);
      else if(action==='remove')await this.engine?.remove(id);
      else if(action==='retry')this.engine?.retry(id);
      else if(action==='copy'&&item.text)await this.copy(item.text);
      else if(action==='details')this.showDetails(item);
      else if(action==='preview')this.showPreview(item);
      else if(action==='download'&&item.file){
        const url=item.url||URL.createObjectURL(item.file);const link=document.createElement('a');link.href=url;link.download=safeFilename(item.name);link.rel='noopener';document.body.append(link);link.click();link.remove();if(!item.url)setTimeout(()=>URL.revokeObjectURL(url),60000);this.toast(this.t('downloadStarted'));
      }else if(action==='share'){
        if(item.kind==='file'&&item.file){const file=new File([item.file],safeFilename(item.name),{type:item.mime});if(navigator.canShare?.({files:[file]}))await navigator.share({files:[file]});else this.toast(this.t('download'));}
        else if(item.text)await navigator.share(item.kind==='link'&&safeURL(item.text)?{url:safeURL(item.text)!}:{text:item.text});
      }
    }catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))this.toast(errorMessage(error));}
  }
  private chooseFiles(folder=false):void {
    if(!this.engine){this.toast(this.t('contentGone'));return;}
    document.querySelector<HTMLInputElement>(folder?'#folder-input':'#file-input')?.click();
  }
  private async action(action:string):Promise<void> {
    try{
      switch(action){
        case 'files':this.chooseFiles();break;case 'folder':this.chooseFiles(true);break;case 'text':this.openText();break;
        case 'connection':this.openConnection();break;
        case 'settings':this.openSettings();break;case 'privacy':this.openPrivacy();break;case 'help':this.openHelp();break;
        case 'theme':this.prefs.theme=document.documentElement.dataset.theme==='dark'?'light':'dark';this.applyPreferences();this.updateThemeIcon();break;
        case 'show-code':this.pairingTab='show';this.joinError='';this.renderPair();break;
        case 'join-code':this.pairingTab='join';this.joinError='';this.renderPair();document.querySelector<HTMLInputElement>('#join-code')?.focus();break;
        case 'copy-code':if(this.room.code)await this.copy(this.room.code);break;
        case 'copy-invite':if(this.invitationURL())await this.copy(this.invitationURL()!);break;
        case 'refresh-code':await this.refreshInvite();break;case 'expand-qr':this.expandQR();break;
        case 'retry-connection':this.peer?.retry();break;
        case 'extend':await this.client?.post('/api/extend',{});break;
        case 'end':this.confirmEnd();break;case 'restart':await this.start();break;
        case 'clear':await this.engine?.clearFinished();break;
        case 'grid':case 'list':this.view=action;this.renderShelf();break;
        case 'mobile-connect':this.openConnection();break;
      }
    }catch(error){this.toast(errorMessage(error));}
  }
  private async manageWake():Promise<void> {
    const needed=!!this.engine?.active||this.dialog?.dataset.wake==='true';
    if(needed&&document.visibilityState==='visible'&&!this.wake&&!this.wakeRequest&&'wakeLock'in navigator){
      this.wakeRequest=true;try{this.wake=await navigator.wakeLock.request('screen');this.wake.addEventListener('release',()=>this.wake=null);}catch{/* Unsupported or denied: transfers still work while the screen remains active. */}finally{this.wakeRequest=false;}
    }else if(!needed&&this.wake){await this.wake.release();this.wake=null;}
  }
  private playSound():void {
    if(!this.prefs.sound)return;
    try{this.audio ||= new AudioContext();const oscillator=this.audio.createOscillator(),gain=this.audio.createGain();oscillator.connect(gain);gain.connect(this.audio.destination);oscillator.frequency.value=660;gain.gain.setValueAtTime(0.03,this.audio.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,this.audio.currentTime+0.14);oscillator.start();oscillator.stop(this.audio.currentTime+0.15);}catch{/* Audio is optional. */}
  }
  private bind():void {
    document.addEventListener('click',event=>{
      const target=(event.target as Element).closest<HTMLButtonElement>('button');if(!target)return;
      if(target.dataset.filter){this.filter=target.dataset.filter as typeof this.filter;this.renderShelf();return;}
      if(target.dataset.item&&target.dataset.itemAction){void this.itemAction(target.dataset.item,target.dataset.itemAction);return;}
      if(target.dataset.action)void this.action(target.dataset.action);
    });
    document.addEventListener('submit',event=>{if((event.target as HTMLElement).id==='join-form'){event.preventDefault();void this.join();}});
    document.addEventListener('input',event=>{if((event.target as HTMLElement).id==='join-code')this.joinCode=(event.target as HTMLInputElement).value;});
    this.root.addEventListener('change',event=>{
      const input=event.target as HTMLInputElement;if(['file-input','folder-input'].includes(input.id)&&input.files){this.engine?.addFiles([...input.files]);input.value='';this.filter='all';this.renderShelf();}
    });
    document.addEventListener('paste',event=>{
      const target=event.target as HTMLElement;if(target.closest('input,textarea,[contenteditable="true"],dialog'))return;
      const files=event.clipboardData?.files;
      try{if(files?.length){event.preventDefault();this.engine?.addFiles([...files]);}else{const text=event.clipboardData?.getData('text/plain');if(text?.trim()){event.preventDefault();this.engine?.addText(text);}}this.filter='all';this.renderShelf();}catch(error){this.toast(errorMessage(error));}
    });
    const markDrag=(active:boolean)=>{document.querySelector('#dropzone')?.classList.toggle('drag-active',active);const title=document.querySelector('#drop-title');if(title)title.textContent=this.t(active?'dropActive':'dropTitle');};
    document.addEventListener('dragenter',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();this.dragDepth++;markDrag(true);}});
    document.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files')||event.dataTransfer?.types.includes('text/plain'))event.preventDefault();});
    document.addEventListener('dragleave',event=>{if(event.dataTransfer?.types.includes('Files')&&--this.dragDepth<=0){this.dragDepth=0;markDrag(false);}});
    document.addEventListener('drop',event=>{if((event.target as HTMLElement).closest('textarea,input'))return;event.preventDefault();this.dragDepth=0;markDrag(false);try{if(event.dataTransfer?.files.length)this.engine?.addFiles([...event.dataTransfer.files]);else{const text=event.dataTransfer?.getData('text/plain');if(text)this.engine?.addText(text);}this.filter='all';this.renderShelf();}catch(error){this.toast(errorMessage(error));}});
    document.addEventListener('keydown',event=>{
      if((event.target as HTMLElement).closest('input,textarea,select,[contenteditable="true"],dialog'))return;
      if((event.metaKey||event.ctrlKey)&&event.key.toLowerCase()==='o'){event.preventDefault();this.chooseFiles();}
      else if(!event.metaKey&&!event.ctrlKey&&!event.altKey){if(event.key.toLowerCase()==='n'){event.preventDefault();this.openText();}else if(event.key.toLowerCase()==='j'){event.preventDefault();this.openConnection();if(!this.room.peer)void this.action('join-code');}}
    });
    window.addEventListener('online',()=>{this.renderNotice();this.peer?.online();});window.addEventListener('offline',()=>this.renderNotice());
    document.addEventListener('visibilitychange',()=>{void this.manageWake();if(document.visibilityState==='visible')this.peer?.online();});
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change',()=>{if(this.prefs.theme==='system'){this.applyPreferences();this.updateThemeIcon();}});
    window.addEventListener('beforeunload',event=>{if(this.engine?.items.some(i=>!['complete','cancelled','declined','error'].includes(i.state))){event.preventDefault();event.returnValue='';}});
    window.addEventListener('pagehide',()=>{this.client?.close();this.peer?.close();void this.engine?.destroy();});
  }
}
new ShelfApp();
