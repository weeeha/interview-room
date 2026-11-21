// Draft helper shared by all screens.
// ?state=  sets data-state on <body>. Valid names come from <body data-states="a b c">
//          (setup default list below). An unknown value falls back to the first name.
// ?bg=     light or dark: placeholder room view background (room screen, for caption checks).
// ?play=1  room screen: start the scripted exchange on load.
(function () {
  var body = document.body;
  var params = new URLSearchParams(location.search);
  var valid = (body.getAttribute('data-states') || 'default empty loading error long').split(' ');

  var meterLevel = { 'candidate-speaking': 4, 'interviewer-speaking': 0 };
  var captions = {
    'default': ['Interviewer', 'First question: tell me about a project you led from start to finish.', 'Say something when you are ready.'],
    'interviewer-speaking': ['Interviewer', 'First question: tell me about a project you led from start to finish.', 'You can interrupt by speaking.'],
    'candidate-speaking': ['You', 'Last spring I led a redesign of the checkout flow for a small ticketing tool. We started by watching ten people try to buy a ticket, and', ''],
    'silence-prompt': ['Interviewer', 'Take your time. Would you like me to repeat the question?', 'After 12 more seconds the interviewer offers the next question.'],
    'provider-error': ['Interviewer', 'First question: tell me about a project you led from start to finish.', ''],
    'room-unavailable': ['Interviewer', 'First question: tell me about a project you led from start to finish.', ''],
    'ending': ['Interviewer', 'That is all my questions. Thank you for your time today. Your report is being written.', '']
  };

  function setCaption(state) {
    var c = captions[state]; if (!c) return;
    var who = body.querySelector('.cap-who'), text = body.querySelector('.cap-text'), hint = body.querySelector('.cap-hint');
    if (!who || !text) return;
    who.textContent = c[0]; text.textContent = c[1];
    if (hint) { hint.textContent = c[2]; hint.hidden = !c[2]; }
  }

  function setState(state, keepCaption) {
    body.setAttribute('data-state', state);
    document.querySelectorAll('.draft-states a[data-state-link]').forEach(function (a) {
      if (a.getAttribute('data-state-link') === state) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
    var meter = body.querySelector('.meter');
    if (meter) meter.setAttribute('data-level', meterLevel[state] || 0);
    var mt = document.getElementById('mic-text');
    if (mt) { var muted = document.getElementById('mute').getAttribute('aria-pressed') === 'true'; mt.textContent = state === 'mic-denied' ? 'Mic blocked' : (muted ? 'Mic off' : 'Mic on'); }
    var end = document.getElementById('end');
    if (end) end.disabled = state === 'ending';
    if (!keepCaption) setCaption(state);
  }

  var asked = params.get('state');
  var state = valid.indexOf(asked) >= 0 ? asked : valid[0];
  if (body.querySelector('.captions')) {
    var bg = params.get('bg') === 'light' ? 'light' : 'dark';
    body.setAttribute('data-bg', bg);
    document.querySelectorAll('[data-bg-link]').forEach(function (a) {
      a.setAttribute('href', 'room.html?state=' + state + '&bg=' + a.getAttribute('data-bg-link'));
      if (a.getAttribute('data-bg-link') === bg) a.setAttribute('aria-current', 'true');
    });
    // State links keep the chosen background.
    document.querySelectorAll('.draft-states a[data-state-link]').forEach(function (a) {
      a.setAttribute('href', 'room.html?state=' + a.getAttribute('data-state-link') + '&bg=' + bg);
    });
  }
  setState(state);

  // Retry in the draft returns to the default state.
  document.querySelectorAll('[data-retry]').forEach(function (b) {
    b.addEventListener('click', function () { location.search = ''; });
  });

  // ----- room: mute and end, with keyboard shortcuts -----
  var mute = document.getElementById('mute');
  function toggleMute() {
    if (!mute) return;
    var on = mute.getAttribute('aria-pressed') !== 'true';
    mute.setAttribute('aria-pressed', String(on));
    mute.querySelector('.mute-label').textContent = on ? 'Unmute' : 'Mute';
    var s = document.getElementById('mic-text'); if (s) s.textContent = on ? 'Mic off' : 'Mic on';
  }
  if (mute) mute.addEventListener('click', toggleMute);
  var end = document.getElementById('end');
  if (end) end.addEventListener('click', function () { setState('ending'); });
  document.addEventListener('keydown', function (e) {
    if (e.ctrlKey || e.metaKey || e.altKey || !mute) return;
    var t = e.target;
    if (t && t.matches && t.matches('input, textarea, select')) return;
    if (e.key === 'm' || e.key === 'M') toggleMute();
    else if ((e.key === 'e' || e.key === 'E') && end && !end.disabled) setState('ending');
  });

  // ----- room: scripted exchange, plays once, pauses while the tab is hidden -----
  var script = [
    ['interviewer-speaking', 'Interviewer', 'Thanks for coming in. First question: tell me about a project you led from start to finish.', 6000],
    ['candidate-speaking', 'You', 'Sure. Last spring I led a redesign of the checkout flow for a small ticketing tool.', 5000],
    ['candidate-speaking', 'You', 'Last spring I led a redesign of the checkout flow for a small ticketing tool. We started by watching ten people try to buy a ticket, and most of them stalled at the seat map.', 6000],
    ['interviewer-speaking', 'Interviewer', 'You said most people stalled at the seat map. What did you change there first?', 5000],
    ['silence-prompt', 'Interviewer', 'Take your time. Would you like me to repeat the question?', 4000]
  ];
  var timer = null;
  function play() {
    if (!body.querySelector('.captions')) return;
    clearTimeout(timer);
    var i = 0;
    (function step() {
      if (document.hidden) { timer = setTimeout(step, 500); return; }
      if (i >= script.length) return;
      var s = script[i++];
      setState(s[0], true);
      body.querySelector('.cap-who').textContent = s[1];
      body.querySelector('.cap-text').textContent = s[2];
      var hint = body.querySelector('.cap-hint'); if (hint) hint.hidden = true;
      timer = setTimeout(step, s[3]);
    })();
  }
  var playBtn = document.getElementById('play-script');
  if (playBtn) playBtn.addEventListener('click', play);
  if (params.get('play') === '1') play();

  // ----- report: collapse long text with show more (needs script, shown in full without it) -----
  document.querySelectorAll('.clampable').forEach(function (q) {
    q.classList.add('clamped');
    var p = q.querySelector('p') || q;
    if (p.scrollHeight <= p.clientHeight + 1) { q.classList.remove('clamped'); return; }
    var b = document.createElement('button');
    b.type = 'button'; b.className = 'btn btn-small'; b.textContent = 'Show more';
    b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', function () {
      var open = b.getAttribute('aria-expanded') === 'true';
      q.classList.toggle('clamped', open);
      b.setAttribute('aria-expanded', String(!open));
      b.textContent = open ? 'Show more' : 'Show less';
    });
    q.insertAdjacentElement('afterend', b);
  });
})();
