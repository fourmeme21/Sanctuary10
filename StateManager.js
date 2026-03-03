/**
 * StateManager.js
 * ================
 * Ambient AI Ses Orkestrasyonu uygulaması için merkezi state yönetim sınıfı.
 *
 * Tasarım ilkeleri:
 *  - Observer Pattern  → subscribe/notify ile reaktif UI güncellemeleri
 *  - Persistence       → StorageAdapter üzerinden otomatik hydration & persist
 *  - Security Layer    → Premium ve kısıtlı içerik için doğrulama katmanı
 *  - Zero DOM          → Hiçbir document/window referansı yok; saf iş mantığı
 *  - Portable          → Zustand/Redux'a taşınabilir slice yapısı
 *
 * Kullanım:
 *   const manager = new StateManager(storageAdapter);
 *   await manager.hydrate();
 *   const unsub = manager.subscribe('playing', (val) => updateUI(val));
 *   manager.setPlaying(true);
 *   unsub(); // aboneliği kaldır
 */

// ─── Tip Sabitleri ────────────────────────────────────────────────────────────

/** @enum {string} */
export const Mood = Object.freeze({
  NEUTRAL:    'neutral',
  FOCUS:      'odaklanma',
  RELAX:      'rahatlama',
  MEDITATION: 'meditasyon',
  SLEEP:      'uyku',
});

/** @enum {string} */
export const PremiumPlan = Object.freeze({
  NONE:  'none',
  BASIC: 'basic',
  PRO:   'pro',
});

/** @enum {string} */
export const BillingCycle = Object.freeze({
  MONTHLY: 'monthly',
  YEARLY:  'yearly',
});

// ─── Varsayılan (Initial) State ───────────────────────────────────────────────

const DEFAULT_STATE = Object.freeze({
  // ── Oynatma ──────────────────────────────────────────────────────────────
  playing:              false,
  currentScene:         'sessiz orman',
  audioTracks:          [],           // [{ name, volume, parameters }]
  masterVolume:         0.8,
  intensity:            0.5,

  // ── Ruh Hali ─────────────────────────────────────────────────────────────
  selectedMood:         Mood.NEUTRAL,

  // ── Seans ────────────────────────────────────────────────────────────────
  sessionStartTime:     null,         // epoch ms | null
  currentSessionDuration: 0,          // saniye

  // ── Uyku Zamanlayıcı ─────────────────────────────────────────────────────
  isTimerActive:        false,
  sleepTimer:           null,         // dakika | null
  sleepTimerEnd:        null,         // epoch ms | null

  // ── Premium & Abonelik ────────────────────────────────────────────────────
  isPremium:            false,
  premiumPlan:          PremiumPlan.NONE,
  billingCycle:         BillingCycle.MONTHLY,
  premiumExpiresAt:     null,         // ISO string | null

  // ── Kullanıcı Tercihleri ──────────────────────────────────────────────────
  bannerDismissed:      false,
  apiKey:               '',           // Gemini API key (şifreli saklanmalı)
  language:             'tr-TR',

  // ── Uygulama Meta ─────────────────────────────────────────────────────────
  isInitialized:        false,
  lastOpenDate:         null,         // ISO string | null
});

// ─── Kalıcı Saklanacak Key'ler ────────────────────────────────────────────────
// Sadece bu key'ler StorageAdapter'a yazılır; audioContext gibi runtime
// nesneler kasıtlı olarak hariç tutulmuştur.

const PERSISTED_KEYS = new Set([
  'selectedMood',
  'isPremium',
  'premiumPlan',
  'billingCycle',
  'premiumExpiresAt',
  'bannerDismissed',
  'apiKey',
  'language',
  'masterVolume',
  'lastOpenDate',
]);

// ─── Kısıtlı İçerik Tanımları ─────────────────────────────────────────────────
// { [sceneName]: minPlan }
const CONTENT_PERMISSIONS = {
  'derin_odak_pro':   PremiumPlan.PRO,
  'binaural_beats':   PremiumPlan.BASIC,
  'uyku_hipnozu':     PremiumPlan.BASIC,
  'aktif_meditasyon': PremiumPlan.BASIC,
};

