/**
 * RoomManager.js
 * Oda Yönetim Sistemi - StateManager ile tam entegre çalışır.
 * ES6+ / Saf JavaScript — Framework bağımlılığı yok.
 */

import { getStateManager } from './StateManager.js';

// ─── Yardımcı: Benzersiz Oda ID Üretici ────────────────────────────────────
function generateRoomId(type = 'GRUP') {
  const prefix = type === 'private' ? 'PRIV' : type === 'guru' ? 'GURU' : 'GRUP';
  const today  = new Date();
  const datePart = String(today.getMonth() + 1).padStart(2, '0') +
                   String(today.getDate()).padStart(2, '0');           // MMDD
  const chars  = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const rand   = Array.from({ length: 4 }, () =>
    chars[Math.floor(Math.random() * chars.length)]).join('');
  return `${prefix}-${datePart}-${rand}`;                             // Örn: GRUP-0303-X9K2
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
    type,                          // 'private' | 'public' | 'guru'
    name,
    hostId,
    participants: [],              // kullanıcı ID dizisi
    capacity,
    password: type === 'private' ? (password ?? null) : null,
    category,
    isActive:     true,
    createdAt:    Date.now(),
  };
}

// ─── LocalStorage Mock-Sync Katmanı ────────────────────────────────────────
const LS_KEY = 'rm_rooms_sync';

const mockSync = {
  /** Tüm odaları localStorage'dan oku */
  read() {
    try {
      return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    } catch {
      return {};
    }
  },
  /** Tüm odaları localStorage'a yaz (cross-tab sync) */
  write(rooms) {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(rooms));
    } catch (e) {
      console.warn('[RoomManager] localStorage yazma hatası:', e);
    }
  },
  /** Tek bir odayı güncelle */
  upsert(room) {
    const all = this.read();
    all[room.id] = room;
    this.write(all);
  },
  /** Tek bir odayı sil */
  remove(roomId) {
    const all = this.read();
    delete all[roomId];
    this.write(all);
  },
};

// ─── RoomManager Singleton ─────────────────────────────────────────────────
class RoomManager {
  constructor() {
    if (RoomManager._instance) return RoomManager._instance;
    RoomManager._instance = this;

    this._state = getStateManager();

    // StateManager'da 'rooms' anahtarı yoksa başlat
    if (!this._state.get('rooms')) {
      this._state.set('rooms', {});
    }

    // Sayfa açılırken localStorage'dan odaları çek (diğer sekme verileri)
    this._hydrateFromStorage();

    // Cross-tab değişikliklerini dinle
    window.addEventListener('storage', (e) => {
      if (e.key === LS_KEY) this._hydrateFromStorage();
    });
  }

  // ── İç yardımcılar ────────────────────────────────────────────────────────

  _hydrateFromStorage() {
    const stored = mockSync.read();
    this._state.set('rooms', stored);
  }

  _getRooms() {
    return { ...(this._state.get('rooms') || {}) };
  }

  _saveRoom(room) {
    const rooms = this._getRooms();
    rooms[room.id] = room;
    this._state.set('rooms', rooms);
    mockSync.upsert(room);
  }

  _deleteRoom(roomId) {
    const rooms = this._getRooms();
    delete rooms[roomId];
    this._state.set('rooms', rooms);
    mockSync.remove(roomId);
  }

  _currentUser() {
    return this._state.get('currentUser') || null;
  }

  // ── Genel API ─────────────────────────────────────────────────────────────

  /**
   * createRoom(options)
   * Yeni bir oda oluşturur. Yalnızca isPremium:true kullanıcılar oda kurabilir.
   * @param {object} options - { type, name, capacity, password, category }
   * @returns {{ success: boolean, room?: object, error?: string }}
   */
  createRoom(options = {}) {
    const user = this._currentUser();

    if (!user) {
      return { success: false, error: 'Oda oluşturmak için giriş yapmalısınız.' };
    }
    if (!user.isPremium) {
      return { success: false, error: 'Oda oluşturma özelliği yalnızca Premium üyelere açıktır.' };
    }

    const room = createRoomSchema({ ...options, hostId: user.id });
    this._saveRoom(room);

    console.info(`[RoomManager] Oda oluşturuldu: ${room.id} (${room.name})`);
    return { success: true, room };
  }

  /**
   * joinRoom(roomId, password?)
   * Mevcut kullanıcıyı belirtilen odaya ekler.
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
    if (room.participants.length >= room.capacity) {
      return { success: false, error: 'Oda kapasitesi dolu.' };
    }
    if (room.type === 'private' && room.password && room.password !== password) {
      return { success: false, error: 'Şifre yanlış.' };
    }

    room.participants = [...room.participants, user.id];
    this._saveRoom(room);

    console.info(`[RoomManager] ${user.id} → ${roomId} odasına katıldı.`);
    return { success: true, room };
  }

  /**
   * leaveRoom(roomId)
   * Mevcut kullanıcıyı odadan çıkarır.
   * Odada kimse kalmadıysa oda tamamen silinir.
   * @returns {{ success: boolean, deleted?: boolean, error?: string }}
   */
  leaveRoom(roomId) {
    const user = this._currentUser();
    if (!user) return { success: false, error: 'Giriş yapmanız gerekiyor.' };

    const rooms = this._getRooms();
    const room  = rooms[roomId];

    if (!room) return { success: false, error: 'Oda bulunamadı.' };

    room.participants = room.participants.filter(id => id !== user.id);

    if (room.participants.length === 0) {
      // Oda boşaldı → tamamen temizle
      this._deleteRoom(roomId);
      console.info(`[RoomManager] ${roomId} odası boşaldı ve silindi.`);
      return { success: true, deleted: true };
    }

    // Host ayrıldıysa yeni host ata
    if (room.hostId === user.id) {
      room.hostId = room.participants[0];
    }

    this._saveRoom(room);
    console.info(`[RoomManager] ${user.id} → ${roomId} odasından ayrıldı.`);
    return { success: true, deleted: false, room };
  }

  /**
   * getPublicRooms(category?)
   * Aktif ve herkese açık odaları döner.
   * @param {string} [category] - Opsiyonel kategori filtresi
   * @returns {object[]}
   */
  getPublicRooms(category = null) {
    const rooms = this._getRooms();
    return Object.values(rooms).filter(room =>
      room.isActive &&
      room.type === 'public' &&
      (!category || room.category === category)
    );
  }

  /**
   * getRoomById(roomId)
   * ID'ye göre tek oda döner.
   */
  getRoomById(roomId) {
    return this._getRooms()[roomId] || null;
  }

  /**
   * getAllRooms()
   * Debug / admin amaçlı: tüm odaları döner.
   */
  getAllRooms() {
    return Object.values(this._getRooms());
  }
}

// ─── Singleton Export ───────────────────────────────────────────────────────
const roomManagerInstance = new RoomManager();

export default roomManagerInstance;
export { RoomManager };
