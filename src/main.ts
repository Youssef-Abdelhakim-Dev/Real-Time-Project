// main.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js';
import localforage from 'https://esm.sh/localforage';

// ================= CONFIG =================
const CONFIG = {
  SUPABASE_URL: 'https://otdfwulftinkljliyeec.supabase.co',
  SUPABASE_KEY: 'sb_publishable_FmUqchdyTbBOFBCLmZGbDg_KrlFUnTi',
  STORAGE_BUCKET: 'videos'
};

// ================= UTILS =================
class Utils {
  static debounce(fn: Function, delay = 300) {
    let t: any;
    return (...args: any[]) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), delay);
    };
  }

  static createWorker(fn: Function) {
    const blob = new Blob([`onmessage=${fn.toString()}`]);
    return new Worker(URL.createObjectURL(blob));
  }

  static notify(msg: string, success = true) {
    const n = document.createElement('div');
    n.textContent = msg;
    n.style.cssText = `
      position:fixed;top:20px;right:20px;padding:12px 20px;
      background:${success ? '#22c55e' : '#ef4444'};
      color:white;border-radius:10px;font-family:sans-serif;
      box-shadow:0 4px 12px rgba(0,0,0,.2);z-index:9999;
      animation:fadein 0.3s forwards;
    `;
    document.body.appendChild(n);
    setTimeout(() => n.remove(), 2500);
  }

  static async storeBlob(key: string, blob: Blob) {
    try {
      await localforage.setItem(key, blob);
      console.log(`[LocalForage] Stored blob: ${key}`);
    } catch (err) {
      console.error('[LocalForage] Blob store error:', err);
    }
  }

  static async getBlob(key: string) {
    try {
      const b = await localforage.getItem<Blob>(key);
      console.log(`[LocalForage] Loaded blob: ${key}`);
      return b;
    } catch (err) {
      console.error('[LocalForage] Blob get error:', err);
      return null;
    }
  }
}

// ================= STORE =================
class Store {
  private map = new Map<string, any>();
  private ids = new Set<string>();

  add(msg: any) {
    if (!msg?.id) return false;
    if (this.ids.has(msg.id)) return false;
    this.ids.add(msg.id);
    this.map.set(msg.id, msg);
    console.log('[Store] Added message:', msg);
    return true;
  }

  getAll() {
    return [...this.map.values()];
  }
}

// ================= SUPABASE =================
class SupabaseService {
  client: any;
  channel: any;

  constructor() {
    this.client = createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_KEY);
    this.channel = null;
  }

  async send(content: string) {
    if (!content) return;
    try {
      await this.client.from('messages').insert([{ content }]);
      Utils.notify('Message sent!', true);
      console.log('[Supabase] Sent message:', content);
    } catch (err) {
      console.error('[Supabase] Send error:', err);
      Utils.notify('Failed to send!', false);
    }
  }

  async uploadVideo(blob: Blob, filename: string) {
    try {
      const { data, error } = await this.client.storage
        .from(CONFIG.STORAGE_BUCKET)
        .upload(`videos/${filename}`, blob, { cacheControl: '3600', upsert: true });

      if (error) throw error;

      Utils.notify(`Video uploaded: ${filename}`, true);
      console.log('[Supabase] Video uploaded:', filename, data);
    } catch (err) {
      console.error('[Supabase] Video upload error:', err);
      Utils.notify('Video upload failed!', false);
    }
  }

  subscribe(cb: Function) {
    this.channel = this.client
      .channel('room')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        payload => cb(payload.new)
      )
      .subscribe();
    console.log('[Supabase] Subscribed to realtime channel');
  }

  cleanup() {
    this.channel?.unsubscribe();
    console.log('[Supabase] Channel unsubscribed');
  }
}

// ================= CAMERA =================
class Camera {
  video: HTMLVideoElement;
  stream: MediaStream | null = null;
  recorder: MediaRecorder | null = null;
  chunks: Blob[] = [];

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      this.video.srcObject = this.stream;
      console.log('[Camera] Started');
    } catch (err) {
      console.error('[Camera] Error starting camera:', err);
      Utils.notify('Camera error!', false);
    }
  }

  stop() {
    this.stream?.getTracks().forEach(t => t.stop());
    this.video.srcObject = null;
    console.log('[Camera] Stopped');
  }

  record() {
    if (!this.stream) return;
    this.chunks = [];
    this.recorder = new MediaRecorder(this.stream, { mimeType: 'video/webm;codecs=vp9' });
    this.recorder.ondataavailable = e => this.chunks.push(e.data);
    this.recorder.start();
    console.log('[Camera] Recording started');
  }

  stopRecording(): Blob | null {
    if (!this.recorder) return null;
    this.recorder.stop();
    console.log('[Camera] Recording stopped');
    return new Blob(this.chunks, { type: 'video/webm' });
  }
}

// ================= CANVAS =================
class CanvasRenderer {
  container: HTMLElement;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
  disabled = false;

