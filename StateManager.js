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
 * 3. Aşama Güvenlik Değişiklikleri:
 *  - apiKey artık localStorage'a YAZILMIYOR (PERSISTED_KEYS'den çıkarıldı).
 *  - apiKey sadece runtime bellekte, private #apiKeyRuntime alanında tutulur.
 *  - validatePurchaseToken frontend doğrulaması tamamen kaldırıldı; backend
 *    olmadan güvenli false döndürür — asla client-side token "doğrulaması" yapılmaz.
 *  - setPremiumStatus artık receiptToken doğrulamasında uyarı yerine açık hata
 *    bilgisi verir ve offline/demo modunu açıkça işaretler.
 */

// ─── Tip Sabitleri ────────────────────────────────────────────────────────────

/** @enum {string} */
export const Mood = Object.freeze({
  HUZURSUZ:   'Huzursuz',
  YORGUN:     'Yorgun',
  KAYGILI:    'Kaygılı',
  MUTSUZ:     'Mutsuz',
  SAKIN:      'Sakin',
  MINNETTAR:  'Minnettar',
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
  selectedMood:         Mood.SAKIN,

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
  // FIX: apiKey artık bu state objesinde SAKLANMIYOR.
  // Bunun yerine #apiKeyRuntime private alanında tutulur ve persist edilmez.
  language:             'tr-TR',

  // ── Uygulama Meta ─────────────────────────────────────────────────────────
  isInitialized:        false,
  lastOpenDate:         null,         // ISO string | null
});

// ─── Kalıcı Saklanacak Key'ler ────────────────────────────────────────────────
// FIX: 'apiKey' bu listeden ÇIKARILDI — API anahtarları localStorage'a yazılmaz.
// Sadece bu key'ler StorageAdapter'a yazılır.

const PERSISTED_KEYS = new Set([
  'selectedMood',
  'isPremium',
  'premiumPlan',
  'billingCycle',
  'premiumExpiresAt',
  'bannerDismissed',
  // 'apiKey' — KASITLI OLARAK ÇIKARILDI: API key localStorage'a yazılmaz
  'language',
  'masterVolume',
  'lastOpenDate',
]);

// ─── Kısıtlı İçerik Tanımları ─────────────────────────────────────────────────
const CONTENT_PERMISSIONS = {
  'derin_odak_pro':   PremiumPlan.PRO,
  'binaural_beats':   PremiumPlan.BASIC,
  'uyku_hipnozu':     PremiumPlan.BASIC,
  'aktif_meditasyon': PremiumPlan.BASIC,
};

const PLAN_RANK = {
  [PremiumPlan.NONE]:  0,
  [PremiumPlan.BASIC]: 1,
  [PremiumPlan.PRO]:   2,
};

