const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');
const UI = {
  level: document.getElementById('levelDisplay'), score: document.getElementById('scoreDisplay'),
  best: document.getElementById('bestDisplay'), lives: document.getElementById('livesDisplay'),
  meter: document.getElementById('levelMeter'), overlay: document.getElementById('startOverlay'),
  start: document.getElementById('startButton'), message: document.getElementById('stageMessage'),
  sound: document.getElementById('soundButton'), soundIcon: document.getElementById('soundIcon')
};

const W = canvas.width, H = canvas.height;
const colors = ['#21e5ff', '#9d5cff', '#ff5b8a', '#ffae45', '#63ed9e'];
let state = 'menu', level = 1, score = 0, lives = 3, best = Number(localStorage.getItem('neonBreakerBest') || 0);
let paddle, balls = [], bricks = [], powerups = [], particles = [], keys = {}, soundOn = true, lastTime = 0, raf;
let audioCtx;

function beep(freq = 260, duration = .04, type = 'square', volume = .025) {
  if (!soundOn) return;
  audioCtx ??= new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioCtx.createOscillator(), gain = audioCtx.createGain();
  osc.type = type; osc.frequency.value = freq; gain.gain.setValueAtTime(volume, audioCtx.currentTime);
  gain.gain.exponentialRampToValueAtTime(.0001, audioCtx.currentTime + duration);
  osc.connect(gain).connect(audioCtx.destination); osc.start(); osc.stop(audioCtx.currentTime + duration);
}

function resetPaddle() { paddle = { x: W / 2 - 70, y: H - 48, w: 140, h: 15, speed: 620, wideUntil: 0 }; }
function makeBall(x = W / 2, y = H - 69, stuck = true, angle = -Math.PI / 3) {
  const speed = 360 + Math.min(level * 12, 110);
  return { x, y, r: 8, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, stuck, trail: [] };
}

function buildLevel() {
  bricks = []; powerups = []; particles = [];
  const cols = 11, rows = Math.min(4 + Math.floor(level / 2), 7), gap = 8, margin = 54;
  const bw = (W - margin * 2 - gap * (cols - 1)) / cols, bh = 27;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    let present = true;
    const pattern = (level - 1) % 5;
    if (pattern === 1) present = !(r % 2 && c % 2);
    if (pattern === 2) present = Math.abs(c - 5) <= r + 1 || r === 0;
    if (pattern === 3) present = (c + r) % 3 !== 0 || r === rows - 1;
    if (pattern === 4) present = c === 0 || c === 10 || r === 0 || r === rows - 1 || (c > 3 && c < 7);
    if (!present) continue;
    const maxHp = 1 + Math.floor((level - 1) / 2) + ((r + c + level) % 7 === 0 ? 1 : 0);
    bricks.push({ x: margin + c * (bw + gap), y: 72 + r * (bh + gap), w: bw, h: bh, hp: maxHp, maxHp, color: colors[r % colors.length], power: Math.random() < .18 });
  }
}

function setupGame(fresh = true) {
  if (fresh) { level = 1; score = 0; lives = 3; }
  resetPaddle(); balls = [makeBall()]; buildLevel(); state = 'ready'; UI.overlay.classList.remove('visible'); updateUI();
  showMessage(`關卡 ${String(level).padStart(2, '0')}`, 900);
}

function launch() {
  if (state === 'menu' || state === 'gameover') return setupGame(true);
  if (state === 'ready') { balls.forEach(b => b.stuck = false); state = 'playing'; beep(420, .08, 'sine'); }
  else if (state === 'playing') { state = 'paused'; showMessage('PAUSED'); }
  else if (state === 'paused') { state = 'playing'; hideMessage(); }
}

