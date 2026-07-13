// ============================================
// 打字练习 — 核心游戏逻辑 v2 (句子特化版)
// ============================================

(function () {
  'use strict';

  // --- DOM ---
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const scoreEl = $('#scoreValue');
  const comboEl = $('#comboValue');
  const accuracyEl = $('#accuracyValue');
  const wpmEl = $('#wpmValue');
  const practiceArea = $('#practiceArea');
  const btnStart = $('#btnStart');
  const keyboard = $('#keyboard');
  const lessonSelector = $('#lessonSelector');
  const celebration = $('#celebration');
  const celebrationTitle = $('#celebrationTitle');
  const celebrationStats = $('#celebrationStats');
  const btnContinue = $('#btnContinue');
  const soundToggle = $('#soundToggle');
  const highlightToggle = $('#highlightToggle');
  const highlightStatus = $('#highlightStatus');
  const highlightIcon = $('#highlightIcon');
  const highlightToggleBar = $('#highlightToggleBar');

  // --- State ---
  let currentMode = 'sentences'; // 'sentences' | 'favorites'
  let isPlaying = false;
  let soundEnabled = true;
  let highlightEnabled = false;
  let chineseHintEnabled = true;
  let audioDictationEnabled = false;

  // Game stats
  let score = 0;
  let combo = 0;
  let maxCombo = 0;
  let totalKeys = 0;
  let correctKeys = 0;
  let startTime = 0;
  let charCount = 0;

  // Current challenge
  let targetChars = [];
  let currentIndex = 0;
  let currentWrongCount = 0;
  let challengeQueue = [];
  let queueIndex = 0;

  // Word mode
  let selectedLesson = 1;
  let selectedFavLesson = 'all'; // 'all' or a lesson key number
  let selectedType = 'sentences'; // 'phrases' | 'sentences'

  // Track if current word had any errors (for auto-add to favorites)
  let currentWordHadError = false;

  // --- Favorites (localStorage) ---
  const FAV_KEY = 'typing_master_sentences_favorites';

  function loadFavorites() {
    try {
      const favs = JSON.parse(localStorage.getItem(FAV_KEY)) || [];
      return favs.map(f => ({
        ...f,
        correctStreak: f.correctStreak || 0,
        lesson: f.lesson || 0,
        lessonTitle: f.lessonTitle || ''
      }));
    } catch { return []; }
  }

  function saveFavorites(favs) {
    localStorage.setItem(FAV_KEY, JSON.stringify(favs));
    updateFavBadge();
  }

  function addToFavorites(en, cn, lesson, lessonTitle) {
    const favs = loadFavorites();
    const existing = favs.find(f => f.en.toLowerCase() === en.toLowerCase());
    if (existing) {
      existing.correctStreak = 0;
      saveFavorites(favs);
    } else {
      favs.push({ en, cn, lesson: lesson || 0, lessonTitle: lessonTitle || '', correctStreak: 0 });
      saveFavorites(favs);
    }
  }

  function recordFavCorrect(en) {
    const favs = loadFavorites();
    const fav = favs.find(f => f.en.toLowerCase() === en.toLowerCase());
    if (fav) {
      fav.correctStreak = (fav.correctStreak || 0) + 1;
      if (fav.correctStreak >= 5) {
        const filtered = favs.filter(f => f.en.toLowerCase() !== en.toLowerCase());
        saveFavorites(filtered);
        return true;
      }
      saveFavorites(favs);
    }
    return false;
  }

  function recordFavWrong(en) { }

  function removeFromFavorites(en) {
    let favs = loadFavorites();
    favs = favs.filter(f => f.en.toLowerCase() !== en.toLowerCase());
    saveFavorites(favs);
  }

  function clearAllFavorites() {
    saveFavorites([]);
  }

  function updateFavBadge() {
    const badge = $('.fav-badge');
    if (!badge) return;
    const count = loadFavorites().length;
    badge.textContent = count;
    badge.classList.toggle('hidden', count === 0);
  }

  // --- NCE Audio Integration ---
  const NCEAudio = {
    bookData: null,
    cache: {},
    
    async getBookData() {
      if (this.bookData) return this.bookData;
      try {
        const res = await fetch('https://nce.mleo.site/NCE1/book.json');
        this.bookData = await res.json();
      } catch (e) {
        console.error("NCE Book data fetch error", e);
      }
      return this.bookData;
    },

    parseLRC(text) {
      const lines = text.split('\n');
      const result = [];
      const timeReg = /\[(\d{2}):(\d{2})\.(\d{2})\]/;
      for (const line of lines) {
         const match = line.match(timeReg);
         if (match) {
            const min = parseInt(match[1]);
            const sec = parseInt(match[2]);
            const ms = parseInt(match[3]);
            const time = min * 60 + sec + ms / 100;
            const content = line.replace(timeReg, '').trim();
            const en = content.split('|')[0].trim();
            result.push({ time, en, raw: line });
         }
      }
      return result;
    },

    async loadLesson(lessonNum) {
      if (this.cache[lessonNum]) return this.cache[lessonNum];
      
      const book = await this.getBookData();
      if (!book) return null;
      
      const unitIndex = Math.floor((lessonNum - 1) / 2);
      if (unitIndex < 0 || unitIndex >= book.units.length) return null;
      
      const filename = book.units[unitIndex].filename.replace(/&/g, '%26').replace(/ /g, '%20');
      const audioUrl = `https://nce.mleo.site/NCE1/${filename}.mp3`;
      const lrcUrl = `https://nce.mleo.site/NCE1/${filename}.lrc`;
      
      try {
        const res = await fetch(lrcUrl);
        if (!res.ok) throw new Error('LRC not found');
        const text = await res.text();
        const lrc = this.parseLRC(text);
        const audio = new Audio(audioUrl);
        audio.preload = 'auto';
        
        const matchedSentences = {}; 
        const lessonData = typeof nceSentences !== 'undefined' ? nceSentences[lessonNum] : null;
        if (lessonData && lessonData.sentences) {
           let lrcIndex = 0;
                   for (const sentence of lessonData.sentences) {
                      const sentenceEn = sentence.en || sentence.english;
                      if (!sentenceEn) continue;
                      const cleanTarget = sentenceEn.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                      
                      let matched = false;
                      for (let j = lrcIndex; j < lrc.length; j++) {
                         let concatenatedLrc = '';
                         for (let k = j; k < lrc.length; k++) {
                             concatenatedLrc += lrc[k].en.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
                             if (concatenatedLrc === cleanTarget) {
                                matchedSentences[sentenceEn] = {
                                   start: lrc[j].time,
                                   end: (k + 1 < lrc.length) ? lrc[k + 1].time : lrc[k].time + 5
                                };
                                lrcIndex = k + 1;
                                matched = true;
                                break;
                             }
                             if (concatenatedLrc.length > cleanTarget.length) {
                                break;
                             }
                         }
                         if (matched) break;
                      }
                   }
        }
        
        this.cache[lessonNum] = { audio, lrc, matchedSentences };
        return this.cache[lessonNum];
      } catch (e) {
        console.error("NCE Lesson load error", e);
        return null;
      }
    },
    
    currentAudioObj: null,
    audioInterval: null,
    playId: 0,
    
    async playSentence(text, lessonNum) {
      const lessonData = await this.loadLesson(lessonNum);
      if (!lessonData) return false;
      
      let match = lessonData.matchedSentences[text];
      if (!match) {
        const cleanTarget = text.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
        let matched = false;
        for (let j = 0; j < lessonData.lrc.length; j++) {
           let concatenatedLrc = '';
           for (let k = j; k < lessonData.lrc.length; k++) {
               concatenatedLrc += lessonData.lrc[k].en.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
               if (concatenatedLrc === cleanTarget) {
                  match = {
                     start: lessonData.lrc[j].time,
                     end: (k + 1 < lessonData.lrc.length) ? lessonData.lrc[k + 1].time : lessonData.lrc[k].time + 5
                  };
                  lessonData.matchedSentences[text] = match;
                  matched = true;
                  break;
               }
               if (concatenatedLrc.length > cleanTarget.length) {
                  break;
               }
           }
           if (matched) break;
        }
      }
      
      if (!match) return false;
      
      const currentPlayId = ++this.playId;
      
      if (this.currentAudioObj) {
        this.currentAudioObj.pause();
      }
      if (this.audioInterval) {
        clearInterval(this.audioInterval);
        this.audioInterval = null;
      }
      
      const audio = lessonData.audio;
      const actualStart = Math.max(0, match.start - 0.15);
      const actualEnd = match.end - 0.15;
      
      if (audio.readyState >= 1) {
          audio.currentTime = actualStart;
      } else {
          await new Promise(resolve => {
              audio.addEventListener('loadedmetadata', resolve, { once: true });
              // 兜底：如果元数据加载失败，3秒后强制继续
              setTimeout(resolve, 3000);
          });
          audio.currentTime = actualStart;
      }
      
      try {
        await audio.play();
        if (this.playId !== currentPlayId) {
            audio.pause();
            return false;
        }
        this.currentAudioObj = audio;
        
        return new Promise((resolve) => {
           this.audioInterval = setInterval(() => {
               if (audio.currentTime >= actualEnd) {
                   audio.pause();
                   clearInterval(this.audioInterval);
                   this.audioInterval = null;
                   resolve(true);
               }
           }, 30);
           
           // 兜底超时
           setTimeout(() => {
               if (this.audioInterval) {
                   audio.pause();
                   clearInterval(this.audioInterval);
                   this.audioInterval = null;
                   resolve(true);
               }
           }, (actualEnd - actualStart) * 1000 + 800);
        });
      } catch(e) {
        console.error("Audio play error", e);
        return false;
      }
    }
  };

  // --- Audio (Web Audio API) ---
  let audioCtx = null;
  function getAudioCtx() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function playTone(freq, duration, type = 'sine', volume = 0.15) {
    if (!soundEnabled) return;
    try {
      const ctx = getAudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type; osc.frequency.value = freq;
      gain.gain.value = volume;
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain); gain.connect(ctx.destination);
      osc.start(); osc.stop(ctx.currentTime + duration);
    } catch (e) { }
  }
  function playCorrect() { playTone(880, 0.12, 'sine', 0.12); }
  function playWrong() { playTone(220, 0.25, 'square', 0.08); }
  function playCombo() { playTone(1200, 0.08, 'sine', 0.1); setTimeout(() => playTone(1500, 0.1, 'sine', 0.1), 80); }
  function playComplete() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => playTone(f, 0.2, 'sine', 0.12), i * 120)); }

  // --- Particles ---
  function spawnParticles(x, y, color, count = 8) {
    for (let i = 0; i < count; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.left = x + 'px'; p.style.top = y + 'px'; p.style.background = color;
      const angle = (Math.PI * 2 * i) / count + (Math.random() - 0.5);
      const dist = 30 + Math.random() * 50;
      p.style.setProperty('--dx', Math.cos(angle) * dist + 'px');
      p.style.setProperty('--dy', Math.sin(angle) * dist + 'px');
      document.body.appendChild(p);
      setTimeout(() => p.remove(), 800);
    }
  }

  // --- Stats ---
  function updateStats() {
    scoreEl.textContent = score;
    comboEl.textContent = combo;
    accuracyEl.textContent = totalKeys > 0 ? Math.round((correctKeys / totalKeys) * 100) + '%' : '100%';
    if (startTime > 0) {
      const minutes = (Date.now() - startTime) / 60000;
      if (minutes > 0.05) wpmEl.textContent = Math.round((charCount / 5) / minutes);
    }
  }

  // --- Keyboard Highlight ---
  function clearKeyHighlights() {
    $$('.key').forEach(k => k.classList.remove('highlight', 'pressed', 'correct-flash', 'wrong-flash'));
  }

  function highlightKey(char) {
    clearKeyHighlights();
    if (!highlightEnabled) return;
    const upper = char.toUpperCase();
    const keyEl = $('.key[data-key="' + (upper === ' ' ? ' ' : upper) + '"]');
    if (keyEl) keyEl.classList.add('highlight');
  }

  function flashKey(char, type) {
    const upper = char.toUpperCase();
    const keyEl = $('.key[data-key="' + (upper === ' ' ? ' ' : upper) + '"]');
    if (!keyEl) return;
    keyEl.classList.remove('highlight', 'correct-flash', 'wrong-flash');
    void keyEl.offsetWidth;
    keyEl.classList.add(type === 'correct' ? 'correct-flash' : 'wrong-flash');
    setTimeout(() => keyEl.classList.remove('correct-flash', 'wrong-flash'), 300);
  }

  // --- Render Target ---
  function renderTarget() {
    if (!isPlaying) return;

    let html = '';
    const currentWord = challengeQueue[queueIndex];

    if (currentWord && currentWord.cn && chineseHintEnabled) {
      html += '<div class="chinese-hint">🇨🇳 ' + currentWord.cn + '</div>';
    }

    if (audioDictationEnabled) {
      html += '<div class="audio-replay" style="cursor:pointer; font-size: 2rem; margin-bottom: 20px;" onclick="playDictationWord()">🔊 重播读音</div>';
    }

    const hiddenClass = ' hidden-word';
    html += '<div class="target-display' + hiddenClass + '">';
    targetChars.forEach((ch, i) => {
      let cls = 'waiting';

      if (i < currentIndex) {
        cls = 'done';
      } else if (audioDictationEnabled) {
        cls = 'waiting dictation-hidden';
      } else if (i === currentIndex && highlightEnabled) {
        cls = 'current';
      }
      const display = ch === ' ' ? '&nbsp;' : ch;
      html += '<span class="char ' + cls + '" id="char-' + i + '">' + display + '</span>';
    });
    html += '</div>';

    const progressPct = challengeQueue.length > 0 ? Math.round((queueIndex / challengeQueue.length) * 100) : 0;
    html += '<div class="progress-bar"><div class="progress-fill" style="width:' + progressPct + '%"></div></div>';
    
    let currentUnitTitle = currentMode === 'sentences' ? nceSentences[selectedLesson].title : '⭐ 收藏夹';
    html += '<div class="word-info"><strong>' + currentUnitTitle + '</strong> &nbsp;•&nbsp; ' + (queueIndex + 1) + ' / ' + challengeQueue.length + '</div>';
    html += '<div class="input-hint">在键盘上按下对应的键 ⬆️ (系统会自动跳过符号)</div>';

    // Add prev/next buttons
    html += `
      <div class="nav-sentence-buttons" style="display:flex; justify-content:center; gap:20px; margin-top:20px;">
        <button class="btn-sentence-nav" onfocus="this.blur()" onclick="prevSentence()" ${queueIndex === 0 ? 'disabled' : ''} style="padding: 8px 20px; border: none; border-radius: 20px; background: ${queueIndex === 0 ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.2)'}; color: ${queueIndex === 0 ? 'rgba(255,255,255,0.4)' : 'white'}; cursor: ${queueIndex === 0 ? 'not-allowed' : 'pointer'}; transition: all 0.2s;">⬅️ 上一句</button>
        <button class="btn-sentence-nav" onfocus="this.blur()" onclick="nextSentence()" style="padding: 8px 20px; border: none; border-radius: 20px; background: rgba(255,255,255,0.2); color: white; cursor: pointer; transition: all 0.2s;">${queueIndex === challengeQueue.length - 1 ? '完成 ➡️' : '下一句 ➡️'}</button>
      </div>
    `;

    practiceArea.innerHTML = html;

    if (currentIndex < targetChars.length) {
      highlightKey(targetChars[currentIndex]);
    }
  }

  window.prevSentence = function() {
    if (!isPlaying) return;
    if (queueIndex > 0) {
      queueIndex--;
      loadNextTarget();
      updateStats();
    }
  };

  window.nextSentence = function() {
    if (!isPlaying) return;
    if (queueIndex < challengeQueue.length - 1) {
      queueIndex++;
      loadNextTarget();
      updateStats();
    } else {
      finishGame();
    }
  };

  // --- Generate Challenges ---
  function generateSentencesChallenge(lessonNum) {
    const lessonData = nceSentences[lessonNum];
    if (!lessonData) return [];
    const items = [...(lessonData[selectedType] || [])];
    // 顺序排列，不打乱，以便支持上下文连贯的"上一句/下一句"
    return items.map(w => ({ text: w.en, cn: w.cn, lesson: lessonNum }));
  }

  function generateFavoritesChallenge() {
    let favs = loadFavorites();
    if (selectedFavLesson !== 'all') {
      favs = favs.filter(f => String(f.lesson) === String(selectedFavLesson));
    }
    if (favs.length === 0) return [];
    const shuffled = [...favs];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled.map(w => ({ text: w.en, cn: w.cn, lesson: w.lesson }));
  }

  // --- Start Game ---
  function startGame() {
    score = 0; combo = 0; maxCombo = 0;
    totalKeys = 0; correctKeys = 0; charCount = 0;
    startTime = Date.now();
    queueIndex = 0; currentIndex = 0; currentWrongCount = 0;
    isPlaying = true;

    switch (currentMode) {
      case 'sentences':
        challengeQueue = generateSentencesChallenge(selectedLesson); break;
      case 'favorites':
        challengeQueue = generateFavoritesChallenge(); break;
    }

    if (challengeQueue.length === 0) {
      const msg = currentMode === 'favorites'
        ? '收藏夹为空<br>打错的内容会自动加入这里'
        : '当前分类下没有内容，请尝试切换标签或选择其他课次';
      practiceArea.innerHTML = '<div class="start-prompt"><h3>😢 没有找到内容</h3><p>' + msg + '</p></div>';
      isPlaying = false;
      return;
    }

    highlightToggleBar.style.display = 'flex';
    highlightToggleBar.classList.add('show-display-toggles');

    loadNextTarget();
    updateStats();
  }

  function loadNextTarget() {
    if (queueIndex >= challengeQueue.length) { finishGame(); return; }
    const item = challengeQueue[queueIndex];
    targetChars = item.text.split('');
    currentIndex = 0;
    currentWrongCount = 0;
    currentWordHadError = false;

    while (currentIndex < targetChars.length && !/^[a-zA-Z]$/.test(targetChars[currentIndex])) {
      currentIndex++;
    }

    renderTarget();

    if (audioDictationEnabled) {
      window.playDictationWord(item.text);
    }
  }

  // --- Handle Key Press ---
  function handleKeyPress(e) {
    if (!isPlaying) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const key = e.key;
    if (key.length !== 1) return;
    e.preventDefault();
    totalKeys++;

    const expected = targetChars[currentIndex];

    // For punctuation, matching should be exact but case insensitive is fine for letters
    const isCorrect = key.toLowerCase() === expected.toLowerCase();

    if (isCorrect) {
      correctKeys++; charCount++; combo++;
      if (combo > maxCombo) maxCombo = combo;
      currentWrongCount = 0;
      score += 10 + Math.min(combo * 2, 50);

      const charEl = $('#char-' + currentIndex);
      if (charEl) {
        charEl.classList.remove('current', 'waiting', 'dictation-hidden', 'reveal-hint');
        charEl.classList.add('done');
        const rect = charEl.getBoundingClientRect();
        spawnParticles(rect.left + rect.width / 2, rect.top + rect.height / 2, 'var(--neon-green)', 6);
      }
      flashKey(expected, 'correct');
      playCorrect();

      if (combo > 0 && combo % 10 === 0) {
        playCombo();
        comboEl.classList.add('combo-fire');
        setTimeout(() => comboEl.classList.remove('combo-fire'), 300);
      }

      currentIndex++;

      while (currentIndex < targetChars.length && !/^[a-zA-Z]$/.test(targetChars[currentIndex])) {
        const skipEl = $('#char-' + currentIndex);
        if (skipEl) {
          skipEl.classList.remove('current', 'waiting', 'dictation-hidden', 'reveal-hint');
          skipEl.classList.add('done');
        }
        currentIndex++;
      }

      if (currentIndex >= targetChars.length) {
        queueIndex++;
        const currentWord = challengeQueue[queueIndex - 1];
        let delay = 300;

        if (!currentWordHadError) {
          recordFavCorrect(currentWord.text);
        } else {
          challengeQueue.splice(queueIndex, 0, currentWord);
        }

        if (!audioDictationEnabled) {
          window.playDictationWord(currentWord.text);
          delay = 1500;
        } else {
          delay = 600;
        }

        setTimeout(() => loadNextTarget(), delay);
      } else {
        const nextEl = $('#char-' + currentIndex);
        if (highlightEnabled) {
          highlightKey(targetChars[currentIndex]);
          if (nextEl) { nextEl.classList.remove('waiting'); nextEl.classList.add('current'); }
        }
      }
    } else {
      combo = 0;
      score = Math.max(0, score - 5);
      currentWordHadError = true;

      const currentWord = challengeQueue[queueIndex];
      if (currentWord && currentWord.cn) {
        addToFavorites(currentWord.text, currentWord.cn, currentWord.lesson || selectedLesson, nceSentences[currentWord.lesson || selectedLesson]?.title || '');
        recordFavWrong(currentWord.text);
      }

      currentWrongCount++;
      const charEl = $('#char-' + currentIndex);
      if (charEl) {
        charEl.classList.add('error');
        setTimeout(() => charEl.classList.remove('error'), 400);
        if (currentWrongCount >= 3) {
          charEl.classList.add('reveal-hint');
        }
      }
      flashKey(key, 'wrong');
      playWrong();
    }
    updateStats();
  }

  window.playDictationWord = async function (wordText) {
    if (!wordText && isPlaying) {
      const currentWord = challengeQueue[queueIndex];
      if (currentWord) wordText = currentWord.text;
    }

    if (wordText && soundEnabled) {
      const cleanText = wordText.trim();
      const currentWord = challengeQueue.find(w => w.text === wordText);
      const lessonNum = (currentWord && currentWord.lesson) ? currentWord.lesson : selectedLesson;

      if (window.currentAudio) {
        window.currentAudio.pause();
        window.currentAudio = null;
      }
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }

      const played = await NCEAudio.playSentence(wordText, lessonNum);
      if (played) return;

      const ttsUrls = [
        'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(cleanText) + '&type=1',
        'https://dict.youdao.com/dictvoice?audio=' + encodeURIComponent(cleanText) + '&type=2',
      ];

      let currentTtsIndex = 0;
      let resolved = false;

      function tryNextTTS() {
        if (resolved) return;

        if (currentTtsIndex >= ttsUrls.length) {
          resolved = true;
          if (window.speechSynthesis) {
            const utterance = new SpeechSynthesisUtterance(cleanText);
            utterance.lang = 'en-US';
            utterance.rate = 0.9;
            window.speechSynthesis.speak(utterance);
          }
          return;
        }

        const url = ttsUrls[currentTtsIndex++];
        const audio = new Audio();
        window.currentAudio = audio;

        const timeout = setTimeout(() => {
          if (!resolved) {
            audio.pause();
            audio.src = '';
            tryNextTTS();
          }
        }, 3000);

        audio.onloadeddata = () => {
          if (audio.duration > 0.1) {
            clearTimeout(timeout);
            resolved = true;
            audio.play().catch(() => {
              resolved = false;
              tryNextTTS();
            });
          } else {
            clearTimeout(timeout);
            audio.pause();
            tryNextTTS();
          }
        };

        audio.onerror = () => {
          clearTimeout(timeout);
          tryNextTTS();
        };

        audio.src = url;
        audio.load();
      }

      tryNextTTS();
    }
  };

  // --- Finish Game ---
  function finishGame() {
    isPlaying = false;
    clearKeyHighlights();
    playComplete();

    const minutes = (Date.now() - startTime) / 60000;
    const wpm = minutes > 0.05 ? Math.round((charCount / 5) / minutes) : 0;
    const accuracy = totalKeys > 0 ? Math.round((correctKeys / totalKeys) * 100) : 100;

    let titleText = '太棒了！🎉';
    if (accuracy >= 95) titleText = '完美表现！🌟';
    else if (accuracy >= 80) titleText = '做得很好！👏';
    else titleText = '继续加油！💪';

    celebrationTitle.textContent = titleText;
    celebrationStats.innerHTML = `
      得分: <span>${score}</span><br>
      准确率: <span>${accuracy}%</span><br>
      速度: <span>${wpm} WPM</span><br>
      最高连击: <span>${maxCombo}</span>
    `;
    celebration.classList.add('show');

    for (let i = 0; i < 30; i++) {
      setTimeout(() => {
        const x = Math.random() * window.innerWidth;
        const y = Math.random() * window.innerHeight * 0.5;
        const colors = ['#00d4ff', '#a855f7', '#f472b6', '#34d399', '#fbbf24'];
        spawnParticles(x, y, colors[Math.floor(Math.random() * colors.length)], 4);
      }, i * 50);
    }
  }

  // --- Favorites View ---
  let selectedFavGroup = 'all';

  function renderFavorites() {
    const favs = loadFavorites();

    let html = '<div class="favorites-list">';
    html += '<h3>⭐ 收藏夹</h3>';
    html += '<p class="fav-subtitle">打字出错的句子会自动添加到这里 · 累计正确5次自动掌握 ✨</p>';

    if (favs.length === 0) {
      html += '<div class="fav-empty">还没有收藏的句子 👍<br>继续保持！</div>';
    } else {
      const groups = {};
      favs.forEach(f => {
        const key = f.lesson || 0;
        const title = f.lessonTitle || (nceSentences[key] ? nceSentences[key].title : '') || '';

        if (!groups[title]) {
          groups[title] = { label: title, words: [], key: key };
        }
        groups[title].words.push(f);
      });

      html += '<div class="fav-filter-bar">';
      html += '<button class="fav-filter-btn ' + (selectedFavLesson === 'all' ? 'active' : '') + '" data-fav-lesson="all">全部 (' + favs.length + ')</button>';
      for (const [title, lData] of Object.entries(groups)) {
        html += '<button class="fav-filter-btn ' + (String(selectedFavLesson) === String(lData.key) ? 'active' : '') + '" data-fav-lesson="' + lData.key + '">' + lData.label + ' (' + lData.words.length + ')</button>';
      }
      html += '</div>';

      let displayFavs = favs;
      if (selectedFavLesson !== 'all') {
        displayFavs = displayFavs.filter(f => String(f.lesson) === String(selectedFavLesson));
      }

      for (const fav of displayFavs) {
        const streak = fav.correctStreak || 0;
        const dots = Array.from({ length: 5 }, (_, i) =>
          '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;margin:0 1px;background:' + (i < streak ? 'var(--neon-green)' : 'rgba(255,255,255,0.12)') + '"></span>'
        ).join('');
        html += `
          <div class="fav-word-item" style="flex-direction:column; align-items:flex-start;">
            <div style="display:flex; justify-content:space-between; width:100%; margin-bottom: 5px;">
                <span class="fav-word-en" style="font-size:1.2rem; flex:1; white-space:normal; line-height: 1.4;">${fav.en}</span>
                <span class="fav-word-streak" title="累计正确 ${streak}/5">${dots}</span>
            </div>
            <div style="display:flex; justify-content:space-between; width:100%;">
                <span class="fav-word-cn" style="font-size:1rem;">${fav.cn}</span>
                <button class="fav-word-remove" data-word="${fav.en.replace(/"/g, '&quot;')}">移除</button>
            </div>
          </div>`;
      }
      html += `
        <div class="fav-actions">
          <button id="btnPracticeFavs">📝 练习${selectedFavLesson === 'all' ? '全部' : '当前筛选'}句子</button>
          <button id="btnClearFavs" class="danger">🗑️ 清空全部</button>
        </div>`;
    }
    html += '</div>';
    practiceArea.innerHTML = html;

    $$('[data-fav-lesson]').forEach(btn => {
      btn.addEventListener('click', () => {
        selectedFavLesson = btn.dataset.favLesson === 'all' ? 'all' : btn.dataset.favLesson;
        renderFavorites();
      });
    });

    $$('.fav-word-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        removeFromFavorites(btn.dataset.word);
        renderFavorites();
      });
    });

    const btnPractice = $('#btnPracticeFavs');
    if (btnPractice) {
      btnPractice.addEventListener('click', () => {
        currentMode = 'favorites';
        startGame();
      });
    }

    const btnClear = $('#btnClearFavs');
    if (btnClear) {
      btnClear.addEventListener('click', () => {
        if (confirm('确定要清空所有收藏的句子吗？')) {
          clearAllFavorites();
          renderFavorites();
        }
      });
    }
  }

  // --- Mode Switch ---
  function setMode(mode) {
    currentMode = mode;
    isPlaying = false;
    clearKeyHighlights();

    lessonSelector.classList.toggle('show', mode === 'sentences');
    
    const favModeToggle = $('#favModeToggle');
    if (favModeToggle) {
      const isFav = mode === 'favorites';
      const strong = favModeToggle.querySelector('strong');
      if (strong) strong.textContent = isFav ? '开' : '关';
      favModeToggle.classList.toggle('off', !isFav);
      favModeToggle.classList.toggle('active', isFav);
    }

    score = 0; combo = 0; totalKeys = 0; correctKeys = 0; charCount = 0;
    updateStats();

    if (mode === 'favorites') {
      renderFavorites();
      return;
    }

    practiceArea.innerHTML = `
      <div class="start-prompt">
        <h3>📝 课文练习</h3>
        <p>看中文提示，打出英文句子<br>注意大小写，系统会自动跳过标点符号！</p>
        <button class="btn-start" id="btnStart">开 始 练 习</button>
      </div>
    `;
    $('#btnStart').addEventListener('click', startGame);
  }

  // --- Build Lesson Selector ---
  function buildLessonSelector() {
    const sortedKeys = Object.keys(nceSentences).map(Number).sort((a, b) => a - b);

    let selectHtml = '<label for="lessonSelect" style="color: white; font-size: 1.1em; font-weight: 600; margin-right: 10px;">选择课程：</label>';
    selectHtml += '<select id="lessonSelect" class="lesson-select">';
    sortedKeys.forEach(key => {
      const isSelected = key === selectedLesson ? 'selected' : '';
      selectHtml += `<option value="${key}" ${isSelected}>${nceSentences[key].title}</option>`;
    });
    selectHtml += '</select>';

    lessonSelector.innerHTML = selectHtml;

    $('#lessonSelect').addEventListener('change', (e) => {
      selectedLesson = parseInt(e.target.value);
      if (isPlaying) startGame();
    });
  }

  // --- Init ---
  function init() {
    buildLessonSelector();

    const favModeToggle = $('#favModeToggle');
    if (favModeToggle) {
      const badge = document.createElement('span');
      badge.className = 'fav-badge hidden';
      badge.textContent = '0';
      favModeToggle.appendChild(badge);
      
      favModeToggle.addEventListener('click', () => {
        setMode(currentMode === 'sentences' ? 'favorites' : 'sentences');
      });
    }
    updateFavBadge();

    btnStart.addEventListener('click', startGame);

    btnContinue.addEventListener('click', () => {
      celebration.classList.remove('show');
      setMode(currentMode);
    });

    document.addEventListener('keydown', handleKeyPress);

    $$('.key').forEach(keyEl => {
      keyEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const keyChar = keyEl.dataset.key;
        if (keyChar) {
          handleKeyPress({
            key: keyChar.toLowerCase(),
            preventDefault: () => { },
            ctrlKey: false, metaKey: false, altKey: false,
            length: keyChar.length
          });
          keyEl.classList.add('pressed');
          setTimeout(() => keyEl.classList.remove('pressed'), 150);
        }
      });
    });

    soundToggle.addEventListener('click', () => {
      soundEnabled = !soundEnabled;
      soundToggle.textContent = soundEnabled ? '🔊' : '🔇';
    });

    highlightToggle.addEventListener('click', () => {
      highlightEnabled = !highlightEnabled;
      highlightStatus.textContent = highlightEnabled ? '开' : '关';
      highlightIcon.textContent = highlightEnabled ? '💡' : '❌';
      highlightToggle.classList.toggle('off', !highlightEnabled);
      if (!highlightEnabled) clearKeyHighlights();
      else if (isPlaying && currentIndex < targetChars.length) highlightKey(targetChars[currentIndex]);

      if (isPlaying) {
        renderTarget();
      }
    });

    const chineseToggle = $('#chineseToggle');
    if (chineseToggle) {
      chineseToggle.addEventListener('click', () => {
        chineseHintEnabled = !chineseHintEnabled;
        chineseToggle.innerHTML = `🇨🇳 中文提示：<strong>${chineseHintEnabled ? '开' : '关'}</strong>`;
        chineseToggle.classList.toggle('off', !chineseHintEnabled);
        if (isPlaying) renderTarget();
      });
    }

    const audioDictationToggle = $('#audioDictationToggle');
    if (audioDictationToggle) {
      audioDictationToggle.addEventListener('click', () => {
        audioDictationEnabled = !audioDictationEnabled;
        audioDictationToggle.innerHTML = `🎧 听写模式：<strong>${audioDictationEnabled ? '开' : '关'}</strong>`;
        audioDictationToggle.classList.toggle('off', !audioDictationEnabled);

        if (isPlaying && audioDictationEnabled && targetChars.length > 0) {
          playDictationWord();
        }
        if (isPlaying) renderTarget();
      });
    }

    document.addEventListener('keydown', (e) => {
      if (e.key === ' ' && isPlaying) e.preventDefault();
    });

    setMode(currentMode);
  }

  init();
})();
