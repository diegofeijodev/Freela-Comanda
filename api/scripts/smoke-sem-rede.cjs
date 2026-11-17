// Barreira de rede SÓ do smoke: carregado com `--require` (NODE_OPTIONS) no processo da API que o smoke-capped.sh sobe.
// Recusa, ANTES de qualquer DNS ou socket, toda conexão TCP/TLS (net.connect, tls.connect e, por consequência, https.request)
// cujo host não seja local. Livres: localhost, 127.0.0.1, ::1 e sockets unix (`path`). Nada daqui entra na API de produção.
'use strict';
const net = require('node:net');

const LOCAIS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function hostDe(args) {
  let a = args[0];
  if (Array.isArray(a)) a = a[0]; // net.connect passa [opções, callback] já normalizado
  if (a !== null && typeof a === 'object') {
    if (a.path) return null; // socket unix
    return a.host === undefined || a.host === null ? 'localhost' : String(a.host);
  }
  if (typeof a === 'string') return null; // connect(path)
  // connect(port, host?, cb?)
  return typeof args[1] === 'string' ? args[1] : 'localhost';
}

const original = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  const host = hostDe(args);
  if (host !== null && !LOCAIS.has(host.toLowerCase())) {
    process.stderr.write(`smoke-sem-rede: conexão recusada para ${host}\n`);
    const e = new Error(`smoke-sem-rede: conexão recusada para ${host}`);
    e.code = 'ESMOKESEMREDE';
    throw e;
  }
  return original.apply(this, args);
};
