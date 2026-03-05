/* ══════════════════════════════════════════════════════════════
   RoomManager.js — Sanctuary Adım 8 (Host-Centric)
   Host müzik parametrelerini yayınlar, Listener'lar uygular
   ══════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  var _userId     = _genId();
  var _role       = null;   /* 'host' | 'listener' | null */
  var _activeRoom = null;
  var _peers      = {};
  var _channels   = {};
  var _rooms      = [];

  /* BroadcastChannel — aynı ağda sekme/pencere testi için
     Gerçek deployment'ta WebSocket sinyali ile değiştirilir */
  var _bc = (typeof BroadcastChannel !== 'undefined')
    ? new BroadcastChannel('sanctuary_room') : null;

  function _genId() {
    return Math.random().toString(36).slice(2,8).toUpperCase();
  }
  function _genCode() {
    return Math.random().toString(36).slice(2,7).toUpperCase();
  }

  /* ── Sinyal ── */
  function _signal(type, data) {
    if (_bc) _bc.postMessage({ type:type, from:_userId, data:data });
  }

  if (_bc) {
    _bc.onmessage = function(e) {
      var m = e.data;
      if (!m || m.from === _userId) return;
      if (m.type === 'offer')      _handleOffer(m.from, m.data);
      if (m.type === 'answer')     _handleAnswer(m.from, m.data);
      if (m.type === 'candidate')  _handleIce(m.from, m.data);
      if (m.type === 'joinReq')    _handleJoinRequest(m.from, m.data);
    };
  }

  /* ── WebRTC ── */
  function _createPeer(peerId, initiator) {
    if (_peers[peerId]) return _peers[peerId];
    var pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    _peers[peerId] = pc;

    pc.onicecandidate = function(e) {
      if (e.candidate) _signal('candidate', { to:peerId, candidate:e.candidate });
    };
    pc.ondatachannel = function(e) { _setupChannel(peerId, e.channel); };

    if (initiator) {
      var ch = pc.createDataChannel('sanctuary');
      _setupChannel(peerId, ch);
      pc.createOffer()
        .then(function(o){ return pc.setLocalDescription(o); })
        .then(function(){ _signal('offer', { to:peerId, sdp:pc.localDescription }); })
        .catch(function(e){ console.warn('[RM] offer err', e); });
    }
    return pc;
  }

  function _setupChannel(peerId, ch) {
    _channels[peerId] = ch;
    ch.onopen    = function() { console.info('[RM] Kanal açık:', peerId); _updatePanel(); };
    ch.onclose   = function() { delete _channels[peerId]; _updatePanel(); };
    ch.onmessage = function(e) {
      try { _handleRemoteCommand(JSON.parse(e.data)); } catch(err){}
    };
  }

  function _handleOffer(from, data) {
    var pc = _createPeer(from, false);
    pc.setRemoteDescription(new RTCSessionDescription(data.sdp))
      .then(function(){ return pc.createAnswer(); })
      .then(function(a){ return pc.setLocalDescription(a); })
      .then(function(){ _signal('answer', { to:from, sdp:pc.localDescription }); })
      .catch(function(e){ console.warn('[RM] answer err', e); });
  }
  function _handleAnswer(from, data) {
    var pc = _peers[from];
    if (pc) pc.setRemoteDescription(new RTCSessionDescription(data.sdp)).catch(function(){});
  }
  function _handleIce(from, data) {
    var pc = _peers[from];
    if (pc && data.candidate)
      pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(function(){});
  }
  function _handleJoinRequest(from, data) {
    if (_role !== 'host') return;
    if (_activeRoom && _activeRoom.members.length < _activeRoom.capacity) {
      _activeRoom.members.push({ id:from, name:data.name||'Dinleyici' });
      _createPeer(from, true);
      _updatePanel();
    }
  }

  /* ── Host: ses parametrelerini yayınla ── */
  function broadcastAudioState() {
    if (_role !== 'host') return;
    var state = {
      gen   : window._lastGen  || '',
      base  : window._lastBase || 0,
      beat  : window._lastBeat || 0,
      volume: window._masterVolume || 0.8,
    };
    var cmd = JSON.stringify({ action:'applyRemoteState', data:state, ts:Date.now() });
    Object.values(_channels).forEach(function(ch) {
      if (ch.readyState === 'open') { try{ ch.send(cmd); }catch(e){} }
    });
  }

  /* ── Listener: Host'tan gelen komutu uygula ── */
  function _handleRemoteCommand(cmd) {
    if (cmd.action === 'applyRemoteState') {
      window.applyRemoteState && window.applyRemoteState(cmd.data);
    }
    if (cmd.action === 'syncStart') {
      window.syncStart && window.syncStart(cmd.data.timestamp);
    }
    if (cmd.action === 'syncStop') {
      if (window._playing) window.togglePlay && window.togglePlay();
    }
  }

  /* ── Public: Oda Kur ── */
  function createRoom(name, category, capacity) {
    _role = 'host';
    _activeRoom = {
      id      : _genId(),
      code    : _genCode(),
      name    : name || 'Sanctuary Odası',
      category: category || 'meditasyon',
      capacity: capacity || 8,
      hostId  : _userId,
      members : [{ id:_userId, name:'Sen (Host)', isHost:true }],
    };
    _rooms.unshift(_activeRoom);
    _showPanel();
    _updatePanel();

    /* Her 2 saniyede bir ses durumunu yayınla */
    window._rmBroadcastInterval = setInterval(broadcastAudioState, 2000);
    console.info('[RM] Oda kuruldu:', _activeRoom.code);
    return _activeRoom;
  }

  /* ── Public: Odaya Katıl ── */
  function joinRoom(code) {
    var room = _rooms.find(function(r){ return r.code === code.toUpperCase(); });
    if (!room) {
      /* Aynı ağda değilse sinyal gönder */
      _signal('joinReq', { code:code.toUpperCase(), name:'Dinleyici' });
      _activeRoom = { code:code.toUpperCase(), name:'Bağlanıyor...', members:[] };
      _role = 'listener';
      _showPanel();
      return;
    }
    _role = 'listener';
    _activeRoom = room;
    room.members.push({ id:_userId, name:'Dinleyici' });
    _createPeer(room.hostId, true);
    _showPanel();
    _updatePanel();
  }

  /* ── Public: Ayrıl ── */
  function leaveRoom() {
    clearInterval(window._rmBroadcastInterval);
    Object.values(_peers).forEach(function(pc){ try{pc.close();}catch(e){} });
    _peers={}; _channels={}; _activeRoom=null; _role=null;
    _hidePanel();
  }

  function broadcastCommand(action, data) {
    var cmd = JSON.stringify({ action:action, data:data, ts:Date.now() });
    Object.values(_channels).forEach(function(ch){
      if (ch.readyState==='open') { try{ ch.send(cmd); }catch(e){} }
    });
  }

  /* ── Panel UI ── */
  function _showPanel() {
    var p = document.getElementById('room-panel');
    if (p) p.classList.add('active');
    var roleEl = document.getElementById('room-panel-role');
    if (roleEl) roleEl.textContent = _role === 'host' ? '👑 Yönetici' : '🎧 Dinleyici';
    var codeEl = document.getElementById('room-panel-code');
    if (codeEl && _activeRoom) codeEl.textContent = _activeRoom.code;
    _updatePanel();
  }

  function _hidePanel() {
    var p = document.getElementById('room-panel');
    if (p) p.classList.remove('active');
  }

  function _updatePanel() {
    if (!_activeRoom) return;
    var listEl = document.getElementById('room-panel-members');
    if (listEl) {
      listEl.innerHTML = (_activeRoom.members||[]).map(function(m){
        return '<div class="rp-member"><span class="rp-dot'+(m.isHost?' host':'')+'"></span>'+
               '<span>'+(m.name||'Kullanıcı')+'</span></div>';
      }).join('');
    }
    var qEl = document.getElementById('room-panel-quality');
    if (qEl) {
      var open = Object.values(_channels).filter(function(c){return c.readyState==='open';}).length;
      qEl.textContent = open>0 ? '🟢 '+open+' bağlı' : (_role==='host'?'⚪ Dinleyici bekleniyor':'⚪ Bağlanıyor...');
    }
  }

  function getPublicRooms(filter) {
    if (!filter||filter==='all') return _rooms;
    return _rooms.filter(function(r){ return r.category===filter; });
  }

  window.RoomManager = {
    createRoom      : createRoom,
    joinRoom        : joinRoom,
    leaveRoom       : leaveRoom,
    broadcastCommand: broadcastCommand,
    broadcastAudioState: broadcastAudioState,
    getPublicRooms  : getPublicRooms,
    getRole         : function(){ return _role; },
    getActiveRoom   : function(){ return _activeRoom; },
    getUserId       : function(){ return _userId; },
  };

  console.info('[RoomManager] Host-Centric v8 hazır. userId:', _userId);
})();