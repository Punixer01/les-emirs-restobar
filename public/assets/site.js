
(function(){
  "use strict";
  var reduce=matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* intro + ready */
  function revealInView(){ var vh=innerHeight; document.querySelectorAll("[data-r]:not(.in)").forEach(function(el){ var r=el.getBoundingClientRect(); if(r.top<vh*0.95&&r.bottom>0) el.classList.add("in"); }); }
  function ready(){ document.body.classList.add("ready"); revealInView(); }
  var intro=document.getElementById("intro");
  function dismiss(){ if(intro){intro.classList.add("done"); setTimeout(function(){intro.style.display="none";},900);} ready(); }
  if(document.readyState==="loading") document.addEventListener("DOMContentLoaded", function(){ setTimeout(dismiss, reduce?0:300); });
  else setTimeout(dismiss, reduce?0:300);
  window.addEventListener("load", revealInView);
  setTimeout(function(){ if(!document.body.classList.contains("ready")) dismiss(); }, 1800);

  /* nav solid + progress rail + cinematic parallax (passive) */
  var nav=document.getElementById("nav"), rail=document.getElementById("rail");
  var vhv=document.querySelector(".vhero__video"), vhin=document.querySelector(".vhero__in");
  var pars=[].slice.call(document.querySelectorAll("[data-par]"));
  function onScroll(){
    var y=window.scrollY||0, vh=window.innerHeight;
    nav.classList.toggle("solid", y>30);
    var max=document.documentElement.scrollHeight-vh;
    if(rail) rail.style.transform="scaleX("+(max? Math.min(1,y/max):0)+")";
    if(vhv && y<vh*1.25){ vhv.style.transform="scale(1.08) translate3d(0,"+(y*0.14)+"px,0)"; }
    if(vhin && y<vh){ vhin.style.transform="translate3d(0,"+(y*0.24)+"px,0)"; vhin.style.opacity=Math.max(0,1-y/vh*1.1).toFixed(3); }
    for(var i=0;i<pars.length;i++){ var el=pars[i], r=el.parentElement.getBoundingClientRect();
      if(r.bottom>-100 && r.top<vh+100){ var mid=r.top+r.height/2-vh/2; el.style.transform="translate3d(0,"+(-mid*0.08).toFixed(1)+"px,0)"; } }
  }
  window.addEventListener("scroll", onScroll, {passive:true}); onScroll();
  /* muted autoplay can need a nudge */
  document.querySelectorAll("video").forEach(function(v){ var p=v.play&&v.play(); if(p&&p.catch)p.catch(function(){}); });

  /* mobile menu */
  var burger=document.getElementById("burger"), mobile=document.getElementById("mobile");
  function closeM(){ mobile.classList.remove("open"); nav.classList.remove("open"); document.body.classList.remove("locked"); }
  if(burger){ burger.addEventListener("click", function(){
    var o=mobile.classList.toggle("open"); nav.classList.toggle("open",o); document.body.classList.toggle("locked",o);
  }); }
  document.querySelectorAll("[data-anchor]").forEach(function(a){
    a.addEventListener("click", function(e){
      var h=a.getAttribute("href");
      if(h&&h.charAt(0)==="#"){ e.preventDefault(); closeM();
        var el=document.querySelector(h); if(el){ var y=el.getBoundingClientRect().top+window.scrollY-64; window.scrollTo({top:y,behavior:reduce?"auto":"smooth"}); } }
    });
  });

  /* reveals */
  var io=new IntersectionObserver(function(es){
    es.forEach(function(en){ if(en.isIntersecting){ en.target.classList.add("in"); io.unobserve(en.target); } });
  }, {threshold:0.16, rootMargin:"0px 0px -6% 0px"});
  document.querySelectorAll("[data-r]").forEach(function(el){ io.observe(el); });

  /* ---- analytics (best-effort, non-blocking) ---- */
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];}); }
  var VID; try{ VID=localStorage.getItem('emirs_vid'); if(!VID){ VID='v'+Date.now().toString(36)+Math.random().toString(36).slice(2,8); localStorage.setItem('emirs_vid',VID);} }catch(e){ VID='v'+Math.random().toString(36).slice(2,10); }
  var SID; try{ SID=sessionStorage.getItem('emirs_sid'); if(!SID){ SID='s'+Date.now().toString(36)+Math.random().toString(36).slice(2,6); sessionStorage.setItem('emirs_sid',SID);} }catch(e){ SID='s'+Math.random().toString(36).slice(2,8); }
  var DEV = matchMedia('(pointer:coarse)').matches ? 'mobile' : 'desktop';
  function track(type, meta){
    try{
      var m=Object.assign({sid:SID,vid:VID,device:DEV,ref:document.referrer||''}, meta||{});
      var body=JSON.stringify({type:type,path:location.pathname,meta:m});
      if(navigator.sendBeacon){ navigator.sendBeacon('/api/track', new Blob([body],{type:'application/json'})); }
      else { fetch('/api/track',{method:'POST',headers:{'content-type':'application/json'},body:body,keepalive:true}); }
    }catch(e){}
  }
  track('pageview');
  document.querySelectorAll('.nav__links a,.mobile a,.brand').forEach(function(a){ a.addEventListener('click',function(){ track('nav_click',{to:a.getAttribute('href')||''}); }); });
  document.querySelectorAll('a[href*="reserver"],a[href="#reserver"],.nav__cta').forEach(function(a){ a.addEventListener('click',function(){ track('cta_click',{cta:'reserver'}); }); });

  /* ---- reservation → real backend ---- */
  var form=document.getElementById("resaForm"), msg=document.getElementById("resaMsg"), formStarted=false;
  if(form){
    var d=document.getElementById("date"); if(d) d.min=new Date().toISOString().split("T")[0];
    form.addEventListener('focusin', function(){ if(!formStarted){ formStarted=true; track('form_start'); } });
    form.addEventListener("submit", function(e){
      e.preventDefault();
      if(form.company && form.company.value) return; // honeypot
      var nom=form.nom.value.trim(), tel=form.tel.value.trim();
      if(!nom||!tel||!form.date.value||!form.heure.value){
        msg.style.color="#a4552f"; msg.textContent="Merci de compléter nom, téléphone, date et heure."; return;
      }
      var party=parseInt((document.getElementById('couverts')||{}).value||'2',10)||2;
      var service=(document.getElementById('service')||{}).value||'dinner';
      var seating=(document.getElementById('place')||{}).value||'inside';
      var email=(form.email&&form.email.value.trim())||null;
      var btn=form.querySelector('button[type=submit]'); if(btn) btn.disabled=true;
      msg.style.color="var(--stone)"; msg.textContent="Envoi…";
      fetch('/api/reservations',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
        name:nom, phone:tel, email:email, date:form.date.value, time:form.heure.value,
        party:party, seating:seating, service:service
      })}).then(function(r){return r.json().then(function(res){return {status:r.status,res:res};});}).then(function(o){
        if(btn) btn.disabled=false;
        var res=o.res;
        if(o.status>=200 && o.status<300 && res && res.ok){
          msg.style.color="var(--marine)";
          msg.innerHTML="Merci "+esc(nom)+" — demande reçue. Référence : <b>"+esc(res.reference)+"</b>. Vous recevrez la confirmation "+(email?"par email":"par SMS / téléphone")+".";
          track('reservation_submit',{ref:res.reference, party:party, seating:seating});
          form.reset(); if(d) d.min=new Date().toISOString().split("T")[0];
        } else {
          msg.style.color="#a4552f"; msg.textContent=(res&&res.error)?res.error:"Un souci est survenu. Merci de réessayer ou de nous appeler.";
        }
      }).catch(function(){ if(btn) btn.disabled=false; msg.style.color="#a4552f"; msg.textContent="Connexion impossible. Merci de réessayer."; });
    });
  }

  document.getElementById("year").textContent=new Date().getFullYear();
})();



