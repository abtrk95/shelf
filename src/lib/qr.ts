/** QR Model 2, byte mode, error correction L, versions 1–10.
 * Self-contained: invitations never go to a QR-code image service.
 * Reed–Solomon over GF(256), primitive polynomial x^8+x^4+x^3+x^2+1.
 */
const BLOCKS: number[][] = [
 [1,26,19],[1,44,34],[1,70,55],[1,100,80],[1,134,108],
 [2,86,68],[2,98,78],[2,121,97],[2,146,116],[2,86,68,2,87,69],
];
const ALIGN = [[],[6,18],[6,22],[6,26],[6,30],[6,34],[6,22,38],[6,24,42],[6,26,46],[6,28,50]];
function multiply(x: number, y: number): number {
  let z = 0; for (let i = 7; i >= 0; i--) { z = (z << 1) ^ ((z >>> 7) * 0x11d); z ^= ((y >>> i) & 1) * x; } return z;
}
function parity(data: number[], count: number): number[] {
  let generator = [1]; let root = 1;
  for (let i = 0; i < count; i++) {
    const next = Array(generator.length + 1).fill(0);
    generator.forEach((v,j) => { next[j] ^= v; next[j+1] ^= multiply(v,root); });
    generator = next; root = multiply(root,2);
  }
  const buffer = [...data, ...Array(count).fill(0)];
  for (let i = 0; i < data.length; i++) { const factor = buffer[i]; for (let j = 0; j < generator.length; j++) buffer[i+j] ^= multiply(generator[j],factor); }
  return buffer.slice(data.length);
}
function maskAt(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x+y)%2===0; case 1: return y%2===0; case 2: return x%3===0;
    case 3: return (x+y)%3===0; case 4: return (Math.floor(y/2)+Math.floor(x/3))%2===0;
    case 5: return (x*y)%2+(x*y)%3===0; case 6: return ((x*y)%2+(x*y)%3)%2===0;
    default: return ((x+y)%2+(x*y)%3)%2===0;
  }
}
function penalty(matrix: boolean[][]): number {
  const n = matrix.length; let score = 0; let dark = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    if (matrix[y][x]) dark++;
    if (y && x && matrix[y][x] === matrix[y-1][x] && matrix[y][x] === matrix[y][x-1] && matrix[y][x] === matrix[y-1][x-1]) score += 3;
  }
  for (let direction = 0; direction < 2; direction++) for (let a = 0; a < n; a++) {
    let run = 0; let last = false; let line = '';
    for (let b = 0; b < n; b++) {
      const bit = direction ? matrix[b][a] : matrix[a][b]; line += bit ? '1' : '0';
      if (b && bit === last) { run++; if (run === 5) score += 3; else if (run > 5) score++; } else run = 1;
      last = bit;
    }
    for (let i = 0; i <= n-11; i++) if (['10111010000','00001011101'].includes(line.slice(i,i+11))) score += 40;
  }
  return score + Math.floor(Math.abs(dark*100/(n*n)-50)/5)*10;
}
export function qrMatrix(text: string, fixedMask?: number): boolean[][] {
  const bytes = new TextEncoder().encode(text); let version = 1; let capacity = 0;
  for (; version <= 10; version++) {
    const spec = BLOCKS[version-1]; capacity = 0;
    for (let i = 0; i < spec.length; i += 3) capacity += spec[i]*spec[i+2];
    if (4+(version<10?8:16)+bytes.length*8 <= capacity*8) break;
  }
  if (version > 10) throw new Error('This invitation URL is too long for the QR code. Use the pairing code instead.');
  const bits: number[] = [];
  const append = (value: number, length: number) => { for (let i=length-1;i>=0;i--) bits.push((value>>>i)&1); };
  append(4,4); append(bytes.length,version<10?8:16); bytes.forEach(b=>append(b,8));
  append(0,Math.min(4,capacity*8-bits.length)); while(bits.length%8) bits.push(0);
  const data: number[] = []; for(let i=0;i<bits.length;i+=8) data.push(bits.slice(i,i+8).reduce((a,b)=>(a<<1)|b,0));
  for(let pad=0;data.length<capacity;pad++) data.push(pad%2?0x11:0xec);
  const blocks: number[][] = []; const ecc: number[][] = []; const spec = BLOCKS[version-1]; let offset=0;
  for(let i=0;i<spec.length;i+=3) for(let j=0;j<spec[i];j++) { const block=data.slice(offset,offset+spec[i+2]);offset+=block.length;blocks.push(block);ecc.push(parity(block,spec[i+1]-spec[i+2])); }
  const words: number[] = [];
  for(let i=0;i<Math.max(...blocks.map(b=>b.length));i++) for(const block of blocks) if(i<block.length) words.push(block[i]);
  for(let i=0;i<ecc[0].length;i++) for(const block of ecc) words.push(block[i]);
  const size=version*4+17; let best: boolean[][]=[]; let bestScore=Infinity;
  for(const mask of fixedMask === undefined ? [0,1,2,3,4,5,6,7] : [fixedMask]) {
    const m = Array.from({length:size},()=>Array<boolean>(size).fill(false));
    const reserved = Array.from({length:size},()=>Array<boolean>(size).fill(false));
    const set=(x:number,y:number,value:boolean)=>{if(x>=0&&x<size&&y>=0&&y<size){m[y][x]=value;reserved[y][x]=true;}};
    for(const [cx,cy] of [[3,3],[size-4,3],[3,size-4]]) for(let dy=-4;dy<=4;dy++) for(let dx=-4;dx<=4;dx++){const d=Math.max(Math.abs(dx),Math.abs(dy));set(cx+dx,cy+dy,d!==2&&d!==4);}
    for(let i=8;i<size-8;i++){set(6,i,i%2===0);set(i,6,i%2===0);}
    const positions=ALIGN[version-1];
    for(let a=0;a<positions.length;a++) for(let b=0;b<positions.length;b++){
      if((a===0&&b===0)||(a===0&&b===positions.length-1)||(a===positions.length-1&&b===0))continue;
      for(let dy=-2;dy<=2;dy++)for(let dx=-2;dx<=2;dx++)set(positions[a]+dx,positions[b]+dy,Math.max(Math.abs(dx),Math.abs(dy))!==1);
    }
    let remainder = (1<<3)|mask; const formatData=remainder;
    for(let i=0;i<10;i++) remainder=(remainder<<1)^((remainder>>>9)*0x537);
    const format=((formatData<<10)|remainder)^0x5412; const bit=(i:number)=>((format>>>i)&1)!==0;
    for(let i=0;i<=5;i++)set(8,i,bit(i));set(8,7,bit(6));set(8,8,bit(7));set(7,8,bit(8));
    for(let i=9;i<15;i++)set(14-i,8,bit(i));for(let i=0;i<8;i++)set(size-1-i,8,bit(i));for(let i=8;i<15;i++)set(8,size-15+i,bit(i));set(8,size-8,true);
    if(version>=7){let r=version;for(let i=0;i<12;i++)r=(r<<1)^((r>>>11)*0x1f25);const v=(version<<12)|r;for(let i=0;i<18;i++){const a=size-11+i%3,b=Math.floor(i/3),d=((v>>>i)&1)!==0;set(a,b,d);set(b,a,d);}}
    let index=0;let upward=true;
    for(let right=size-1;right>=1;right-=2){if(right===6)right=5;for(let v=0;v<size;v++){const y=upward?size-1-v:v;for(let j=0;j<2;j++){const x=right-j;if(!reserved[y][x]){const raw=index<words.length*8?((words[index>>>3]>>>(7-(index&7)))&1)!==0:false;m[y][x]=raw!==maskAt(mask,x,y);index++;}}}upward=!upward;}
    const score=penalty(m);if(score<bestScore){best=m;bestScore=score;}
  }
  return best;
}
export function qrSVG(text: string, label: string): string {
  const m=qrMatrix(text), size=m.length+8; let path='';
  m.forEach((row,y)=>row.forEach((dark,x)=>{if(dark)path+=`M${x+4},${y+4}h1v1h-1z`;}));
  const safeLabel=label.replace(/[&<>"']/g,'');
  return `<svg viewBox="0 0 ${size} ${size}" role="img" aria-label="${safeLabel}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path d="${path}" fill="#263c2d"/></svg>`;
}
