from pathlib import Path
root=Path('.')
def edit(path,old,new,count=1):
 p=root/path;s=p.read_text();n=s.count(old)
 assert n==count,(path,n,old[:90]);p.write_text(s.replace(old,new))
p=root/'server/index.mjs';s=p.read_text()
s=s.replace('const requests = new Map(); ', '')
s=s.replace("    const pending = [...requests.values()].find(r => r.roomId === room.id);\n",'')
s=s.replace("      ...(pending && room.owner === client.id ? { pending: { id: pending.id, name: ids.get(pending.guestId)?.name || 'Another browser', expiresAt: pending.expiresAt } } : {}),\n",'')
a=s.index('  function rejectRequest(');b=s.index('  function endRoom(',a);s=s[:a]+s[b:]
s=s.replace("    for (const request of [...requests.values()]) if (request.roomId === room.id) rejectRequest(request, 'That session has ended.');\n",'')
a=s.index("        if (path === '/api/join') {");b=s.index("        if (path === '/api/signal') {",a)
s=s[:a]+'''        if (path === '/api/join') {
          rate(`join:${ip}`, 8); rate(`join-session:${client.id}`, 8);
          if (other(client)) fail(409, 'End your current connection before joining another.');
          let room;
          if (typeof input.code === 'string') room = rooms.get(codes.get(normalizeCode(input.code)));
          else if (typeof input.roomId === 'string' && typeof input.secret === 'string') {
            const candidate = rooms.get(input.roomId);
            if (candidate && equalSecret(candidate.secret, input.secret)) room = candidate;
          }
          if (!room || room.inviteExpiresAt <= config.now() || room.expiresAt <= config.now() || room.guest) fail(404, 'That code is unavailable. Ask the other device for a new one.', 'invalid_code');
          if (room.owner === client.id) fail(400, 'Open Shelf on your other device and enter this code there.');
          const owner = ids.get(room.owner);
          if (!owner?.stream || owner.expiresAt <= config.now()) fail(409, 'The other device is offline. Keep Shelf open on both devices.');
          // Possession of the expiring invitation authorizes this two-device connection.
          // No awaits in this section: two simultaneous joins cannot claim the same room.
          const previousRoom = rooms.get(client.roomId);
          if (previousRoom) { codes.delete(previousRoom.code); rooms.delete(previousRoom.id); }
          client.roomId = room.id; room.guest = client.id;
          room.expiresAt = Math.min(config.now() + config.sessionTTL, owner.createdAt + 7200000, client.createdAt + 7200000);
          owner.expiresAt = client.expiresAt = room.expiresAt;
          codes.delete(room.code); room.secret = undefined; room.code = undefined;
          snapshot(owner); snapshot(client);
          return json(res, { paired: true, state: roomState(client) });
        }
''' + s[b:]
s=s.replace("          if ([...requests.values()].some(r => r.roomId === room.id)) fail(409, 'Resolve the connection request before refreshing your code.');\n",'')
s=s.replace("    for (const request of [...requests.values()]) if (request.expiresAt <= now) rejectRequest(request, 'The connection request timed out. Please try again.');\n",'')
assert 'requests.' not in s
p.write_text(s)
edit('src/lib/transfer.ts','private completed: () => void','private completed: (item: ShelfItem) => void')
edit('src/lib/transfer.ts','A hostile approved peer','A hostile paired peer')
edit('src/lib/transfer.ts','const value = text.trim(); if (!value) return;', 'if (!text.trim()) return; const value = text;')
edit('src/lib/transfer.ts',"      this.incoming.set(item.id,incoming);this.items.unshift(item);this.notice('An item is ready to receive.');this.notify(true);return;",'''      // Automatic receiving is scoped to the one paired data channel. Keep all
      // protocol, item-count, size, queue, and storage checks before accepting bytes.
      if (this.outgoing.has(item.id)) throw new Error('The transfer identifier is already in use.');
      const reserved = this.items.filter(i => i.direction === 'received' && !['error','cancelled','declined'].includes(i.state)).reduce((sum, i) => sum + i.size, 0);
      if (reserved + item.size > this.storage.maxFileBytes) {
        this.send({type:'error',id:item.id,message:'The receiving shelf is full. Remove received items to free temporary storage.'}); return;
      }
      this.incoming.set(item.id,incoming);this.items.unshift(item);
      await this.accept(item.id);return;''')
edit('src/lib/transfer.ts','this.notify(true);this.completed();','this.notify(true);this.completed(incoming.item);')
edit('src/lib/transfer.ts',"outgoing.item.state='complete';this.completed();", "outgoing.item.state='complete';this.completed(outgoing.item);")
(root/'scripts/build.mjs').write_text('''import { cp, mkdir, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
const compiler = 'node_modules/typescript/bin/tsc';
if (!existsSync(compiler)) {
  console.error('Build tools are missing. Run npm ci --include=dev, then npm run build.');
  process.exit(1);
}
await rm('dist', { recursive: true, force: true });
await mkdir('dist', { recursive: true });
await cp('public', 'dist', { recursive: true });
const result = spawnSync(process.execPath, [compiler], { stdio: 'inherit' });
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
''')
(root/'.npmrc').write_text('include=dev\n')
print('Server, automatic receive, and build changes applied.')