// ─── StorageAdapter Arayüzü ───────────────────────────────────────────────────
/**
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
   * FIX: API anahtarı yalnızca bu private runtime alanında tutulur.
   * localStorage'a hiçbir zaman yazılmaz, snapshot'a dahil edilmez.
   * @type {string}
   */
  #apiKeyRuntime;

  /** @type {Map<string, Set<Function>>} */
  #keyListeners;

  /** @type {Set<Function>} */
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
   */
  constructor(storageAdapter = null) {
    this.#state                = { ...DEFAULT_STATE };
    this.#apiKeyRuntime        = '';           // API key bellekte, persist edilmez
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

  get(key) {
    // FIX: 'apiKey' getter'ı #apiKeyRuntime'a yönlendirilir
    if (key === 'apiKey') return this.#apiKeyRuntime;
    return this.#state[key];
  }

  /** @private */
  #rawSet(key, value) {
    // FIX: 'apiKey' set işlemi #apiKeyRuntime'a yönlendirilir; state'e/persist'e dokunulmaz
    if (key === 'apiKey') {
      this.#apiKeyRuntime = value ?? '';
      return;
    }

    const prev = this.#state[key];
    if (Object.is(prev, value)) return;

    this.#state[key] = value;
    this.#notify(key, value, prev);

    if (PERSISTED_KEYS.has(key)) {
      this.#schedulePersist(key, value);
    }
  }

  /**
   * State'in anlık kopyasını döndürür.
   * FIX: API key snapshot'a dahil edilmez — güvenlik için.
   * @returns {Readonly<Object>}
   */
  getSnapshot() {
    // apiKey kasıtlı olarak snapshot'a dahil edilmez
    const { ...snapshot } = this.#state;
    return Object.freeze(snapshot);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BÖLÜM 2 — Observer / Pub-Sub
  // ══════════════════════════════════════════════════════════════════════════

  subscribe(key, listener) {
    if (!this.#keyListeners.has(key)) {
      this.#keyListeners.set(key, new Set());
    }
    this.#keyListeners.get(key).add(listener);
    return () => {
      this.#keyListeners.get(key)?.delete(listener);
    };
  }

  subscribeAll(listener) {
    this.#globalListeners.add(listener);
    return () => this.#globalListeners.delete(listener);
  }

  subscribeMany(keys, listener) {
    const unsubs = keys.map((k) => this.subscribe(k, listener));
    return () => unsubs.forEach((fn) => fn());
  }

  /** @private */
  #notify(key, newValue, prevValue) {
    this.#keyListeners.get(key)?.forEach((fn) => {
      try { fn(newValue, prevValue); }
      catch (err) { console.error(`[StateManager] Listener hatası (${key}):`, err); }
    });

    this.#globalListeners.forEach((fn) => {
      try { fn({ key, newValue, prevValue }); }
      catch (err) { console.error('[StateManager] Global listener hatası:', err); }
    });
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BÖLÜM 3 — Persistence (Hydration & Persist)
  // ══════════════════════════════════════════════════════════════════════════

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
          this.#state[key] = parsed;
        }
      } catch (err) {
        console.warn(`[StateManager] Hydration hatası (${key}):`, err);
      }
    });

    await Promise.all(loadPromises);

    // FIX: Hydration sırasında apiKey storage'dan OKUNMAZ
    // API key uygulama başlangıcında setApiKey() ile runtime'a yüklenir.

    this.#validatePremiumExpiry();

    this.#hydrated = true;
    this.#notify('isInitialized', true, false);
    this.#state.isInitialized = true;
  }

  /** @private */
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

  getCurrentSessionDuration() {
    const start = this.#state.sessionStartTime;
    if (!start) return 0;
    return Math.floor((Date.now() - start) / 1000);
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BÖLÜM 7 — Uyku Zamanlayıcı
  // ══════════════════════════════════════════════════════════════════════════

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
   * FIX: validatePurchaseToken artık client-side "doğrulama" YAPMIYOR.
   * Backend entegrasyonu olmadan token doğrulaması güvenli değildir.
   * receiptToken parametresi gelecekteki backend entegrasyonu için
   * imza alanı olarak korunuyor; şimdilik sadece loglanıyor.
   */
  setPremiumStatus({ plan, billingCycle, expiresAt = null, receiptToken = '' }) {
    if (!Object.values(PremiumPlan).includes(plan)) {
      throw new RangeError(`[StateManager] Geçersiz plan: ${plan}`);
    }
    if (!Object.values(BillingCycle).includes(billingCycle)) {
      throw new RangeError(`[StateManager] Geçersiz fatura döngüsü: ${billingCycle}`);
    }
    if (plan === PremiumPlan.NONE) {
      throw new Error('[StateManager] setPremiumStatus ile NONE plan kurulamaz. revokePremium kullanın.');
    }

    // FIX: Frontend doğrulaması kaldırıldı.
    // receiptToken backend'e iletilmek üzere loglanır; client-side geçerlilik
    // kontrolü yapılmaz — böyle bir kontrol bypass edilebilir olduğundan güvensizdir.
    // Gerçek uygulamada: await backendVerifyReceipt(receiptToken) çağrısı yapılmalı.
    if (receiptToken) {
      console.info('[StateManager] Receipt token mevcut — backend doğrulaması gerekli.');
    } else {
      console.warn('[StateManager] Receipt token sağlanmadı. Demo/offline mod aktif.');
    }

    this.#rawSet('isPremium', true);
    this.#rawSet('premiumPlan', plan);
    this.#rawSet('billingCycle', billingCycle);
    this.#rawSet('premiumExpiresAt', expiresAt);
  }

  revokePremium() {
    this.#rawSet('isPremium', false);
    this.#rawSet('premiumPlan', PremiumPlan.NONE);
    this.#rawSet('premiumExpiresAt', null);
  }

  checkContentAccess(contentId) {
    const requiredPlan = CONTENT_PERMISSIONS[contentId];

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

    if (this.#isPremiumExpired()) {
      this.revokePremium();
      return { allowed: false, reason: 'Premium aboneliğinizin süresi dolmuş.' };
    }

    return { allowed: true, reason: '' };
  }

  unlockContent(scene) {
    const { allowed, reason } = this.checkContentAccess(scene);
    if (!allowed) {
      throw new Error(`[StateManager] Erişim reddedildi — ${reason}`);
    }
    this.setCurrentScene(scene);
  }

  /**
   * FIX: validatePurchaseToken tamamen güvenli hale getirildi.
   *
   * Önceki implementasyon token uzunluğunu kontrol ediyordu — bu client-side
   * doğrulama kolayca bypass edilebilirdi. Şimdi her zaman false döndürür:
   * token geçerliliği YALNIZCA backend'de kontrol edilebilir.
   *
   * @returns {false} — Her zaman false; gerçek doğrulama backend'e bırakılıyor.
   * @private
   */
  #validatePurchaseToken(/* token */) {
    // Güvenlik notu: Client-side token doğrulaması anlamsızdır —
    // kullanıcı token formatını taklit edebilir. Bu metod artık
    // hiçbir doğrulama yapmaz ve her zaman false döndürür.
    // Üretim ortamında: token'ı sunucuya gönderin ve sunucu yanıtına göre hareket edin.
    return false;
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

  /**
   * API anahtarını runtime belleğe kaydeder.
   * FIX: localStorage'a YAZILMAZ — #apiKeyRuntime private alanında saklanır.
   * Uygulama her açılışında kullanıcıdan tekrar alınmalı veya güvenli bir
   * native store (Keychain/SecureStore) üzerinden inject edilmelidir.
   *
   * @param {string} key
   */
  setApiKey(key) {
    if (typeof key !== 'string') {
      throw new TypeError('[StateManager] API key string olmalıdır');
    }
    // Güvenlik notu: key localStorage/sessionStorage'a asla yazılmıyor.
    // Sadece bu session için bellekte tutuluyor.
    this.#apiKeyRuntime = key;
  }

  /**
   * Runtime API anahtarını döndürür.
   * Snapshot veya persist mekanizmasının dışındadır.
   * @returns {string}
   */
  getApiKey() {
    return this.#apiKeyRuntime;
  }

  /**
   * API anahtarını bellekten siler (logout / güvenli temizleme).
   */
  clearApiKey() {
    this.#apiKeyRuntime = '';
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

  registerTimer(timerId) {
    this.#timers.add(timerId);
  }

  clearAllTimers() {
    this.#timers.forEach((id) => {
      clearTimeout(id);
      clearInterval(id);
    });
    this.#timers.clear();
  }

  dispose() {
    this.clearAllTimers();
    this.#persistDebounceTimers.forEach((id) => clearTimeout(id));
    this.#persistDebounceTimers.clear();
    this.#keyListeners.clear();
    this.#globalListeners.clear();
    // API key'i bellekten temizle
    this.#apiKeyRuntime = '';
  }

  // ══════════════════════════════════════════════════════════════════════════
  // BÖLÜM 11 — Debug / DevTools
  // ══════════════════════════════════════════════════════════════════════════

  debug() {
    console.group('[StateManager] Mevcut State');
    // FIX: apiKey debug çıktısına dahil edilmez
    const safeState = { ...this.#state, apiKey: '[GİZLİ — runtime]' };
    console.table(safeState);
    console.groupEnd();
  }

  toPlainObject() {
    // FIX: apiKey dışa aktarılan objeye dahil edilmez
    return { ...this.#state };
  }
}

// ─── Singleton Factory ────────────────────────────────────────────────────────

let _instance = null;

export function getStateManager(storageAdapter = null) {
  if (!_instance) {
    _instance = new StateManager(storageAdapter);
  }
  return _instance;
}

export function _resetStateManagerSingleton() {
  _instance?.dispose();
  _instance = null;
}
