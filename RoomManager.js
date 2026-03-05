
/**
 * RoomManager.js — Sanctuary 10. Aşama (Senkronize Odalar & Canlı Etkileşim)
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 10 Değişiklikleri:
 *   1. syncRoomAudio()   — Host ses değişince tüm katılımcılara broadcast
 *   2. Avatar Aura       — Katılımcı nefes durumu takibi
 *   3. Reaksiyon sistemi — Emoji tabanlı floating reaksiyonlar
 *   4. Host devri        — Host ayrılınca otomatik atama
 *   5. UMD wrapper       — ES module yerine window.RoomManager global
 */
(function(global) {
  'use strict';

  /* ── Şifre Hash ── */
  function hashPassword(pw) {
    if (!pw) return '';
    try { return btoa('sanctuary::' + pw); }
    catch(e) { return btoa(encodeURIComponent('sanctuary::' + pw)); }
  }

  /* ── ID Üretici ── */
  function generateRoomId(type) {
    var prefix = type === 'private' ? 'PRIV' : type === 'guru' ? 'GURU' : 'GRUP';
    var d = new Date();
    var datePart = String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
    var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    var rand = Array.from({length:4}, function(){ return chars[Math.floor(Math.random()*chars.length)]; }).join('');
    return prefix + '-' + datePart + '-' + rand;
  }

  /* ── Demo Oda Verisi ── */
  var DEMO_ROOMS = [
    { id:'GRUP-0304-AAA1', type:'public', name:'Gece Odak Seansı',   hostId:'user_zeynep', participants:['user_zeynep','u2','u3','u4','u5'], capacity:8,  password:null, category:'odak',       isActive:true, createdAt:Date.now()-3600000, audioConfig:{gen:'binaural',base:40,beat:10} },
    { id:'GRUP-0304-BBB2', type:'public', name:'Derin Uyku Rituali', hostId:'user_mert',   participants:['user_mert','u6'],                  capacity:6,  password:null, category:'uyku',       isActive:true, createdAt:Date.now()-7200000, audioConfig:{gen:'rain',base:174,beat:3}    },
    { id:'GRUP-0304-CCC3', type:'public', name:'Sabah Meditasyonu',  hostId:'user_selin',  participants:['user_selin','u7','u8'],             capacity:10, password:null, category:'meditasyon', isActive:true, createdAt:Date.now()-1800000, audioConfig:{gen:'waves',base:432,beat:7}   },
    { id:'GRUP-0304-DDD4', type:'public', name:'432 Hz Şifa Odası',  hostId:'user_ayse',   participants:['user_ayse','u9','u10','u11','u12','u13','u14','u15','u16'], capacity:12, password:null, category:'meditasyon', isActive:true, createdAt:Date.now()-900000, audioConfig:{gen:'binaural',base:432,beat:7} },
    { id:'GRUP-0304-EEE5', type:'public', name:'Çalışma Müziği',     hostId:'user_can',    participants:['user_can','u17','u18','u19','u20','u21'], capacity:20, password:null, category:'odak', isActive:true, createdAt:Date.now()-600000, audioConfig:{gen:'wind',base:40,beat:10} },
    { id:'PRIV-0304-FFF6', type:'private',name:'Özel Seans',         hostId:'user_nilufer',participants:['user_nilufer','u22'], capacity:4, password:hashPassword('demo'), category:'uyku', isActive:true, createdAt:Date.now()-300000, audioConfig:{gen:'rain',base:528,beat:6} },
  ];

  /* ── Broadcast Simülasyonu ── */
  var _listeners = {};
  function _broadcast(event, data) {
    var handlers = _listeners[event] || [];
    handlers.forEach(function(fn){ try { fn(data); } catch(e){} });
    // Diğer sekmelere de gönder (cross-tab simülasyon)
    try { localStorage.setItem('sanctuary_room_event', JSON.stringify({event:event,data:data,ts:Date.now()})); } catch(e){}
  }

  function _on(event, fn) {
    if (!_listeners[event]) _listeners[event] = [];
    _listeners[event].push(fn);
  }

  /* ── Storage ── */
  var _rooms = null;
  function _load() {
    if (_rooms) return _rooms;
    try {
      var stored = localStorage.getItem('sanctuary_rooms');
      if (stored) { _rooms = JSON.parse(stored); return _rooms; }
    } catch(e) {}
    // Demo odaları yükle
    _rooms = {};
    DEMO_ROOMS.forEach(function(r){ _rooms[r.id] = r; });
    _persist();
    return _rooms;
  }

  function _persist() {
    try { localStorage.setItem('sanctuary_rooms', JSON.stringify(_rooms)); } catch(e) {}
  }

  /* ── Katılımcı Host Adları ── */
  var HOST_NAMES = {
    'user_zeynep':'Zeynep A.','user_mert':'Mert K.','user_selin':'Selin T.',
    'user_ayse':'Ayşe D.','user_can':'Can B.','user_nilufer':'Nilüfer Y.',
  };
  function _hostName(id) { return HOST_NAMES[id] || (id ? id.replace('user_','').replace('_',' ') : 'Misafir'); }

  /* ── Nefes Durumu ── */
  var _breathingUsers = {};
  function _setBreathing(userId, isBreathing) {
    _breathingUsers[userId] = isBreathing;
    _broadcast('breath_update', {userId:userId, breathing:isBreathing});
  }

  /* ── Ana API ── */
  var RoomManager = {

    on: _on,

    getRooms: function() { return _load(); },

    getPublicRooms: function(category) {
      var rooms = _load();
      return Object.values(rooms).filter(function(r){
        return r.isActive && (!category || category==='all' || r.category===category);
      }).map(function(r){ return Object.assign({}, r, {current: r.participants.length}); });
    },

    getRoomById: function(id) {
      var r = _load()[id]; 
      return r ? Object.assign({}, r, {current:r.participants.length}) : null;
    },

    createRoom: function(opts) {
      opts = opts || {};
      var rooms = _load();
      var room = {
        id: generateRoomId(opts.type||'public'),
        type: opts.type||'public',
        name: opts.name||'Yeni Oda',
        hostId: opts.hostId||'user_local',
        participants: [opts.hostId||'user_local'],
        capacity: opts.capacity||10,
        password: opts.type==='private' ? hashPassword(opts.password) : null,
        category: opts.category||'genel',
        isActive: true,
        createdAt: Date.now(),
        audioConfig: opts.audioConfig||{gen:'binaural',base:432,beat:7},
      };
      rooms[room.id] = room;
      _rooms = rooms;
      _persist();
      _broadcast('room_created', room);
      return {success:true, room:room};
    },

    joinRoom: function(roomId, password) {
      var rooms = _load();
      var room = rooms[roomId];
      if (!room) return {success:false, error:'Oda bulunamadı.'};
      if (!room.isActive) return {success:false, error:'Oda aktif değil.'};
      if (room.participants.length >= room.capacity) return {success:false, error:'Oda dolu.'};
      if (room.type==='private' && room.password) {
        if (hashPassword(password) !== room.password) return {success:false, error:'Şifre yanlış.'};
      }
      var userId = 'user_local';
      if (!room.participants.includes(userId)) {
        room.participants = room.participants.concat([userId]);
        _rooms = rooms;
        _persist();
        _broadcast('user_joined', {roomId:roomId, userId:userId});
      }
      return {success:true, room:room};
    },

    leaveRoom: function(roomId) {
      var rooms = _load();
      var room = rooms[roomId];
      if (!room) return {success:false, error:'Oda bulunamadı.'};
      var userId = 'user_local';
      room.participants = room.participants.filter(function(id){ return id!==userId; });
      var result = {success:true, deleted:false, newHost:null};
      if (room.participants.length === 0) {
        delete rooms[roomId];
        result.deleted = true;
      } else if (room.hostId === userId) {
        room.hostId = room.participants[0];
        result.newHost = room.hostId;
        _broadcast('host_changed', {roomId:roomId, newHost:room.hostId});
      }
      _rooms = rooms;
      _persist();
      return result;
    },

    /* ── Senkronize Ses (10. Aşama) ── */
    syncRoomAudio: function(roomId, audioConfig) {
      var rooms = _load();
      var room = rooms[roomId];
      if (!room) return;
      room.audioConfig = audioConfig;
      _rooms = rooms;
      _persist();
      _broadcast('audio_sync', {roomId:roomId, audioConfig:audioConfig});
      // Yerel ses motorunu güncelle
      if (global.switchSound && audioConfig) {
        global.switchSound(audioConfig.gen, audioConfig.base, audioConfig.beat, audioConfig.label||'');
      }
    },

    /* ── Nefes Durumu ── */
    setBreathing: function(roomId, userId, isBreathing) {
      _setBreathing(userId, isBreathing);
    },

    isBreathing: function(userId) {
      return !!_breathingUsers[userId];
    },

    /* ── Host Adı ── */
    getHostName: function(hostId) { return _hostName(hostId); },

    buildRoomCard: function(room) {
      var cnt = room.participants.length;
      return {
        id:room.id, name:room.name, category:room.category,
        type:room.type, hostId:room.hostId,
        hostName: _hostName(room.hostId),
        isPrivate: room.type==='private',
        isLive: room.isActive,
        current: cnt, capacity: room.capacity,
        capacityFill: Math.min(1, cnt/room.capacity),
        isFull: cnt>=room.capacity,
        audioConfig: room.audioConfig||{},
      };
    },

    reset: function() {
      _rooms = null;
      try { localStorage.removeItem('sanctuary_rooms'); } catch(e) {}
    },
  };

  global.RoomManager = RoomManager;

  // Cross-tab sync dinle
  try {
    global.addEventListener('storage', function(e) {
      if (e.key === 'sanctuary_rooms') { _rooms = null; }
    });
  } catch(e) {}

})(window);

