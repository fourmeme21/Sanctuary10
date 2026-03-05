
/* ── Global fonksiyon atamaları ── */
window.pickMood = function(el) {
  var mood  = el.getAttribute('data-mood');
  var emoji = el.querySelector('.ic').textContent;
  document.querySelectorAll('.mood-chip').forEach(function(c){ c.classList.remove('sel'); });
  el.classList.add('sel');
  var me=document.getElementById('s-emoji'), mm=document.getElementById('s-mood');
  if(me) me.textContent=emoji;
  if(mm) mm.textContent=mood;
  var msgs={'Huzursuz':'Huzursuzluk geçici bir misafir gibidir. Nefes al, buradasın.',
    'Yorgun':'Dinlenmek bir lüks değil, ihtiyaçtır. Kendine izin ver.',
    'Kaygılı':'Kaygı, zihninin seni koruma çabası. Şimdi güvendesin.',
    'Mutsuz':'Her duygu geçer. Bu da geçecek. Burada seninleyim.',
    'Sakin':'Sakinlik senin doğal halin. Onu koruyalım.',
    'Minnettar':'Minnettarlık kalbi açar, dünyayı aydınlatır.'};
  var msgEl=document.getElementById('s-message');
  if(msgEl) msgEl.textContent=msgs[mood]||'';
  var bgMap={'Huzursuz':'teal','Yorgun':'violet','Kaygılı':'sky','Mutsuz':'rose','Sakin':'teal','Minnettar':'gold'};
  if(typeof window.setBgMood==='function') window.setBgMood(bgMap[mood]||'teal');
  /* StateManager'a kaydet — global _activeMood yerine merkezi state */
  try {
    var sm = (typeof getStateManager === 'function') ? getStateManager() : null;
    if (sm && typeof sm.setSelectedMood === 'function') sm.setSelectedMood(mood);
  } catch(e) {}
  try{localStorage.setItem('lastMood',mood);localStorage.setItem('lastEmoji',emoji);
  localStorage.removeItem('lastGen');localStorage.removeItem('lastBase');localStorage.removeItem('lastBeat');}catch(e){}
};

window.openPaywall = function(){
  var o=document.getElementById('paywall-overlay');
  if(!o) return;
  o.style.display='flex';
  requestAnimationFrame(function(){ o.classList.add('show'); });
  document.body.style.overflow='hidden';
};

window.closePaywall = function(){
  var o=document.getElementById('paywall-overlay');
  if(!o) return;
  o.classList.remove('show');
  setTimeout(function(){ o.style.display='none'; document.body.style.overflow=''; }, 400);
};

window.saveJournalEntry = function(){
  var ta=document.getElementById('journal-textarea');
  var text=ta?ta.value.trim():'';
  if(!text) return;
  try{localStorage.setItem('lastJournal',text);localStorage.setItem('lastJournalDate',new Date().toISOString());}catch(e){}
  var st=document.getElementById('journal-save-status');
  if(st){st.textContent='✓ Kaydedildi';setTimeout(function(){st.textContent='';},2000);}
};

window.generateAIFreq = function(){
  var input=document.getElementById('ai-input');
  if(!input||!input.value.trim()){
    if(input){input.style.borderColor='rgba(255,100,100,0.5)';setTimeout(function(){input.style.borderColor='';},1500);}
    return;
  }
  var btn=document.getElementById('ai-generate-btn');
  if(btn){btn.disabled=true;btn.textContent='✦ Düşünüyor...';}
  setTimeout(function(){
    var lower=input.value.toLowerCase();
    var freq=432,beat=7,msg='Sana özel bir titreşim tasarlandı.';
    if(lower.includes('uyku')||lower.includes('yorgun')){freq=174;beat=4;msg='Derin uyku için delta dalgaları aktif.';}
    else if(lower.includes('kaygı')||lower.includes('stres')){freq=396;beat=6;msg='Kaygıyı serbest bırakan frekans.';}
    else if(lower.includes('odak')||lower.includes('çalış')){freq=40;beat=10;msg='Gamma dalgaları aktif. Odak derinleşiyor.';}
    else if(lower.includes('mutlu')||lower.includes('neşe')){freq=528;beat=10;msg='DNA tamiri frekansı.';}
    else if(lower.includes('huzur')||lower.includes('sakin')){freq=432;beat=7;msg='Evrenin doğal titreşimi.';}
    var re=document.getElementById('ai-result');
    var te=document.getElementById('ai-result-text');
    var fe=document.getElementById('ai-result-freq');
    if(te)te.textContent=msg;
    if(fe)fe.innerHTML='<span class="ai-freq-chip">'+freq+' Hz</span><span class="ai-freq-chip">Binaural '+beat+' Hz</span>';
    if(re)re.classList.add('show');
    if(btn){btn.disabled=false;btn.textContent="✦ Oracle'ı Uyandır";}
    try{localStorage.setItem('lastGen','binaural');localStorage.setItem('lastBase',freq);localStorage.setItem('lastBeat',beat);}catch(e){}
  },1200);
};

window.showAnalytics = function(){
  var sessions=parseInt(localStorage.getItem('sessionCount')||'0');
  var minutes=parseInt(localStorage.getItem('totalMinutes')||'0');
  var streak=parseInt(localStorage.getItem('currentStreak')||'0');
  var s=document.getElementById('stat-sessions');
  var m=document.getElementById('stat-minutes');
  var st=document.getElementById('stat-streak');
  if(s)s.textContent=sessions;
  if(m)m.textContent=minutes;
  if(st)st.textContent=streak;
  document.querySelectorAll('.screen').forEach(function(sc){sc.classList.remove('on');sc.classList.add('off');});
  var t=document.getElementById('screen-analytics');
  if(t){t.classList.remove('off');t.classList.add('on');}
  requestAnimationFrame(function(){
    var canvas=document.getElementById('analytics-canvas');
    if(!canvas)return;
    var ctx=canvas.getContext('2d'),W=canvas.offsetWidth||300,H=120;
    canvas.width=W;canvas.height=H;
    var days=['Pzt','Sal','Çar','Per','Cum','Cmt','Paz'];
    var vals=days.map(function(){return Math.floor(Math.random()*40);});
    vals[6]=minutes%40;
    var max=Math.max.apply(null,vals.concat([1]));
    ctx.clearRect(0,0,W,H);
    var barW=W/7*0.6,gap=W/7;
    days.forEach(function(day,i){
      var x=gap*i+gap*0.2,bh=(vals[i]/max)*(H-24),y=H-bh-20;
      var g=ctx.createLinearGradient(0,y,0,H-20);
      g.addColorStop(0,'rgba(201,169,110,0.8)');g.addColorStop(1,'rgba(201,169,110,0.15)');
      ctx.fillStyle=g;ctx.beginPath();
      if(ctx.roundRect)ctx.roundRect(x,y,barW,bh,4);else ctx.rect(x,y,barW,bh);
      ctx.fill();
      ctx.fillStyle='rgba(122,120,144,0.7)';ctx.font='9px sans-serif';
      ctx.textAlign='center';ctx.fillText(day,x+barW/2,H-4);
    });
  });
};
