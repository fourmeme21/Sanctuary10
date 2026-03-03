/**
 * RoomManager.js
 * Oda Yönetim Sistemi - StateManager ile tam entegre çalışır.
 * ES6+ / Saf JavaScript — Framework bağımlılığı yok.
 *
 * 3. Aşama Güvenlik & Mantık Değişiklikleri:
 *  - Şifreleme: Oda şifreleri düz metin yerine hashPassword() ile saklanır.
 *    joinRoom'da karşılaştırma da aynı hash fonksiyonundan geçer.
 *  - Premium Kontrolü: createRoom ve private odalara joinRoom işlemlerinde
 *    StateManager.isPremium kontrolü yapılır.
 *  - Host Yetkisi: deleteRoom yalnızca hostId sahibi tarafından yapılabilir.
 *  - Kapasite: room.current yerine room.participants.length kullanılır.
 *  - Ayrılma (Leave): Host ayrılırsa sıradaki katılımcı otomatik host olur;
 *    oda tamamen boşalırsa silinir.
 */

import { getStateManager } from './StateManager.js';

// ─── Şifre Hash Yardımcısı ──────────────────────────────────────────────────
/**
 * Basit, deterministik oda şifresi hash'i.
 *
 * Güvenlik notu: btoa tabanlı bu hash, kriptografik güvenlik sağlamaz —
 * gizli veri korumak için değil, şifrelerin düz metin olarak saklanmasını
 * önlemek amacıyla kullanılır. Üretim ortamında bcrypt/argon2 + backend
 * doğrulaması kullanın.
 *
 * @param {string} password
 * @returns {string}
 */
function hashPassword(password) {
  if (!password) return '';
  try {
    // Tuz olarak sabit bir prefix eklenerek basit rainbow-table tespiti engellenir
    return btoa(`sanctuary::${password}`);
  } catch {
    // btoa Unicode sorunları için fallback
    return btoa(encodeURIComponent(`sanctuary::${password}`));
  }
}