function updateUI() {
  UI.level.textContent = String(level).padStart(2, '0');
  UI.score.textContent = String(score).padStart(3, '0');
  UI.best.textContent = String(best).padStart(3, '0');
  UI.meter.style.width = `${Math.min(100, 10 + level * 9)}%`;
  UI.lives.innerHTML = Array.from({ length: 3 }, (_, i) => `<span class="life ${i >= lives ? 'empty' : ''}"></span>`).join('');
  UI.lives.setAttribute('aria-label', `${lives} 條生命`);
}

function showMessage(text, timeout = 0) {
  UI.message.innerHTML = text; UI.message.classList.add('show');
  clearTimeout(showMessage.timer); if (timeout) showMessage.timer = setTimeout(hideMessage, timeout);
}
function hideMessage() { UI.message.classList.remove('show'); }

function spawnParticles(x, y, color, count = 8) {
  for (let i = 0; i < count; i++) particles.push({ x, y, vx: (Math.random()-.5)*220, vy: (Math.random()-.5)*220, life: .55+Math.random()*.3, color, size: 2+Math.random()*3 });
}

function spawnPower(brick) {
  const types = ['multi', 'wide', 'fast', 'slow'];
  const type = types[Math.floor(Math.random() * types.length)];
  powerups.push({ x: brick.x + brick.w/2, y: brick.y + brick.h/2, vy: 125, type, r: 13 });
}

function applyPower(type) {
  const names = { multi: '分裂核心', wide: '磁場擴張', fast: '超頻脈衝', slow: '時間緩速' };
  if (type === 'multi') {
    const source = balls[0]; if (source) balls.push(makeBall(source.x, source.y, false, Math.atan2(source.vy, source.vx) - .65));
  } else if (type === 'wide') { paddle.w = 210; paddle.wideUntil = performance.now() + 10000; }
  else balls.forEach(b => { const factor = type === 'fast' ? 1.28 : .76; b.vx *= factor; b.vy *= factor; });
  showMessage(names[type], 650); beep(type === 'slow' ? 220 : 620, .16, 'sine', .035);
}

function circleRect(ball, rect) {
  const cx = Math.max(rect.x, Math.min(ball.x, rect.x + rect.w));
  const cy = Math.max(rect.y, Math.min(ball.y, rect.y + rect.h));
  const dx = ball.x - cx, dy = ball.y - cy;
  return dx*dx + dy*dy < ball.r*ball.r;
}

function update(dt, time) {
  if (!['playing','ready'].includes(state)) return;
  if (keys.ArrowLeft || keys.a) paddle.x -= paddle.speed * dt;
  if (keys.ArrowRight || keys.d) paddle.x += paddle.speed * dt;
  if (paddle.wideUntil && time > paddle.wideUntil) { paddle.w = Math.max(140, paddle.w - 160*dt); if (paddle.w <= 140) paddle.wideUntil = 0; }
  paddle.x = Math.max(8, Math.min(W - paddle.w - 8, paddle.x));

  balls.forEach(ball => {
    if (ball.stuck) { ball.x = paddle.x + paddle.w/2; ball.y = paddle.y - 13; return; }
    ball.trail.unshift({x:ball.x,y:ball.y}); if (ball.trail.length > 9) ball.trail.pop();
    ball.x += ball.vx * dt; ball.y += ball.vy * dt;
    if (ball.x < ball.r) { ball.x = ball.r; ball.vx = Math.abs(ball.vx); beep(180); }
    if (ball.x > W-ball.r) { ball.x = W-ball.r; ball.vx = -Math.abs(ball.vx); beep(180); }
    if (ball.y < ball.r) { ball.y = ball.r; ball.vy = Math.abs(ball.vy); beep(180); }
    if (ball.vy > 0 && circleRect(ball, paddle)) {
      ball.y = paddle.y-ball.r; const offset = (ball.x-(paddle.x+paddle.w/2))/(paddle.w/2);
      const speed = Math.hypot(ball.vx,ball.vy); ball.vx = offset*speed*.92; ball.vy = -Math.sqrt(Math.max(speed*speed-ball.vx*ball.vx, speed*speed*.25)); beep(340,.04);
    }
    for (let i=bricks.length-1; i>=0; i--) {
      const b=bricks[i]; if (!circleRect(ball,b)) continue;
      const prevX=ball.x-ball.vx*dt, prevY=ball.y-ball.vy*dt;
      if (prevX < b.x || prevX > b.x+b.w) ball.vx*=-1; else ball.vy*=-1;
      b.hp--; spawnParticles(ball.x,ball.y,b.color,b.hp<=0?11:4); beep(b.hp<=0?520:280,.045,'square');
      if (b.hp<=0) { if (b.power) spawnPower(b); bricks.splice(i,1); } break;
    }
  });
  balls = balls.filter(b => b.y < H+35);

  powerups.forEach(p => p.y += p.vy*dt);
  for (let i=powerups.length-1;i>=0;i--) {
    const p=powerups[i]; if (p.y+p.r>paddle.y && p.y-p.r<paddle.y+paddle.h && p.x>paddle.x && p.x<paddle.x+paddle.w) { applyPower(p.type); powerups.splice(i,1); }
    else if (p.y>H+20) powerups.splice(i,1);
  }
  particles.forEach(p => {p.x+=p.vx*dt;p.y+=p.vy*dt;p.vy+=140*dt;p.life-=dt;}); particles=particles.filter(p=>p.life>0);

  if (!balls.length) loseLife();
  if (!bricks.length && state==='playing') nextLevel();
}

