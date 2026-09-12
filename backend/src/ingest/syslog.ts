import dgram from 'node:dgram';
import net from 'node:net';
import { config } from '../config.js';
import { normalize } from '../normalize/index.js';
import { batcher } from '../pipeline/batcher.js';
import { recordDrop } from '../pipeline/writer.js';
import { resolveByIp } from './collectors.js';

const MAX_MESSAGE_BYTES = 64 * 1024;

function normalizeAddress(addr: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(addr);
  return m ? m[1]! : addr;
}

async function handleLine(line: string, peerIp: string, transport: 'udp' | 'tcp') {
  const raw = line.replace(/\0+$/, '').trim();
  if (!raw) return;

  const collector = await resolveByIp(peerIp);
  if (!collector) {
    await recordDrop(null, `syslog/${transport}`, 'no collector matches sender', peerIp, raw);
    return;
  }

  const event = normalize(collector.sourceType, {
    raw,
    receivedAt: new Date(),
    peerIp,
  });

  batcher.add(collector.tenantId, collector.collectorId, event);
}

export function startSyslogUdp(): dgram.Socket {
  const socket = dgram.createSocket({ type: 'udp6', ipv6Only: false, reuseAddr: true });

  socket.on('message', (msg, rinfo) => {
    if (msg.length > MAX_MESSAGE_BYTES) return;
    const peer = normalizeAddress(rinfo.address);
    void handleLine(msg.toString('utf8'), peer, 'udp').catch((err) =>
      console.error('[syslog/udp] handler failed', err),
    );
  });

  socket.on('error', (err) => console.error('[syslog/udp] socket error', err));

  socket.bind(config.syslog.udpPort, () => {
    console.log(`[syslog/udp] listening on :${config.syslog.udpPort}`);
  });

  return socket;
}

export function startSyslogTcp(): net.Server {
  const server = net.createServer((socket) => {
    const peer = normalizeAddress(socket.remoteAddress ?? '');
    let buffer = '';

    socket.setEncoding('utf8');
    socket.setTimeout(120_000, () => socket.destroy());

    socket.on('data', (chunk: string) => {
      buffer += chunk;

      if (buffer.length > MAX_MESSAGE_BYTES * 4) {
        void recordDrop(null, 'syslog/tcp', 'unframed data exceeded buffer', peer, null);
        buffer = '';
        socket.destroy();
        return;
      }

      for (;;) {
        const counted = /^(\d{1,6}) /.exec(buffer);
        if (counted) {
          const length = Number(counted[1]);
          const start = counted[0].length;
          if (buffer.length < start + length) break;
          const message = buffer.slice(start, start + length);
          buffer = buffer.slice(start + length);
          void handleLine(message, peer, 'tcp').catch((err) =>
            console.error('[syslog/tcp] handler failed', err),
          );
          continue;
        }

        const nl = buffer.indexOf('\n');
        if (nl === -1) break;
        const message = buffer.slice(0, nl);
        buffer = buffer.slice(nl + 1);
        void handleLine(message, peer, 'tcp').catch((err) =>
          console.error('[syslog/tcp] handler failed', err),
        );
      }
    });

    socket.on('end', () => {
      if (buffer.trim()) {
        void handleLine(buffer, peer, 'tcp').catch(() => undefined);
      }
    });

    socket.on('error', () => socket.destroy());
  });

  server.on('error', (err) => console.error('[syslog/tcp] server error', err));

  server.listen(config.syslog.tcpPort, () => {
    console.log(`[syslog/tcp] listening on :${config.syslog.tcpPort}`);
  });

  return server;
}