// Plan hiyerarşisi (yüksek index = daha yüksek erişim)
const PLAN_RANK = {
  [PremiumPlan.NONE]:  0,
  [PremiumPlan.BASIC]: 1,
  [PremiumPlan.PRO]:   2,
};

// ─── StorageAdapter Arayüzü ───────────────────────────────────────────────────
/**
 * StateManager, bağımlılık enjeksiyonu yoluyla herhangi bir storage
 * implementasyonunu kabul eder. Bu sayede localStorage, AsyncStorage
 * (React Native) veya şifreli storage kolayca takılabilir.
 *
 * @typedef {Object} StorageAdapter
 * @property {function(string): Promise<string|null>} get
 * @property {function(string, string): Promise<void>} set
 * @property {function(string): Promise<void>} remove
 */

// ─── Ana Sınıf ────────────────────────────────────────────────────────────────

export class StateManager {
  /** @type {Object} */
  #state;

  /**
   * Anahtar bazlı abone Map'i.
   * Her key için birden fazla listener desteklenir.
   * @type {Map<string, Set<Function>>}
   */
  #keyListeners;

  /**
   * Her state değişikliğinde çağrılan global listener'lar.
   * @type {Set<Function>}
   */
  #globalListeners;

  /** @type {StorageAdapter|null} */
  #storage;

  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  #persistDebounceTimers;

  /** @type {Set<ReturnType<typeof setTimeout>>} */
  #timers;

  /** @type {boolean} */
  #hydrated;

  /**
   * @param {StorageAdapter|null} storageAdapter
   *   null geçilirse persistence devre dışı kalır (test ortamı için kullanışlı).
   */
  constructor(storageAdapter = null) {
    this.#state                = { ...DEFAULT_STATE };
    this.#keyListeners         = new Map();
    this.#globalListeners      = new Set();
    this.#storage              = storageAdapter;
    this.#persistDebounceTimers = new Map();
    this.#timers               = new Set();
    this.#hydrated             = false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BÖLÜM 1 — Temel get / set
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Bir state değerini okur.
   * @template {keyof DEFAULT_STATE} K
   * @param {K} key
   * @returns {typeof DEFAULT_STATE[K]}
   */
  get(key) {
    return this.#state[key];
  }

  /**
   * Ham state değeri atar; doğrulama veya persistence OLMADAN.
   * Dahili kullanım içindir; dışarıdan çağırmaktan kaçının.
   * @private
   */
  #rawSet(key, value) {
    const prev = this.#state[key];
    if (Object.is(prev, value)) return; // değişim yoksa notify etme

    this.#state[key] = value;
    this.#notify(key, value, prev);

    if (PERSISTED_KEYS.has(key)) {
      this.#schedulePersist(key, value);
    }
  }