  constructor(container: HTMLElement) {
    if (!container) {
      console.warn('Canvas disabled: container missing');
      this.disabled = true;
      return;
    }
    this.container = container;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.container.appendChild(this.canvas);

    this.resize = this.resize.bind(this);
    window.addEventListener('resize', this.resize);
    this.resize();
  }

  resize() {
    if (this.disabled) return;
    this.canvas.width = this.container.clientWidth || 300;
    this.canvas.height = 300;
  }

  draw(messages: any[]) {
    if (this.disabled || !this.ctx) return;
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.font = '14px sans-serif';

    messages.slice(-20).forEach((msg, i) => {
      ctx.fillStyle = i % 2 ? '#6366f1' : '#22c55e';
      ctx.fillText(msg.content || '', 10, 20 + i * 20);
    });
  }

  destroy() {
    window.removeEventListener('resize', this.resize);
    this.canvas.remove();
  }
}

// ================= UI =================
class UI {
  video: HTMLVideoElement;
  startBtn: HTMLButtonElement;
  stopBtn: HTMLButtonElement;
  recordBtn: HTMLButtonElement;
  input: HTMLInputElement;
  sendBtn: HTMLButtonElement;
  messages: HTMLElement;

  constructor() {
    this.video = document.getElementById('video') as HTMLVideoElement;
    this.startBtn = document.getElementById('startCam') as HTMLButtonElement;
    this.stopBtn = document.getElementById('stopCam') as HTMLButtonElement;
    this.recordBtn = document.getElementById('recordVideo') as HTMLButtonElement;
    this.input = document.getElementById('msgInput') as HTMLInputElement;
    this.sendBtn = document.getElementById('sendMsg') as HTMLButtonElement;
    this.messages = document.getElementById('messages') as HTMLElement;

    if (!this.messages) console.error('#messages not found');
    this.showSkeleton();
  }

  showSkeleton() {
    if (!this.messages) return;
    this.messages.innerHTML = `<div style="height:80px;background:#333;border-radius:10px;animation:pulse 1s infinite;"></div>`;
  }

  clearSkeleton() {
    if (!this.messages) return;
    this.messages.innerHTML = '';
  }
}

// ================= WORKER =================
const worker = Utils.createWorker(function (e: any) {
  const data = e.data;
  postMessage(data); // heavy computation can be done here
});

// ================= APP =================
class App {
  ui: UI;
  store: Store;
  supabase: SupabaseService;
  camera: Camera;
  renderer: CanvasRenderer;

  constructor() {
    this.ui = new UI();
    if (!this.ui.messages) return;

    this.store = new Store();
    this.supabase = new SupabaseService();
    this.camera = new Camera(this.ui.video);
    this.renderer = new CanvasRenderer(this.ui.messages);

    this.init();
  }

  async init() {
    await this.loadCache();
    this.bindEvents();
    this.initRealtime();
  }

  async loadCache() {
    const cached = (await localforage.getItem('messages')) || [];
    cached.forEach((m: any) => this.store.add(m));
    this.renderer.draw(this.store.getAll());
    this.ui.clearSkeleton();
    console.log('[App] Cache loaded', cached.length, 'messages');
  }

  bindEvents() {
    this.ui.startBtn.addEventListener('click', () => this.camera.start());
    this.ui.stopBtn.addEventListener('click', () => this.camera.stop());

    this.ui.recordBtn?.addEventListener('click', async () => {
      if (this.camera.recorder?.state === 'recording') {
        const blob = this.camera.stopRecording();
        if (blob) {
          const filename = `video_${Date.now()}.webm`;
          await Utils.storeBlob(filename, blob);
          await this.supabase.uploadVideo(blob, filename);
        }
      } else {
        this.camera.record();
      }
    });

    this.ui.sendBtn.addEventListener('click', () => this.send());
    this.ui.input.addEventListener('input', Utils.debounce(() => console.log('[UI] Typing...'), 300));
    this.ui.input.addEventListener('keypress', e => {
      if (e.key === 'Enter') this.send();
    });
  }

  async send() {
    const text = this.ui.input.value.trim();
    if (!text) return;

    const tempMsg = { id: Date.now().toString(), content: text };
    this.store.add(tempMsg);
    this.renderer.draw(this.store.getAll());
    localforage.setItem('messages', this.store.getAll());

    this.ui.input.value = '';
    await this.supabase.send(text);
  }

  initRealtime() {
    this.supabase.subscribe(msg => {
      if (!this.store.add(msg)) return;

      worker.postMessage(this.store.getAll());
      worker.onmessage = (e: any) => this.renderer.draw(e.data);
      localforage.setItem('messages', this.store.getAll());
      console.log('[Realtime] New message', msg);
    });
  }

  destroy() {
    this.supabase.cleanup();
    this.camera.stop();
    this.renderer.destroy();
  }
}

// ================= INIT =================
window.addEventListener('DOMContentLoaded', () => {
  const app = new App();
  window.addEventListener('beforeunload', () => app.destroy());
});