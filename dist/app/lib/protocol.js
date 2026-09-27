export const HEADER_BYTES = 24;
export const FRAME_BYTES = 16384;
export const CHUNK_BYTES = FRAME_BYTES - HEADER_BYTES;
export const WINDOW_BYTES = 262144;
export const MAX_TEXT_BYTES = 131072;
export const MAX_ITEMS = 64;
export const UUID_PATTERN = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function makeFrame(id, offset, bytes) {
    if (!UUID_PATTERN.test(id) || !Number.isSafeInteger(offset) || offset < 0 || bytes.byteLength > CHUNK_BYTES)
        throw new Error('Invalid transfer frame.');
    const buffer = new ArrayBuffer(HEADER_BYTES + bytes.length);
    const frame = new Uint8Array(buffer);
    const compact = id.replaceAll('-', '');
    for (let i = 0; i < 16; i++)
        frame[i] = parseInt(compact.slice(i * 2, i * 2 + 2), 16);
    new DataView(buffer).setBigUint64(16, BigInt(offset));
    frame.set(bytes, HEADER_BYTES);
    return buffer;
}
export function readFrame(buffer) {
    if (buffer.byteLength < HEADER_BYTES || buffer.byteLength > FRAME_BYTES)
        throw new Error('Invalid frame size.');
    const raw = Array.from(new Uint8Array(buffer, 0, 16), n => n.toString(16).padStart(2, '0')).join('');
    const id = `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
    const offset = Number(new DataView(buffer).getBigUint64(16));
    if (!Number.isSafeInteger(offset))
        throw new Error('Invalid transfer offset.');
    return { id, offset, bytes: new Uint8Array(buffer, HEADER_BYTES) };
}
export function parseControl(raw, maxBytes) {
    if (raw.length > 8192)
        throw new Error('Control message is too large.');
    const m = JSON.parse(raw);
    if (!m || typeof m !== 'object' || !('id' in m) || typeof m.id !== 'string' || !UUID_PATTERN.test(m.id) || !('type' in m))
        throw new Error('Invalid transfer message.');
    const value = m;
    switch (value.type) {
        case 'offer':
            if (typeof value.name !== 'string' || value.name.length > 256 || typeof value.mime !== 'string' || value.mime.length > 120 || !['file', 'text', 'link'].includes(String(value.kind)) || !Number.isSafeInteger(value.size) || Number(value.size) < 0 || Number(value.size) > maxBytes || (value.kind !== 'file' && Number(value.size) > MAX_TEXT_BYTES))
                throw new Error('Invalid or unsupported transfer offer.');
            break;
        case 'accept':
        case 'ack':
            if (!Number.isSafeInteger(value.offset) || Number(value.offset) < 0)
                throw new Error('Invalid acknowledgement.');
            break;
        case 'finish':
        case 'complete':
            if (typeof value.digest !== 'string' || !/^[0-9a-f]{64}$/.test(value.digest))
                throw new Error('Invalid integrity check.');
            break;
        case 'decline':
        case 'cancel': break;
        case 'error':
            if (typeof value.message !== 'string' || value.message.length > 200)
                throw new Error('Invalid error message.');
            break;
        default: throw new Error('Unknown transfer message.');
    }
    return value;
}