  /**
   * State'in anlık kopyasını döndürür (immutable snapshot).
   * @returns {Readonly<typeof DEFAULT_STATE>}
   */
  getSnapshot() {
    return Object.freeze({ ...this.#state });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BÖLÜM 2 — Observer / Pub-Sub
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Belirli bir key için reaktif abone olur.
   *
   * @param {string} key          State anahtarı (örn: 'playing')
   * @param {Function} listener   (newValue, prevValue) => void
   * @returns {Function}          Aboneliği iptal eden fonksiyon (unsubscribe)
   *
   * @example
   *   const off = stateManager.subscribe('playing', (val) => setIcon(val));
   *   // ... temizleme sırasında:
   *   off();
   */
  subscribe(key, listener) {
    if (!this.#keyListeners.has(key)) {
      this.#keyListeners.set(key, new Set());
    }
    this.#keyListeners.get(key).add(listener);

    return () => {
      this.#keyListeners.get(key)?.delete(listener);
    };
  }

  /**
   * Tüm state değişikliklerini dinler.
   *
   * @param {Function} listener  ({ key, newValue, prevValue }) => void
   * @returns {Function}         Aboneliği iptal eden fonksiyon
   */
  subscribeAll(listener) {
    this.#globalListeners.add(listener);
    return () => this.#globalListeners.delete(listener);
  }

  /**
   * Birden fazla key'i tek listener ile dinler.
   *
   * @param {string[]} keys
   * @param {Function} listener
   * @returns {Function} Tüm abonelikleri iptal eden fonksiyon
   */
  subscribeMany(keys, listener) {
    const unsubs = keys.map((k) => this.subscribe(k, listener));
    return () => unsubs.forEach((fn) => fn());
  }

  /**
   * @private
   */
  #notify(key, newValue, prevValue) {
    // Key-specific listeners
    this.#keyListeners.get(key)?.forEach((fn) => {
      try { fn(newValue, prevValue); }
      catch (err) { console.error(`[StateManager] Listener hatası (${key}):`, err); }
    });

    // Global listeners
    this.#globalListeners.forEach((fn) => {
      try { fn({ key, newValue, prevValue }); }
      catch (err) { console.error('[StateManager] Global listener hatası:', err); }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BÖLÜM 3 — Persistence (Hydration & Persist)
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Uygulama başlatıldığında storage'dan state'i geri yükler.
   * DOMContentLoaded öncesinde bir kez çağrılmalıdır.
   *
   * @returns {Promise<void>}
   */
  async hydrate() {
    if (!this.#storage) {
      this.#hydrated = true;
      return;
    }

    const loadPromises = [...PERSISTED_KEYS].map(async (key) => {
      try {
        const raw = await this.#storage.get(`state:${key}`);
        if (raw !== null && raw !== undefined) {
          const parsed = this.#deserialize(key, raw);
          this.#state[key] = parsed; // notify olmadan doğrudan yaz
        }
      } catch (err) {
        console.warn(`[StateManager] Hydration hatası (${key}):`, err);
      }
    });

    await Promise.all(loadPromises);

    // Süresi dolmuş premium aboneliği temizle
    this.#validatePremiumExpiry();

    this.#hydrated = true;
    this.#notify('isInitialized', true, false);
    this.#state.isInitialized = true;
  }

  /**
   * @private
   * Debounced persist — aynı key için art arda set çağrılarında
   * sadece son değer kaydedilir (16ms gecikme).
   */
  #schedulePersist(key, value) {
    if (!this.#storage) return;

    const existing = this.#persistDebounceTimers.get(key);
    if (existing) clearTimeout(existing);

    const id = setTimeout(async () => {
      this.#persistDebounceTimers.delete(key);
      try {
        await this.#storage.set(`state:${key}`, this.#serialize(key, value));
      } catch (err) {
        console.error(`[StateManager] Persist hatası (${key}):`, err);
      }
    }, 16);

    this.#persistDebounceTimers.set(key, id);
  }

  /** @private */
  #serialize(key, value) {
    return JSON.stringify(value);
  }

