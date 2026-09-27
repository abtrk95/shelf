import type { ConnectionState, SecurityState, ServerConfig, Signal } from './types.js';
export interface PeerHooks { state: (state: ConnectionState) => void; channel: (channel: RTCDataChannel | null) => void; security: (security: SecurityState) => void; }
export class PeerTransport {
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private connectionId = '';
  private peerId = '';
  private initiator = false;
  private pending = new Map<string, RTCIceCandidateInit[]>();
  private queue: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private closed = false;
  state: ConnectionState = 'idle';
  constructor(private config: ServerConfig, private send: (signal: Signal) => Promise<unknown>, private hooks: PeerHooks) {}
  private setState(state: ConnectionState): void {this.state=state;this.hooks.state(state);}
  connect(peerId: string, initiator: boolean): void {
    if(this.peerId===peerId && this.pc)return;
    this.peerId=peerId;this.initiator=initiator;this.closed=false;this.attempts=0;
    this.setState('connecting');
    if(initiator)void this.offer().catch(()=>this.scheduleRetry());
  }
  handle(signal: Signal): void {
    this.queue=this.queue.then(async()=>{
      if(this.closed)return;
      if(signal.type==='restart'){if(this.initiator && this.state!=='connected')await this.offer();return;}
      if(signal.type==='offer'){
        if(this.initiator)return;
        if(signal.connectionId===this.connectionId && this.pc?.remoteDescription)return;
        const pc=this.create(signal.connectionId);await pc.setRemoteDescription({type:'offer',sdp:signal.sdp!});
        await this.flushCandidates(pc,signal.connectionId);await pc.setLocalDescription(await pc.createAnswer());
        await this.send({type:'answer',sdp:pc.localDescription!.sdp,connectionId:this.connectionId});return;
      }
      if(signal.type==='answer'){
        if(!this.initiator||signal.connectionId!==this.connectionId||!this.pc||this.pc.signalingState!=='have-local-offer')return;
        await this.pc.setRemoteDescription({type:'answer',sdp:signal.sdp!});await this.flushCandidates(this.pc,this.connectionId);return;
      }
      if(signal.type==='candidate' && signal.candidate){
        if(signal.connectionId===this.connectionId && this.pc?.remoteDescription)await this.pc.addIceCandidate(signal.candidate);
        else{
          if(this.pending.size>4)this.pending.clear();const candidates=this.pending.get(signal.connectionId)||[];
          if(candidates.length<64)candidates.push(signal.candidate);this.pending.set(signal.connectionId,candidates);
        }
      }
    }).catch(()=>this.scheduleRetry());
  }
  private async flushCandidates(pc: RTCPeerConnection,id: string): Promise<void> {
    for(const candidate of this.pending.get(id)||[])await pc.addIceCandidate(candidate);this.pending.delete(id);
  }
  private create(id: string): RTCPeerConnection {
    this.detach();this.connectionId=id;
    const pc=new RTCPeerConnection({iceServers:this.config.iceServers,iceTransportPolicy:this.config.iceTransportPolicy});this.pc=pc;
    pc.onicecandidate=event=>{if(event.candidate && this.pc===pc)void this.send({type:'candidate',connectionId:id,candidate:event.candidate.toJSON()}).catch(()=>undefined);};
    pc.ondatachannel=event=>{if(this.pc===pc&&event.channel.label==='shelf-v1')this.adopt(pc,event.channel);else event.channel.close();};
    pc.onconnectionstatechange=()=>{
      if(this.pc!==pc)return;
      if(pc.connectionState==='failed')this.scheduleRetry();
      else if(pc.connectionState==='disconnected'){this.setState('reconnecting');this.scheduleRetry(4500);}
      else if(pc.connectionState==='connected' && this.channel?.readyState==='open'){this.clearTimer();this.attempts=0;this.setState('connected');void this.inspect(pc).catch(()=>undefined);}
    };
    this.timer=setTimeout(()=>{if(this.pc===pc && this.state!=='connected')this.scheduleRetry();},16000);
    return pc;
  }
  private async offer(): Promise<void> {
    if(this.closed)return;
    this.setState(this.attempts?'reconnecting':'connecting');
    const id=crypto.randomUUID();const pc=this.create(id);this.adopt(pc,pc.createDataChannel('shelf-v1',{ordered:true}));
    await pc.setLocalDescription(await pc.createOffer());
    if(this.pc===pc)await this.send({type:'offer',connectionId:id,sdp:pc.localDescription!.sdp});
  }
  private adopt(pc: RTCPeerConnection,channel: RTCDataChannel): void {
    if(this.channel && this.channel!==channel){channel.close();return;}
    this.channel=channel;channel.binaryType='arraybuffer';
    channel.onopen=()=>{if(this.pc!==pc)return;this.clearTimer();this.attempts=0;this.setState('connected');this.hooks.channel(channel);void this.inspect(pc).catch(()=>undefined);};
    channel.onclose=()=>{if(this.pc!==pc)return;this.hooks.channel(null);this.scheduleRetry();};
    channel.onerror=()=>{if(this.pc===pc)this.scheduleRetry();};
  }
  private async inspect(pc: RTCPeerConnection): Promise<void> {
    const fingerprints=[pc.localDescription?.sdp,pc.remoteDescription?.sdp].map(s=>s?.match(/a=fingerprint:sha-256 ([^\r\n]+)/i)?.[1]||'').sort();
    let safetyCode='';
    if(fingerprints.every(Boolean)){
      const hash=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(`shelf-v1:${fingerprints.join('|')}`));
      const code=Array.from(new Uint8Array(hash).slice(0,4),n=>n.toString(16).padStart(2,'0')).join('').toUpperCase();safetyCode=`${code.slice(0,4)} ${code.slice(4)}`;
    }
    let route:SecurityState['route']='encrypted';
    const stats=await pc.getStats();let pair:RTCStats|undefined;
    stats.forEach(report=>{if(report.type==='transport'&&report.selectedCandidatePairId)pair=stats.get(report.selectedCandidatePairId);});
    if(!pair)stats.forEach(report=>{if(report.type==='candidate-pair'&&report.nominated&&report.state==='succeeded')pair=report;});
    if(pair){const p=pair as RTCStats&{localCandidateId:string;remoteCandidateId:string};const local=stats.get(p.localCandidateId),remote=stats.get(p.remoteCandidateId);route=local?.candidateType==='relay'||remote?.candidateType==='relay'?'relay':'direct';}
    if(this.pc===pc)this.hooks.security({route,safetyCode});
  }
  private scheduleRetry(delay=1500): void {
    if(this.closed)return;this.clearTimer();
    if(this.attempts>=3){this.setState('blocked');return;}
    this.setState('reconnecting');
    this.timer=setTimeout(()=>{this.attempts++;if(this.initiator)void this.offer().catch(()=>this.scheduleRetry());else void this.send({type:'restart',connectionId:this.connectionId||crypto.randomUUID()}).catch(()=>this.scheduleRetry());},delay);
  }
  retry(): void {this.attempts=0;this.scheduleRetry(0);}
  online(): void {if(!this.closed&&this.peerId&&this.state!=='connected')this.scheduleRetry(500);}
  private clearTimer(): void {if(this.timer)clearTimeout(this.timer);this.timer=null;}
  private detach(): void {
    this.clearTimer();const old=this.pc;this.pc=null;this.hooks.channel(null);
    if(this.channel){this.channel.onopen=null;this.channel.onclose=null;this.channel.onerror=null;this.channel.close();this.channel=null;}old?.close();
  }
  close(): void {this.closed=true;this.detach();this.pending.clear();this.peerId='';this.setState('idle');}
}
