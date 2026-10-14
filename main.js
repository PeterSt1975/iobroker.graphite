'use strict';
const utils = require('@iobroker/adapter-core');
const net = require('node:net');

class GraphiteAdapter {
  constructor() {
    this.adapter = utils.adapter({
      name: 'graphite',
      ready: () => this.onReady(),
      stateChange: (id, state) => this.onStateChange(id, state),
      objectChange: (id, obj) => this.onObjectChange(id, obj),
      unload: callback => this.onUnload(callback)
    });
    this.socket = null;
    this.connected = false;
    this.connecting = false;
    this.stopping = false;
    this.reconnectTimer = null;
    this.settings = new Map();
    this.timers = new Map();
    this.queue = [];
  }

  async onReady() {
    this.cfg = Object.assign({
      host: '127.0.0.1', port: 2003, prefix: 'iobroker',
      defaultMode: 'change', defaultIntervalMinutes: 5,
      connectTimeoutMs: 5000, reconnectDelayMs: 5000,
      sendInitialValues: true, replaceDots: true, includeAckFalse: false
    }, this.adapter.config || {});
    this.cfg.prefix = this.clean(this.cfg.prefix || '');
    this.adapter.subscribeForeignStates('*');
    this.adapter.subscribeForeignObjects('*');
    await this.connect();
    await this.loadSettings();
    if (this.cfg.sendInitialValues) await this.sendInitial();
    this.adapter.log.info(`Graphite logger started: ${this.cfg.host}:${this.cfg.port}`);
  }

  clean(value) {
    return String(value || '').trim().replace(/[^A-Za-z0-9_.-]/g, '_')
      .replace(/\.{2,}/g, '.').replace(/^\.|\.$/g, '');
  }

  getSettings(obj) {
    const custom = obj && obj.common && obj.common.custom &&
      obj.common.custom[this.adapter.namespace];
    if (!custom || custom.enabled !== true) return null;
    return {
      mode: custom.mode === 'interval' ? 'interval' : 'change',
      intervalMinutes: Math.max(1, Number(custom.intervalMinutes || this.cfg.defaultIntervalMinutes || 5)),
      metricPath: custom.metricPath ? this.clean(custom.metricPath) : '',
      booleanMode: custom.booleanMode === '0100' ? '0100' : '01'
    };
  }

  async loadSettings() {
    const objects = await this.adapter.getForeignObjectsAsync('*');
    for (const [id, obj] of Object.entries(objects || {})) {
      if (obj && obj.type === 'state') this.updateObject(id, obj);
    }
  }

  onObjectChange(id, obj) {
    if (!id) return;
    this.removeObject(id);
    if (obj && obj.type === 'state') this.updateObject(id, obj);
  }

  updateObject(id, obj) {
    const s = this.getSettings(obj);
    if (!s) return;
    this.settings.set(id, s);
    if (s.mode === 'interval') {
      const timer = setInterval(() => {
        this.adapter.getForeignState(id, (err, state) => {
          if (err) return this.adapter.log.debug(`Read failed for ${id}: ${err}`);
          if (state) this.sendState(id, state, s);
        });
      }, s.intervalMinutes * 60 * 1000);
      this.timers.set(id, timer);
    }
  }

  removeObject(id) {
    this.settings.delete(id);
    if (this.timers.has(id)) clearInterval(this.timers.get(id));
    this.timers.delete(id);
  }

  async sendInitial() {
    for (const [id, s] of this.settings.entries()) {
      await new Promise(resolve => this.adapter.getForeignState(id, (err, state) => {
        if (!err && state) this.sendState(id, state, s);
        resolve();
      }));
    }
  }

  onStateChange(id, state) {
    if (!state || (!this.cfg.includeAckFalse && state.ack === false)) return;
    const s = this.settings.get(id);
    if (s && s.mode === 'change') this.sendState(id, state, s);
  }

  sendState(id, state, s) {
    if (!state || state.val === null || state.val === undefined) return;
    if (!this.cfg.includeAckFalse && state.ack === false) return;
    let value = state.val;
    if (typeof value === 'boolean') value = s.booleanMode === '0100' ? (value ? 100 : 0) : (value ? 1 : 0);
    else if (typeof value === 'number') { if (!Number.isFinite(value)) return; }
    else if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) value = Number(value);
    else return; // Graphite plaintext numeric protocol: skip text/objects.
    const customPath = typeof s.metricPath === 'string' && s.metricPath.trim() !== '';
    const rawPath = customPath ? s.metricPath.trim() : id;
    // Custom paths preserve dots as Graphite hierarchy; replaceDots applies only to object IDs.
    const path = this.clean(!customPath && this.cfg.replaceDots ? rawPath.replace(/\./g, '_') : rawPath);
    if (!path) return;
    // A custom metricPath is the complete Graphite path; do not prepend the global prefix.
    const metric = customPath ? path : [this.cfg.prefix, path].filter(Boolean).join('.');
    const ts = Math.floor((Number(state.ts) > 0 ? Number(state.ts) : Date.now()) / 1000);
    this.enqueue(`${metric} ${value} ${ts}\n`);
  }

  enqueue(line) {
    if (this.queue.length >= 10000) {
      this.queue.shift();
      this.adapter.log.warn('Graphite queue full; dropped oldest metric');
    }
    this.queue.push(line);
    this.flush();
  }

  async connect() {
    if (this.stopping || this.connected || this.connecting) return;
    this.connecting = true;
    const sock = new net.Socket();
    this.socket = sock;
    sock.setTimeout(Number(this.cfg.connectTimeoutMs) || 5000);
    sock.connect(Number(this.cfg.port) || 2003, this.cfg.host || '127.0.0.1', () => {
      this.connected = true; this.connecting = false; sock.setTimeout(0);
      this.adapter.log.info('Connected to Graphite Carbon');
      this.flush();
    });
    sock.on('timeout', () => sock.destroy(new Error('connection timeout')));
    sock.on('error', err => this.adapter.log.warn(`Graphite socket: ${err.message}`));
    sock.on('close', () => {
      this.connected = false; this.connecting = false;
      if (this.socket === sock) this.socket = null;
      if (!this.stopping && !this.reconnectTimer) {
        this.reconnectTimer = setTimeout(() => {
          this.reconnectTimer = null; this.connect();
        }, Math.max(1000, Number(this.cfg.reconnectDelayMs) || 5000));
      }
    });
  }

  flush() {
    if (!this.connected || !this.socket || !this.queue.length) return;
    const batch = this.queue.splice(0, 500).join('');
    if (!this.socket.write(batch)) this.socket.once('drain', () => this.flush());
    else if (this.queue.length) setImmediate(() => this.flush());
  }

  onUnload(callback) {
    this.stopping = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    for (const timer of this.timers.values()) clearInterval(timer);
    this.timers.clear();
    if (this.socket) { this.socket.end(); this.socket.destroy(); this.socket = null; }
    callback();
  }
}
new GraphiteAdapter();