  /** @private */
  #deserialize(key, raw) {
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  }

  /**
   * Tüm kalıcı state'i storage'dan siler.
   * @returns {Promise<void>}
   */
  async clearPersistedState() {
    if (!this.#storage) return;
    await Promise.all(
      [...PERSISTED_KEYS].map((k) => this.#storage.remove(`state:${k}`).catch(() => {}))
    );
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BÖLÜM 4 — Oynatma & Ses Kontrolü
  // ══════════════════════════════════════════════════════════════════════════

  setPlaying(value) {
    this.#rawSet('playing', Boolean(value));
  }

  setCurrentScene(scene) {
    if (typeof scene !== 'string' || !scene.trim()) {
      throw new TypeError('[StateManager] Geçersiz sahne adı');
    }
    this.#rawSet('currentScene', scene.trim());
  }

  setAudioTracks(tracks) {
    if (!Array.isArray(tracks)) {
      throw new TypeError('[StateManager] audioTracks bir dizi olmalıdır');
    }
    this.#rawSet('audioTracks', tracks);
  }

  updateTrackVolume(trackName, volume) {
    const clampedVol = Math.min(1, Math.max(0, volume));
    const tracks = this.#state.audioTracks.map((t) =>
      t.name === trackName ? { ...t, volume: clampedVol } : t
    );
    this.#rawSet('audioTracks', tracks);
  }

  setMasterVolume(volume) {
    const clamped = Math.min(1, Math.max(0, volume));
    this.#rawSet('masterVolume', clamped);
  }

  setIntensity(value) {
    const clamped = Math.min(1, Math.max(0, value));
    this.#rawSet('intensity', clamped);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BÖLÜM 5 — Ruh Hali
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * @param {Mood[keyof Mood]} mood
   */
  setSelectedMood(mood) {
    const validMoods = Object.values(Mood);
    if (!validMoods.includes(mood)) {
      throw new RangeError(
        `[StateManager] Geçersiz mood: "${mood}". Geçerli değerler: ${validMoods.join(', ')}`
      );
    }
    this.#rawSet('selectedMood', mood);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BÖLÜM 6 — Seans Yönetimi
  // ══════════════════════════════════════════════════════════════════════════

  startSession() {
    const now = Date.now();
    this.#rawSet('sessionStartTime', now);
    this.#rawSet('currentSessionDuration', 0);
  }

  /**
   * Seansı bitirir ve süreyi hesaplayıp döndürür.
   * @returns {{ duration: number, mood: string, scene: string, date: string } | null}
   */
  endSession() {
    const start = this.#state.sessionStartTime;
    if (!start) return null;

    const duration = Math.floor((Date.now() - start) / 1000);
    this.#rawSet('currentSessionDuration', duration);
    this.#rawSet('sessionStartTime', null);

    return {
      duration,
      mood:  this.#state.selectedMood,
      scene: this.#state.currentScene,
      date:  new Date().toISOString(),
    };
  }

  /**
   * Aktif seans süresini sorgular (oynarken).
   * @returns {number} Saniye cinsinden geçen süre
   */
  getCurrentSessionDuration() {
    const start = this.#state.sessionStartTime;
    if (!start) return 0;
    return Math.floor((Date.now() - start) / 1000);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BÖLÜM 7 — Uyku Zamanlayıcı
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Uyku zamanlayıcısını başlatır.
   * @param {number} minutes - 1-180 arası bir değer
   * @param {function(): void} onExpire - Süre dolduğunda çağrılır (DOM-free callback)
   * @param {number} [maxMinutes=180]
   */
  setSleepTimer(minutes, onExpire, maxMinutes = 180) {
    if (!Number.isFinite(minutes) || minutes <= 0 || minutes > maxMinutes) {
      throw new RangeError(`[StateManager] Geçersiz zamanlayıcı süresi: ${minutes}`);
    }

    this.cancelSleepTimer();

    const endTime = Date.now() + minutes * 60 * 1000;

    this.#rawSet('isTimerActive', true);
    this.#rawSet('sleepTimer', minutes);
    this.#rawSet('sleepTimerEnd', endTime);

    const timerId = setTimeout(() => {
      this.#rawSet('isTimerActive', false);
      this.#rawSet('sleepTimer', null);
      this.#rawSet('sleepTimerEnd', null);
      this.#timers.delete(timerId);

      if (typeof onExpire === 'function') {
        try { onExpire(); }
        catch (err) { console.error('[StateManager] onExpire hatası:', err); }
      }
    }, minutes * 60 * 1000);

    this.#timers.add(timerId);
    return timerId;
  }

  cancelSleepTimer() {
    this.#rawSet('isTimerActive', false);
    this.#rawSet('sleepTimer', null);
    this.#rawSet('sleepTimerEnd', null);
  }

  /**
   * Kalan zamanlayıcı süresini saniye olarak döndürür.
   * @returns {number}
   */
  getRemainingTimerSeconds() {
    const end = this.#state.sleepTimerEnd;
    if (!end) return 0;
    return Math.max(0, Math.floor((end - Date.now()) / 1000));
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BÖLÜM 8 — Premium & Güvenlik Katmanı
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Premium aboneliği aktif eder.
   *
   * @param {object} params
   * @param {PremiumPlan[keyof PremiumPlan]} params.plan
   * @param {BillingCycle[keyof BillingCycle]} params.billingCycle
   * @param {string|null} [params.expiresAt] - ISO date string
   * @param {string} [params.receiptToken]   - Sunucu tarafı doğrulama için
   * @throws {Error} Plan doğrulama başarısız olursa
   */
  setPremiumStatus({ plan, billingCycle, expiresAt = null, receiptToken = '' }) {
    // — Temel doğrulama —
    if (!Object.values(PremiumPlan).includes(plan)) {
      throw new RangeError(`[StateManager] Geçersiz plan: ${plan}`);
    }
    if (!Object.values(BillingCycle).includes(billingCycle)) {
      throw new RangeError(`[StateManager] Geçersiz fatura döngüsü: ${billingCycle}`);
    }
    if (plan === PremiumPlan.NONE) {
      throw new Error('[StateManager] setPremiumStatus ile NONE plan kurulamaz. revokePremium kullanın.');
    }

    // — İmzalı token kontrolü (stub; gerçek uygulamada sunucu isteği) —
    if (!this.#validatePurchaseToken(receiptToken)) {
      console.warn('[StateManager] Receipt token doğrulanamadı, offline geçiş yapılıyor.');
    }

    this.#rawSet('isPremium', true);
    this.#rawSet('premiumPlan', plan);
    this.#rawSet('billingCycle', billingCycle);
    this.#rawSet('premiumExpiresAt', expiresAt);
  }

  /**
   * Premium aboneliği iptal eder / geri alır.
   */
  revokePremium() {
    this.#rawSet('isPremium', false);
    this.#rawSet('premiumPlan', PremiumPlan.NONE);
    this.#rawSet('premiumExpiresAt', null);
  }

  /**
   * Kullanıcının belirli bir içeriğe erişim iznini kontrol eder.
   *
   * @param {string} contentId   - CONTENT_PERMISSIONS içindeki bir key
   * @returns {{ allowed: boolean, reason: string }}
   *
   * @example
   *   const { allowed, reason } = stateManager.checkContentAccess('binaural_beats');
   *   if (!allowed) showPaywall(reason);
   */
  checkContentAccess(contentId) {
    const requiredPlan = CONTENT_PERMISSIONS[contentId];

    // Kayıtlı kısıtlama yoksa herkese açık içerik
    if (!requiredPlan) {
      return { allowed: true, reason: '' };
    }

    if (!this.#state.isPremium) {
      return {
        allowed: false,
        reason: `Bu içerik premium üyelik gerektiriyor (${requiredPlan}).`,
      };
    }

    const userRank     = PLAN_RANK[this.#state.premiumPlan] ?? 0;
    const requiredRank = PLAN_RANK[requiredPlan] ?? 0;

    if (userRank < requiredRank) {
      return {
        allowed: false,
        reason: `Bu içerik ${requiredPlan} planı gerektiriyor. Mevcut planınız: ${this.#state.premiumPlan}.`,
      };
    }

    // Süre dolmuşsa erişimi kapat
    if (this.#isPremiumExpired()) {
      this.revokePremium();
      return { allowed: false, reason: 'Premium aboneliğinizin süresi dolmuş.' };
    }

    return { allowed: true, reason: '' };
  }

  /**
   * Kısıtlı bir sahneye geçmeden önce erişim kontrolü yapar.
   * İzin yoksa Error fırlatır; izin varsa sahneyi set eder.
   *
   * @param {string} scene
   * @throws {Error} Erişim reddedilirse
   */
  unlockContent(scene) {
    const { allowed, reason } = this.checkContentAccess(scene);
    if (!allowed) {
      throw new Error(`[StateManager] Erişim reddedildi — ${reason}`);
    }
    this.setCurrentScene(scene);
  }

  /** @private */
  #validatePurchaseToken(token) {
    // Gerçek uygulamada: backend'e /verify-receipt isteği atılır.
    // Burada minimum bir format kontrolü yapılır.
    return typeof token === 'string' && token.length > 0;
  }

  /** @private */
  #validatePremiumExpiry() {
    const expiresAt = this.#state.premiumExpiresAt;
    if (expiresAt && new Date(expiresAt) < new Date()) {
      this.#state.isPremium    = false;
      this.#state.premiumPlan  = PremiumPlan.NONE;
      this.#state.premiumExpiresAt = null;
    }
  }

  /** @private */
  #isPremiumExpired() {
    const exp = this.#state.premiumExpiresAt;
    return exp ? new Date(exp) < new Date() : false;
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BÖLÜM 9 — Kullanıcı Tercihleri
  // ══════════════════════════════════════════════════════════════════════════

  setBannerDismissed(value) {
    this.#rawSet('bannerDismissed', Boolean(value));
  }

  setApiKey(key) {
    if (typeof key !== 'string') {
      throw new TypeError('[StateManager] API key string olmalıdır');
    }
    this.#rawSet('apiKey', key);
  }

  setLanguage(lang) {
    this.#rawSet('language', lang);
  }

  setBillingCycle(cycle) {
    if (!Object.values(BillingCycle).includes(cycle)) {
      throw new RangeError(`[StateManager] Geçersiz fatura döngüsü: ${cycle}`);
    }
    this.#rawSet('billingCycle', cycle);
  }

  setLastOpenDate(isoString = new Date().toISOString()) {
    this.#rawSet('lastOpenDate', isoString);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BÖLÜM 10 — Timer & Kaynak Yönetimi
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Harici timer ID'lerini StateManager'a kaydeder.
   * dispose() çağrıldığında otomatik olarak temizlenir.
   * @param {ReturnType<typeof setTimeout>} timerId
   */
  registerTimer(timerId) {
    this.#timers.add(timerId);
  }

  /**
   * Tüm kayıtlı timer'ları temizler.
   */
  clearAllTimers() {
    this.#timers.forEach((id) => {
      clearTimeout(id);
      clearInterval(id);
    });
    this.#timers.clear();
  }

  /**
   * Tüm kaynakları serbest bırakır.
   * Uygulama kapanırken veya component unmount'ta çağrılmalıdır.
   */
  dispose() {
    this.clearAllTimers();
    this.#persistDebounceTimers.forEach((id) => clearTimeout(id));
    this.#persistDebounceTimers.clear();
    this.#keyListeners.clear();
    this.#globalListeners.clear();
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BÖLÜM 11 — Debug / DevTools
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Geliştirme ortamında state'i konsola basar.
   */
  debug() {
    console.group('[StateManager] Mevcut State');
    console.table(this.#state);
    console.groupEnd();
  }

  /**
   * Redux DevTools veya benzeri araçlarla entegrasyon için
   * state'i serileştirilebilir bir obje olarak döndürür.
   * @returns {object}
   */
  toPlainObject() {
    return { ...this.#state };
  }
}

// ─── Singleton Factory (isteğe bağlı) ────────────────────────────────────────
// Uygulamanın tek bir StateManager örneği kullanmasını garanti eder.

let _instance = null;

/**
 * @param {StorageAdapter|null} [storageAdapter]
 * @returns {StateManager}
 */
export function getStateManager(storageAdapter = null) {
  if (!_instance) {
    _instance = new StateManager(storageAdapter);
  }
  return _instance;
}

/**
 * Yalnızca test ortamında singleton'ı sıfırlamak için kullanılır.
 * @internal
 */
export function _resetStateManagerSingleton() {
  _instance?.dispose();
  _instance = null;
}