// ─── Yardımcı: Benzersiz Oda ID Üretici ────────────────────────────────────
function generateRoomId(type = 'GRUP') {
  const prefix = type === 'private' ? 'PRIV' : type === 'guru' ? 'GURU' : 'GRUP';
  const today  = new Date();
  const datePart = String(today.getMonth() + 1).padStart(2, '0') +
                   String(today.getDate()).padStart(2, '0');
  const chars  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rand   = Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${prefix}-${datePart}-${rand}`;
}

// ─── Oda Şeması (factory) ──────────────────────────────────────────────────
function createRoomSchema({
  type     = 'public',
  name     = 'İsimsiz Oda',
  hostId,
  capacity = 10,
  password = null,
  category = 'genel',
} = {}) {
  return {
    id:           generateRoomId(type),
    type,
    name,
    hostId,
    participants: [],
    capacity,
    // FIX: Şifre hash'lenerek saklanır — düz metin asla saklanmaz
    password: type === 'private' ? hashPassword(password) : null,
    category,
    isActive:     true,
    createdAt:    Date.now(),
  };
}

// ─── RoomManager Singleton ─────────────────────────────────────────────────
class RoomManager {
  constructor() {
    if (RoomManager._instance) return RoomManager._instance;
    RoomManager._instance = this;

    this._state = getStateManager();

    if (!this._state.get('rooms')) {
      this._state.set('rooms', {});
    }
  }

  // ── İç yardımcılar ────────────────────────────────────────────────────────

  _getRooms() {
    return { ...(this._state.get('rooms') || {}) };
  }

  _saveRoom(room) {
    const rooms = this._getRooms();
    rooms[room.id] = room;
    this._state.set('rooms', rooms);
  }

  _deleteRoom(roomId) {
    const rooms = this._getRooms();
    delete rooms[roomId];
    this._state.set('rooms', rooms);
  }

  _currentUser() {
    return this._state.get('currentUser') || null;
  }

  /**
   * Kullanıcının premium olup olmadığını StateManager üzerinden kontrol eder.
   * @private
   */
  _isPremiumUser() {
    return Boolean(this._state.get('isPremium'));
  }

  // ── Genel API ─────────────────────────────────────────────────────────────

  /**
   * createRoom(options)
   * Yeni bir oda oluşturur.
   *
   * FIX 1 — Premium Kontrolü:
   *   Oda oluşturma işlemi StateManager.isPremium üzerinden kontrol edilir.
   *   Premium olmayan kullanıcılar oda kuramazlar.
   *
   * FIX 2 — Şifre Hash:
   *   private oda şifresi createRoomSchema içinde hashPassword() ile hash'lenir.
   *
   * @param {object} options - { type, name, capacity, password, category }
   * @returns {{ success: boolean, room?: object, error?: string }}
   */
  createRoom(options = {}) {
    const user = this._currentUser();

    if (!user) {
      return { success: false, error: 'Oda oluşturmak için giriş yapmalısınız.' };
    }

    // FIX: StateManager.isPremium üzerinden doğrulama
    if (!this._isPremiumUser()) {
      return {
        success: false,
        error: 'Oda oluşturma özelliği yalnızca Premium üyelere açıktır.',
      };
    }

    const room = createRoomSchema({ ...options, hostId: user.id });
    this._saveRoom(room);

    console.info(`[RoomManager] Oda oluşturuldu: ${room.id} (${room.name})`);
    return { success: true, room };
  }

  /**
   * joinRoom(roomId, password?)
   * Mevcut kullanıcıyı belirtilen odaya ekler.
   *
   * FIX 1 — Premium Kontrolü:
   *   Private odalara katılım StateManager.isPremium ile kontrol edilir.
   *
   * FIX 2 — Şifre Karşılaştırma:
   *   Gelen şifre hash'lenerek saklanan hash ile karşılaştırılır.
   *
   * FIX 3 — Kapasite:
   *   room.current yerine room.participants.length kullanılır.
   *
   * @returns {{ success: boolean, room?: object, error?: string }}
   */
  joinRoom(roomId, password = null) {
    const user = this._currentUser();
    if (!user) return { success: false, error: 'Giriş yapmanız gerekiyor.' };

    const rooms = this._getRooms();
    const room  = rooms[roomId];

    if (!room)          return { success: false, error: 'Oda bulunamadı.' };
    if (!room.isActive) return { success: false, error: 'Bu oda artık aktif değil.' };

    if (room.participants.includes(user.id)) {
      return { success: false, error: 'Zaten bu odadasınız.' };
    }

    // FIX: Kapasite kontrolü room.participants.length ile yapılır
    if (room.participants.length >= room.capacity) {
      return { success: false, error: 'Oda kapasitesi dolu.' };
    }

    // FIX: Private odalara katılım için premium kontrolü
    if (room.type === 'private' && !this._isPremiumUser()) {
      return {
        success: false,
        error: 'Özel odalara katılmak için Premium üyelik gereklidir.',
      };
    }

    // FIX: Şifre karşılaştırması hash üzerinden yapılır
    if (room.type === 'private' && room.password) {
      const hashedInput = hashPassword(password);
      if (hashedInput !== room.password) {
        return { success: false, error: 'Şifre yanlış.' };
      }
    }

    room.participants = [...room.participants, user.id];
    this._saveRoom(room);

    console.info(`[RoomManager] ${user.id} → ${roomId} odasına katıldı.`);
    return { success: true, room };
  }

  /**
   * leaveRoom(roomId)
   * Mevcut kullanıcıyı odadan çıkarır.
   *
   * FIX — Host Ayrılma Mantığı:
   *   Kullanıcı host ise:
   *     - Odada başka katılımcı varsa → sıradaki katılımcı otomatik host olur.
   *     - Odada kimse kalmadıysa → oda tamamen silinir.
   *
   * @returns {{ success: boolean, deleted?: boolean, newHost?: string, error?: string }}
   */
  leaveRoom(roomId) {
    const user = this._currentUser();
    if (!user) return { success: false, error: 'Giriş yapmanız gerekiyor.' };

    const rooms = this._getRooms();
    const room  = rooms[roomId];

    if (!room) return { success: false, error: 'Oda bulunamadı.' };

    // Kullanıcıyı katılımcı listesinden çıkar
    room.participants = room.participants.filter(id => id !== user.id);

    // Oda tamamen boşaldı → sil
    if (room.participants.length === 0) {
      this._deleteRoom(roomId);
      console.info(`[RoomManager] ${roomId} odası boşaldı ve silindi.`);
      return { success: true, deleted: true };
    }

    // Host ayrılıyorsa → sıradaki katılımcıyı host yap
    let newHost = null;
    if (room.hostId === user.id) {
      newHost = room.participants[0];
      room.hostId = newHost;
      console.info(`[RoomManager] ${roomId} odasının yeni hostu: ${newHost}`);
    }

    this._saveRoom(room);
    console.info(`[RoomManager] ${user.id} → ${roomId} odasından ayrıldı.`);
    return { success: true, deleted: false, room, newHost };
  }

  /**
   * deleteRoom(roomId)
   * Bir odayı kalıcı olarak siler.
   *
   * FIX — Host Yetkisi:
   *   Silme işlemi yalnızca odanın hostId'si ile eşleşen kullanıcı tarafından
   *   yapılabilir. Başka kullanıcılar engellenir.
   *
   * @param {string} roomId
   * @returns {{ success: boolean, error?: string }}
   */
  deleteRoom(roomId) {
    const user = this._currentUser();
    if (!user) return { success: false, error: 'Giriş yapmanız gerekiyor.' };

    const rooms = this._getRooms();
    const room  = rooms[roomId];

    if (!room) return { success: false, error: 'Oda bulunamadı.' };

    // FIX: Yalnızca host silebilir
    if (room.hostId !== user.id) {
      return {
        success: false,
        error: 'Bu odayı silme yetkiniz yok. Yalnızca oda kurucusu silebilir.',
      };
    }

    this._deleteRoom(roomId);
    console.info(`[RoomManager] ${roomId} odası host ${user.id} tarafından silindi.`);
    return { success: true };
  }

  /**
   * getPublicRooms(category?)
   * Aktif ve herkese açık odaları döner.
   *
   * FIX: Kapasite gösterimi room.participants.length ile yapılır.
   *
   * @param {string} [category]
   * @returns {object[]}
   */
  getPublicRooms(category = null) {
    const rooms = this._getRooms();
    return Object.values(rooms)
      .filter(room =>
        room.isActive &&
        room.type === 'public' &&
        (!category || room.category === category)
      )
      .map(room => ({
        ...room,
        // FIX: current her zaman gerçek dizi uzunluğundan hesaplanır
        current: room.participants.length,
      }));
  }

  /**
   * getRoomById(roomId)
   * ID'ye göre tek oda döner.
   * FIX: current alanı participants.length'ten türetilir.
   */
  getRoomById(roomId) {
    const room = this._getRooms()[roomId] || null;
    if (!room) return null;
    return { ...room, current: room.participants.length };
  }

  /**
   * getAllRooms()
   * Debug / admin amaçlı: tüm odaları döner.
   * FIX: current alanı participants.length'ten türetilir.
   */
  getAllRooms() {
    return Object.values(this._getRooms()).map(room => ({
      ...room,
      current: room.participants.length,
    }));
  }

  /**
   * buildRoomCard(room)
   * UI kartı için oda verisini hazırlar.
   *
   * FIX: Kapasite gösterimi room.participants.length üzerinden yapılır.
   * room.current gibi senkronizasyonu bozulabilecek alanlar kullanılmaz.
   *
   * @param {object} room
   * @returns {object} UI'a geçirilecek kart objesi
   */
  buildRoomCard(room) {
    const participantCount = room.participants.length; // FIX: gerçek uzunluk
    const capacityFill = Math.min(1, participantCount / room.capacity);

    return {
      id:            room.id,
      name:          room.name,
      category:      room.category,
      type:          room.type,
      hostId:        room.hostId,
      isPrivate:     room.type === 'private',
      isLive:        room.isActive,
      current:       participantCount,        // FIX: participants.length
      capacity:      room.capacity,
      capacityFill,                           // 0..1 arası doluluk oranı
      isFull:        participantCount >= room.capacity,
      createdAt:     room.createdAt,
    };
  }
}

// ─── Singleton Export ───────────────────────────────────────────────────────
const roomManagerInstance = new RoomManager();

export default roomManagerInstance;
export { RoomManager };