function loseLife() {
  lives--; updateUI(); beep(90,.35,'sawtooth',.04);
  if (lives<=0) {
    state='gameover'; if(score>best){best=score;localStorage.setItem('neonBreakerBest',best);} updateUI();
    UI.overlay.querySelector('h1').textContent='訊號中斷'; UI.overlay.querySelector('p').innerHTML=`你突破了 <b>${score}</b> 層光牆。<br>最高紀錄：${best}`;
    UI.start.innerHTML='重新啟動 <span>→</span>'; UI.overlay.classList.add('visible');
  } else { resetPaddle(); balls=[makeBall()]; state='ready'; showMessage('生命損失<br><small>按 SPACE 繼續</small>',900); }
}

function nextLevel() {
  state='transition'; score++; level++; if(score>best){best=score;localStorage.setItem('neonBreakerBest',best);} updateUI();
  showMessage('光牆清除<br><small>下一層載入中</small>'); beep(740,.32,'sine',.045);
  setTimeout(()=>{resetPaddle();balls=[makeBall()];buildLevel();state='ready';updateUI();showMessage(`關卡 ${String(level).padStart(2,'0')}<br><small>按 SPACE 發射</small>`,1100);},1300);
}

function drawBackground() {
  ctx.fillStyle='#050914';ctx.fillRect(0,0,W,H);
  ctx.strokeStyle='rgba(44,122,160,.09)';ctx.lineWidth=1;
  for(let x=0;x<W;x+=40){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke();}
  for(let y=0;y<H;y+=40){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke();}
  const g=ctx.createRadialGradient(W/2,H*.55,0,W/2,H*.55,W*.6);g.addColorStop(0,'rgba(17,85,115,.1)');g.addColorStop(1,'transparent');ctx.fillStyle=g;ctx.fillRect(0,0,W,H);
}