(function(){
  "use strict";
  function e(s){ return String(s==null?'':s).replace(/[&<>"']/g,function(x){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]; }); }
  /* CMS: apply owner-edited content (falls back silently to built-in content) */
  (async function(){
    try{
      var res=await fetch('/api/content'); if(!res.ok) return;
      var d=await res.json(); var c=d.content||{};
      function setText(id,val){ var el=document.getElementById(id); if(el && val) el.textContent=val; }
      setText('heroTag', c.tagline);
      if(c.hours){ setText('hLunch',c.hours.lunch); setText('hDinner',c.hours.dinner); setText('hDays',c.hours.days); }
      var ph=document.getElementById('cPhoneLink'); if(ph && c.phone){ ph.textContent=c.phone; ph.setAttribute('href','tel:'+c.phone.replace(/\s+/g,'')); }
      var fb=document.getElementById('cFbLink'); if(fb && c.facebook){ fb.setAttribute('href', c.facebook); }
      if(d.custom && Array.isArray(c.menu) && c.menu.length){
        var ml=document.getElementById('menuList');
        if(ml){ ml.innerHTML=c.menu.map(function(m){
          return '<div class="mrow"><div class="mrow__main">'+(m.cat?'<div class="mrow__cat">'+e(m.cat)+'</div>':'')+
            '<div class="mrow__name">'+e(m.name)+'</div>'+(m.desc?'<p class="mrow__desc">'+e(m.desc)+'</p>':'')+
            '</div><div class="mrow__price">'+e(m.price)+'<span>DT</span></div></div>'; }).join(''); }
      }
    }catch(err){ /* keep built-in content */ }
  })();
  /* Contact message form -> dashboard inbox */
  var mf=document.getElementById('msgForm');
  if(mf){ mf.addEventListener('submit', function(ev){
    ev.preventDefault();
    var body=document.getElementById('mBody').value.trim(), name=document.getElementById('mName').value.trim(), contact=document.getElementById('mContact').value.trim(), out=document.getElementById('mMsg');
    if(body.length<2){ out.style.color='#a4552f'; out.textContent='Merci d\'écrire votre message.'; return; }
    var payload={ name:name, body:body }; if(/@/.test(contact)) payload.email=contact; else if(contact) payload.phone=contact;
    out.style.color=''; out.textContent='Envoi…';
    fetch('/api/messages',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)})
      .then(function(r){ return r.json().catch(function(){return {};}); })
      .then(function(res){ if(res&&res.ok){ out.style.color='var(--marine)'; out.textContent='Merci — votre message a bien été envoyé.'; mf.reset(); } else { out.style.color='#a4552f'; out.textContent=(res&&res.error)||'Envoi impossible.'; } })
      .catch(function(){ out.style.color='#a4552f'; out.textContent='Envoi impossible.'; });
  }); }
})();

/* active nav highlight (multipage) */
(function(){
  var path=(location.pathname.replace(/index\.html$/,'').replace(/\/$/,''))||'/';
  document.querySelectorAll('.nav__links a,.mobile a').forEach(function(a){
    var h=a.getAttribute('href'); if(!h) return; var hp=h.replace(/\/$/,'')||'/';
    if(hp===path || (hp!=='/' && path.indexOf(hp)===0)) a.classList.add('active');
  });
})();

/* cinematic gallery + lightbox */
(function(){
  var slider=document.getElementById('gslider'); if(!slider) return;
  var track=slider.querySelector('.gtrack');
  var slides=[].slice.call(slider.querySelectorAll('.gslide'));
  var n=slides.length; if(!n) return;
  var idx=0, timer=null;
  var dotsWrap=document.getElementById('gdots'), count=document.getElementById('gcount');
  var data=slides.map(function(s){ var img=s.querySelector('img'); var cap=s.querySelector('figcaption'); return { src: img.getAttribute('data-full')||img.src, cap: cap?cap.textContent:(img.alt||'') }; });
  if(dotsWrap) dotsWrap.innerHTML=slides.map(function(_,i){return '<button class="gdot'+(i===0?' on':'')+'" data-i="'+i+'" aria-label="Photo '+(i+1)+'"></button>';}).join('');
  function upd(){ track.style.transform='translateX('+(-idx*100)+'%)'; if(dotsWrap)[].forEach.call(dotsWrap.children,function(d,j){d.classList.toggle('on',j===idx);}); if(count)count.textContent=(idx+1)+' / '+n; }
  function go(i){ idx=(i%n+n)%n; upd(); }
  function next(){go(idx+1);} function prev(){go(idx-1);}
  function play(){ stop(); timer=setInterval(next,5000); } function stop(){ if(timer){clearInterval(timer);timer=null;} }
  var np=document.getElementById('gNext'), pp=document.getElementById('gPrev');
  if(np)np.addEventListener('click',function(){next();play();});
  if(pp)pp.addEventListener('click',function(){prev();play();});
  if(dotsWrap)dotsWrap.addEventListener('click',function(e){var b=e.target.closest('.gdot');if(b){go(+b.getAttribute('data-i'));play();}});
  slider.addEventListener('mouseenter',stop); slider.addEventListener('mouseleave',play);
  var x0=null; slider.addEventListener('touchstart',function(e){x0=e.touches[0].clientX;stop();},{passive:true});
  slider.addEventListener('touchend',function(e){ if(x0==null)return; var dx=e.changedTouches[0].clientX-x0; if(Math.abs(dx)>45){ dx<0?next():prev(); } x0=null; play(); },{passive:true});
  upd(); play();

  /* lightbox */
  var lb=document.getElementById('glb'), lbImg=document.getElementById('glbImg'), lbCap=document.getElementById('glbCap');
  var li=0;
  function open(i){ li=i; show(); lb.classList.add('open'); document.body.classList.add('locked'); stop(); }
  function close(){ lb.classList.remove('open'); document.body.classList.remove('locked'); play(); }
  function show(){ lbImg.src=data[li].src; lbImg.alt=data[li].cap; if(lbCap)lbCap.textContent=data[li].cap; }
  function lnext(){ li=(li+1)%n; show(); } function lprev(){ li=(li-1+n)%n; show(); }
  slides.forEach(function(s,i){ s.addEventListener('click',function(){ open(i); }); });
  if(lb){
    document.getElementById('glbX').addEventListener('click',close);
    document.getElementById('glbNext').addEventListener('click',function(e){e.stopPropagation();lnext();});
    document.getElementById('glbPrev').addEventListener('click',function(e){e.stopPropagation();lprev();});
    lb.addEventListener('click',function(e){ if(e.target===lb) close(); });
    document.addEventListener('keydown',function(e){ if(!lb.classList.contains('open'))return; if(e.key==='Escape')close(); else if(e.key==='ArrowRight')lnext(); else if(e.key==='ArrowLeft')lprev(); });
    var lx0=null; lb.addEventListener('touchstart',function(e){lx0=e.touches[0].clientX;},{passive:true});
    lb.addEventListener('touchend',function(e){ if(lx0==null)return; var dx=e.changedTouches[0].clientX-lx0; if(Math.abs(dx)>45){dx<0?lnext():lprev();} lx0=null; },{passive:true});
  }
})();
