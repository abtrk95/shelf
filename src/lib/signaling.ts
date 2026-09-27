import type { Session, ServerEvent, Signal } from './types.js';
import { sleep } from './utils.js';
export class SignalingClient {
  session: Session | null = null;
  online = false;
  private controller = new AbortController();
  private lastSequence = 0;
  private stopped = false;
  private signalQueue: Promise<unknown> = Promise.resolve();
  constructor(private onEvent: (event: ServerEvent) => void, private onNetwork: (online: boolean) => void) {}
  async start(name: string): Promise<Session> {
    this.session = await this.post<Session>('/api/session', { name });
    void this.stream(); return this.session;
  }
  async post<T = { ok: boolean }>(path: string, payload: object): Promise<T> {
    const response = await fetch(path, {
      method: 'POST', headers: { 'Content-Type':'application/json', ...(this.session ? { Authorization:`Bearer ${this.session.token}` } : {}) },
      body: JSON.stringify(payload), signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(15000)]), cache: 'no-store', credentials: 'omit',
    });
    const data = await response.json();
    if(!response.ok)throw new Error(data.error || 'The request could not be completed.');
    return data as T;
  }
  signal(signal: Signal): Promise<unknown> {
    // Serialize HTTP signaling to avoid racing an offer with its own ICE candidates.
    const next=this.signalQueue.catch(()=>undefined).then(()=>this.post('/api/signal',{signal}));
    this.signalQueue=next;return next;
  }
  private async stream(): Promise<void> {
    let retry=0;
    while(!this.stopped && this.session){
      try{
        const response=await fetch('/api/events',{headers:{Authorization:`Bearer ${this.session.token}`,'Last-Event-ID':String(this.lastSequence)},signal:this.controller.signal,cache:'no-store',credentials:'omit'});
        if(response.status===401){this.onEvent({type:'ended',reason:'expired'});return;}
        if(!response.ok||!response.body)throw new Error('Connection unavailable.');
        this.online=true;this.onNetwork(true);retry=0;
        const reader=response.body.getReader();const decoder=new TextDecoder();let pending='';
        try{
          while(!this.stopped){
            const {value,done}=await reader.read();if(done)break;pending+=decoder.decode(value,{stream:true});
            if(pending.length>262144)throw new Error('Invalid server stream.');
            let boundary;
            while((boundary=pending.indexOf('\n\n'))>=0){
              const frame=pending.slice(0,boundary);pending=pending.slice(boundary+2);
              const line=frame.split('\n').find(x=>x.startsWith('data: '));if(!line)continue;
              const event=JSON.parse(line.slice(6)) as ServerEvent;
              if(event.seq && event.seq<=this.lastSequence)continue;
              this.lastSequence=event.seq || this.lastSequence;this.onEvent(event);
            }
          }
        }finally{reader.releaseLock();}
      }catch(error){if(this.stopped || this.controller.signal.aborted)return;}
      if(this.stopped)return;
      this.online=false;this.onNetwork(false);
      await sleep(Math.min(15000,800*2**retry++)+Math.random()*200);
    }
  }
  close(): void { this.stopped=true;this.controller.abort();this.online=false; }
}