function roundRect(x,y,w,h,r=5){ctx.beginPath();ctx.roundRect(x,y,w,h,r);}
function draw() {
  drawBackground();
  bricks.forEach(b=>{
    ctx.save();ctx.shadowColor=b.color;ctx.shadowBlur=b.power?16:5;
    const alpha=.35+.65*(b.hp/b.maxHp);ctx.fillStyle=b.color;ctx.globalAlpha=alpha;roundRect(b.x,b.y,b.w,b.h,3);ctx.fill();
    ctx.globalAlpha=1;ctx.fillStyle='rgba(255,255,255,.28)';ctx.fillRect(b.x+4,b.y+3,b.w-8,2);
    if(b.maxHp>1){ctx.fillStyle='rgba(2,7,15,.7)';ctx.font='600 10px Chakra Petch';ctx.textAlign='center';ctx.fillText(b.hp,b.x+b.w/2,b.y+b.h/2+4);}
    if(b.power){ctx.strokeStyle='rgba(255,255,255,.7)';ctx.strokeRect(b.x+b.w-10,b.y+5,4,4);}ctx.restore();
  });
  powerups.forEach(p=>{const map={multi:['+1','#21e5ff'],wide:['↔','#9d5cff'],fast:['»','#ff9c42'],slow:['⌁','#63ed9e']}, [label,color]=map[p.type];ctx.save();ctx.translate(p.x,p.y);ctx.rotate(performance.now()/700);ctx.strokeStyle=color;ctx.shadowColor=color;ctx.shadowBlur=18;ctx.lineWidth=2;ctx.strokeRect(-p.r,-p.r,p.r*2,p.r*2);ctx.rotate(-performance.now()/700);ctx.fillStyle='#eaffff';ctx.font='700 11px Chakra Petch';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(label,0,0);ctx.restore();});
  balls.forEach(b=>{b.trail.forEach((t,i)=>{ctx.fillStyle=`rgba(39,230,255,${(1-i/b.trail.length)*.18})`;ctx.beginPath();ctx.arc(t.x,t.y,b.r*(1-i/b.trail.length),0,Math.PI*2);ctx.fill();});ctx.save();ctx.fillStyle='#eaffff';ctx.shadowColor='#27e6ff';ctx.shadowBlur=18;ctx.beginPath();ctx.arc(b.x,b.y,b.r,0,Math.PI*2);ctx.fill();ctx.restore();});
  if(paddle){ctx.save();ctx.shadowColor='#27e6ff';ctx.shadowBlur=18;const pg=ctx.createLinearGradient(paddle.x,0,paddle.x+paddle.w,0);pg.addColorStop(0,'#168ca6');pg.addColorStop(.5,'#d7fbff');pg.addColorStop(1,'#168ca6');ctx.fillStyle=pg;roundRect(paddle.x,paddle.y,paddle.w,paddle.h,6);ctx.fill();ctx.fillStyle='#fff';ctx.fillRect(paddle.x+paddle.w*.25,paddle.y+2,paddle.w*.5,2);ctx.restore();}
  particles.forEach(p=>{ctx.globalAlpha=Math.max(0,p.life);ctx.fillStyle=p.color;ctx.fillRect(p.x,p.y,p.size,p.size);});ctx.globalAlpha=1;
}

function loop(time=0){const dt=Math.min((time-lastTime)/1000,.025)||0;lastTime=time;update(dt,time);draw();raf=requestAnimationFrame(loop);}

function pointerMove(e){const rect=canvas.getBoundingClientRect();const clientX=e.touches?e.touches[0].clientX:e.clientX;const x=(clientX-rect.left)*(W/rect.width);if(paddle)paddle.x=Math.max(8,Math.min(W-paddle.w-8,x-paddle.w/2));}
window.addEventListener('keydown',e=>{keys[e.key]=true;if(e.code==='Space'){e.preventDefault();launch();}});
window.addEventListener('keyup',e=>keys[e.key]=false);
canvas.addEventListener('mousemove',pointerMove);canvas.addEventListener('touchmove',e=>{e.preventDefault();pointerMove(e);},{passive:false});canvas.addEventListener('click',()=>{if(state==='ready')launch();});
UI.start.addEventListener('click',()=>setupGame(true));
UI.sound.addEventListener('click',()=>{soundOn=!soundOn;UI.soundIcon.textContent=soundOn?'◖))':'◖×';});
const dialog=document.getElementById('helpDialog');document.getElementById('helpButton').addEventListener('click',()=>dialog.showModal());document.getElementById('closeHelp').addEventListener('click',()=>dialog.close());

resetPaddle();balls=[makeBall()];buildLevel();updateUI();loop();
