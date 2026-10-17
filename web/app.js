// Termux Workspace Frontend Application
(function () {
  'use strict';

  // 1. Ekstraksi Token
  const urlParams = new URLSearchParams(window.location.search);
  let token = urlParams.get('token') || '';
  if (token) {
    sessionStorage.setItem('termux_ws_token', token);
    const cleanUrl = window.location.pathname + window.location.hash;
    window.history.replaceState({}, document.title, cleanUrl);
  } else {
    token = sessionStorage.getItem('termux_ws_token') || '';
  }

  // State Aplikasi
  let sessions = []; // [{id, name}]
  let activeSessionId = null;
  let splitSessionId = null;
  let isSplitMode = false;
  let focusedPanel = 'left'; // 'left' | 'right'

  // Sesi terminal aktif di memori: { [id]: { term, fitAddon, ws, container, reconnectCount, reconnectTimer } }
  const terminalInstances = {};

  // Status toggle tombol Ctrl dan Alt
  let ctrlActive = false;
  let altActive = false;

  // Elemen DOM
  const tabsContainer = document.getElementById('tabs-container');
  const btnAddSession = document.getElementById('btn-add-session');
  const popupMenu = document.getElementById('popup-menu');
  const popupSearchInput = document.getElementById('popup-search-input');
  const popupItemsContainer = document.getElementById('popup-items');
  const sidebar = document.getElementById('sidebar');
  const btnCollapseSidebar = document.getElementById('btn-collapse-sidebar');
  const panelLeft = document.getElementById('panel-left');
  const panelRight = document.getElementById('panel-right');
  const containerLeft = document.getElementById('terminal-container-left');
  const containerRight = document.getElementById('terminal-container-right');
  const btnCtrl = document.getElementById('btn-ctrl');
  const btnAlt = document.getElementById('btn-alt');
  const extraKeysBar = document.getElementById('extra-keys-bar');

  // State & Elemen DOM Code Editor
  let activeTabType = 'terminal'; // 'terminal' | 'editor'
  let currentEditingPath = null;
  const openFiles = {}; // { [path]: { name, content, originalContent, isDirty } }

  const editorArea = document.getElementById('editor-area');
  const terminalArea = document.getElementById('terminal-area');
  const editorFilename = document.getElementById('editor-filename');
  const editorStatus = document.getElementById('editor-status');
  const editorTextarea = document.getElementById('editor-textarea');
  const editorLineNumbers = document.getElementById('editor-line-numbers');
  const editorCursorPos = document.getElementById('editor-cursor-pos');
  const btnSaveFile = document.getElementById('btn-save-file');
  const btnSendToTerminal = document.getElementById('btn-send-to-terminal');

  // Helper HTTP fetch dengan token
  async function apiFetch(endpoint, options = {}) {
    const sep = endpoint.includes('?') ? '&' : '?';
    const url = `${endpoint}${sep}token=${encodeURIComponent(token)}`;
    const headers = options.headers || {};
    headers['X-Token'] = token;
    return fetch(url, { ...options, headers });
  }

  // --- Manajer Sesi & Tab ---
  async function loadSessions() {
    try {
      const res = await apiFetch('/api/sessions');
      if (!res.ok) {
        if (res.status === 401) {
          console.error('Token tidak valid atau tidak disertakan');
        }
        return;
      }
      sessions = await res.json();
      if (sessions.length === 0) {
        await createNewSession();
      } else {
        renderTabs();
        if (!activeSessionId || !sessions.find(s => s.id === activeSessionId)) {
          switchToSession(sessions[0].id);
        }
      }
    } catch (e) {
      console.error('Gagal memuat sesi:', e);
    }
  }

  async function createNewSession() {
    try {
      const res = await apiFetch('/api/sessions', { method: 'POST' });
      if (res.ok) {
        const newSession = await res.json();
        sessions.push(newSession);
        renderTabs();
        switchToSession(newSession.id);
      }
    } catch (e) {
      console.error('Gagal membuat sesi baru:', e);
    }
  }

  async function closeSession(sessionId) {
    try {
      await apiFetch(`/api/sessions/${sessionId}`, { method: 'DELETE' });
      // Hancurkan terminal instance jika ada
      destroyTerminal(sessionId);

      const closedIndex = sessions.findIndex(s => s.id === sessionId);
      sessions = sessions.filter(s => s.id !== sessionId);

      if (splitSessionId === sessionId) {
        toggleSplitView(false);
      }

      if (activeSessionId === sessionId) {
        if (sessions.length > 0) {
          const nextIndex = Math.min(closedIndex, sessions.length - 1);
          switchToSession(sessions[nextIndex].id);
        } else {
          activeSessionId = null;
          await createNewSession();
        }
      }
      renderTabs();
    } catch (e) {
      console.error('Gagal menutup sesi:', e);
    }
  }

  function renderTabs() {
    tabsContainer.innerHTML = '';

    // Tab sesi terminal
    sessions.forEach(sess => {
      const tab = document.createElement('div');
      const isActive = activeTabType === 'terminal' && sess.id === activeSessionId;
      tab.className = `tab ${isActive ? 'active' : ''}`;
      tab.dataset.id = sess.id;

      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = sess.name;
      tab.appendChild(title);

      if (isActive) {
        const btnClose = document.createElement('span');
        btnClose.className = 'tab-close';
        btnClose.textContent = '✕';
        btnClose.title = 'Tutup sesi';
        btnClose.addEventListener('click', (e) => {
          e.stopPropagation();
          closeSession(sess.id);
        });
        tab.appendChild(btnClose);
      }

      tab.addEventListener('click', () => {
        switchToSession(sess.id);
      });

      tabsContainer.appendChild(tab);
    });

    // Tab file editor
    Object.keys(openFiles).forEach(fPath => {
      const fileData = openFiles[fPath];
      const tab = document.createElement('div');
      const isActive = activeTabType === 'editor' && currentEditingPath === fPath;
      tab.className = `tab ${isActive ? 'active' : ''}`;

      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = `📄 ${fileData.name}${fileData.isDirty ? ' ●' : ''}`;
      tab.appendChild(title);

      if (isActive) {
        const btnClose = document.createElement('span');
        btnClose.className = 'tab-close';
        btnClose.textContent = '✕';
        btnClose.title = 'Tutup file';
        btnClose.addEventListener('click', (e) => {
          e.stopPropagation();
          closeFile(fPath);
        });
        tab.appendChild(btnClose);
      }

      tab.addEventListener('click', () => {
        switchToEditor(fPath);
      });

      tabsContainer.appendChild(tab);
    });
  }

  function switchToSession(sessionId) {
    if (!sessionId) return;
    activeTabType = 'terminal';
    activeSessionId = sessionId;

    editorArea.classList.add('hidden');
    terminalArea.classList.remove('hidden');

    renderTabs();

    if (isSplitMode) {
      if (focusedPanel === 'left') {
        mountTerminal(activeSessionId, containerLeft);
      } else {
        splitSessionId = activeSessionId;
        mountTerminal(splitSessionId, containerRight);
      }
    } else {
      mountTerminal(activeSessionId, containerLeft);
    }
  }

  // --- Fungsi Code Editor ---
  async function openFileInEditor(filePath) {
    if (openFiles[filePath]) {
      switchToEditor(filePath);
      return;
    }
    try {
      const res = await apiFetch(`/api/fs/content?path=${encodeURIComponent(filePath)}`);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Gagal membuka file' }));
        console.error(err.detail || 'Gagal membuka file');
        return;
      }
      const data = await res.json();
      openFiles[filePath] = {
        name: data.name,
        content: data.content,
        originalContent: data.content,
        isDirty: false
      };
      switchToEditor(filePath);
    } catch (e) {
      console.error('Gagal membuka file:', e);
    }
  }

  function switchToEditor(filePath) {
    const fileData = openFiles[filePath];
    if (!fileData) return;
    activeTabType = 'editor';
    currentEditingPath = filePath;

    terminalArea.classList.add('hidden');
    editorArea.classList.remove('hidden');

    editorFilename.textContent = fileData.name;
    editorFilename.title = filePath;
    editorTextarea.value = fileData.content;
    updateLineNumbers();
    updateEditorStatus();
    updateCursorPos();
    renderTabs();
    setTimeout(() => editorTextarea.focus(), 50);
  }

  function updateLineNumbers() {
    const lines = editorTextarea.value.split('\n').length;
    editorLineNumbers.textContent = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  }

  function updateEditorStatus() {
    const fileData = openFiles[currentEditingPath];
    if (!fileData) return;
    if (fileData.isDirty) {
      editorStatus.textContent = 'Belum disimpan ●';
      editorStatus.className = 'editor-status unsaved';
    } else {
      editorStatus.textContent = 'Tersimpan';
      editorStatus.className = 'editor-status';
    }
  }

  function updateCursorPos() {
    const text = editorTextarea.value.substring(0, editorTextarea.selectionStart);
    const lines = text.split('\n');
    const row = lines.length;
    const col = lines[lines.length - 1].length + 1;
    editorCursorPos.textContent = `Ln ${row}, Col ${col}`;
  }

  async function saveCurrentFile() {
    if (!currentEditingPath || !openFiles[currentEditingPath]) return;
    const content = editorTextarea.value;
    try {
      const res = await apiFetch('/api/fs/content', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: currentEditingPath, content })
      });
      if (res.ok) {
        openFiles[currentEditingPath].content = content;
        openFiles[currentEditingPath].originalContent = content;
        openFiles[currentEditingPath].isDirty = false;
        updateEditorStatus();
        renderTabs();
      } else {
        const err = await res.json().catch(() => ({ detail: 'Gagal menyimpan file' }));
        console.error(err.detail || 'Gagal menyimpan file');
      }
    } catch (e) {
      console.error('Gagal menyimpan file:', e);
    }
  }

  function closeFile(filePath) {
    delete openFiles[filePath];
    if (currentEditingPath === filePath) {
      const remainingPaths = Object.keys(openFiles);
      if (remainingPaths.length > 0) {
        switchToEditor(remainingPaths[remainingPaths.length - 1]);
      } else {
        currentEditingPath = null;
        if (activeSessionId) {
          switchToSession(activeSessionId);
        } else if (sessions.length > 0) {
          switchToSession(sessions[0].id);
        }
      }
    } else {
      renderTabs();
    }
  }

  // Event listener input & shortcut textarea editor
  editorTextarea.addEventListener('input', () => {
    if (!currentEditingPath || !openFiles[currentEditingPath]) return;
    openFiles[currentEditingPath].content = editorTextarea.value;
    openFiles[currentEditingPath].isDirty = (editorTextarea.value !== openFiles[currentEditingPath].originalContent);
    updateLineNumbers();
    updateEditorStatus();
    renderTabs();
  });

  editorTextarea.addEventListener('scroll', () => {
    editorLineNumbers.scrollTop = editorTextarea.scrollTop;
  });

  ['click', 'keyup', 'select'].forEach(ev => {
    editorTextarea.addEventListener(ev, updateCursorPos);
  });

  editorTextarea.addEventListener('keydown', (e) => {
    // Tab: sisipkan 2 spasi
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = editorTextarea.selectionStart;
      const end = editorTextarea.selectionEnd;
      editorTextarea.value = editorTextarea.value.substring(0, start) + '  ' + editorTextarea.value.substring(end);
      editorTextarea.selectionStart = editorTextarea.selectionEnd = start + 2;
      editorTextarea.dispatchEvent(new Event('input'));
    } else if (e.key === 'Enter') {
      // Auto-indent baris baru
      const start = editorTextarea.selectionStart;
      const currentLine = editorTextarea.value.substring(0, start).split('\n').pop();
      const indent = currentLine.match(/^\s*/)[0];
      if (indent.length > 0) {
        e.preventDefault();
        const insert = '\n' + indent;
        editorTextarea.value = editorTextarea.value.substring(0, start) + insert + editorTextarea.value.substring(editorTextarea.selectionEnd);
        editorTextarea.selectionStart = editorTextarea.selectionEnd = start + insert.length;
        editorTextarea.dispatchEvent(new Event('input'));
      }
    } else if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
      e.preventDefault();
      saveCurrentFile();
    }
  });

  btnSaveFile.addEventListener('click', () => {
    saveCurrentFile();
  });

  btnSendToTerminal.addEventListener('click', () => {
    if (currentEditingPath) {
      const escaped = shellEscape(currentEditingPath);
      sendToActiveTerminal(escaped + ' ');
      if (activeSessionId) {
        switchToSession(activeSessionId);
      }
    }
  });

  // --- Terminal xterm.js & WebSocket ---
  function getOrCreateTerminal(sessionId) {
    if (terminalInstances[sessionId]) {
      return terminalInstances[sessionId];
    }

    const term = new Terminal({
      theme: {
        background: '#14161C',
        foreground: '#E6E8EC',
        cursor: '#E6E8EC',
        selectionBackground: '#2B303B'
      },
      fontFamily: 'monospace, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
      fontSize: 14,
      cursorBlink: true,
      allowTransparency: false
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);

    const termWrap = document.createElement('div');
    termWrap.style.width = '100%';
    termWrap.style.height = '100%';

    term.open(termWrap);

    const instance = {
      term,
      fitAddon,
      termWrap,
      ws: null,
      reconnectCount: 0,
      reconnectTimer: null
    };

    term.onData((data) => {
      // Penanganan tombol modifier Ctrl / Alt jika aktif
      let outData = data;
      if (ctrlActive) {
        // Jika karakter huruf a-z / A-Z ditekan dengan Ctrl
        if (data.length === 1) {
          const code = data.charCodeAt(0);
          if (code >= 97 && code <= 122) { // a-z
            outData = String.fromCharCode(code - 96);
          } else if (code >= 65 && code <= 90) { // A-Z
            outData = String.fromCharCode(code - 64);
          }
        }
        setCtrl(false);
      }
      if (altActive) {
        outData = '\x1b' + outData;
        setAlt(false);
      }

      if (instance.ws && instance.ws.readyState === WebSocket.OPEN) {
        instance.ws.send(outData);
      }
    });

    terminalInstances[sessionId] = instance;
    connectWebSocket(sessionId);
    return instance;
  }

  function connectWebSocket(sessionId) {
    const instance = terminalInstances[sessionId];
    if (!instance) return;

    if (instance.ws) {
      try { instance.ws.close(); } catch (e) {}
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const cols = instance.term.cols || 120;
    const rows = instance.term.rows || 30;
    const wsUrl = `${protocol}//${window.location.host}/ws/terminal?id=${encodeURIComponent(sessionId)}&cols=${cols}&rows=${rows}&token=${encodeURIComponent(token)}`;

    const ws = new WebSocket(wsUrl);
    ws.binaryType = 'arraybuffer';
    instance.ws = ws;

    ws.onopen = () => {
      instance.reconnectCount = 0;
      try {
        instance.fitAddon.fit();
        ws.send(JSON.stringify({ type: 'resize', cols: instance.term.cols, rows: instance.term.rows }));
      } catch (e) {}
    };

    ws.onmessage = (event) => {
      if (event.data instanceof ArrayBuffer) {
        instance.term.write(new Uint8Array(event.data));
      } else {
        instance.term.write(event.data);
      }
    };

    ws.onclose = () => {
      // Reconnect otomatis dengan backoff hingga 10 kali
      if (terminalInstances[sessionId] && instance.reconnectCount < 10) {
        const delay = Math.min(1000 * Math.pow(1.5, instance.reconnectCount), 10000);
        instance.reconnectCount++;
        instance.reconnectTimer = setTimeout(() => {
          connectWebSocket(sessionId);
        }, delay);
      }
    };

    ws.onerror = () => {
      try { ws.close(); } catch (e) {}
    };
  }

  function mountTerminal(sessionId, targetContainer) {
    const instance = getOrCreateTerminal(sessionId);
    if (!targetContainer.contains(instance.termWrap)) {
      targetContainer.innerHTML = '';
      targetContainer.appendChild(instance.termWrap);
    }
    setTimeout(() => {
      try {
        instance.fitAddon.fit();
        instance.term.focus();
        if (instance.ws && instance.ws.readyState === WebSocket.OPEN) {
          instance.ws.send(JSON.stringify({ type: 'resize', cols: instance.term.cols, rows: instance.term.rows }));
        }
      } catch (e) {}
    }, 30);
  }

  function destroyTerminal(sessionId) {
    const instance = terminalInstances[sessionId];
    if (!instance) return;
    if (instance.reconnectTimer) clearTimeout(instance.reconnectTimer);
    if (instance.ws) {
      instance.ws.onclose = null;
      try { instance.ws.close(); } catch (e) {}
    }
    try { instance.term.dispose(); } catch (e) {}
    if (instance.termWrap && instance.termWrap.parentNode) {
      instance.termWrap.parentNode.removeChild(instance.termWrap);
    }
    delete terminalInstances[sessionId];
  }

  // Observer resize untuk panel
  const resizeObserver = new ResizeObserver(() => {
    [activeSessionId, splitSessionId].forEach(sid => {
      if (sid && terminalInstances[sid]) {
        try {
          terminalInstances[sid].fitAddon.fit();
          const { cols, rows } = terminalInstances[sid].term;
          if (terminalInstances[sid].ws && terminalInstances[sid].ws.readyState === WebSocket.OPEN) {
            terminalInstances[sid].ws.send(JSON.stringify({ type: 'resize', cols, rows }));
          }
        } catch (e) {}
      }
    });
  });
  resizeObserver.observe(containerLeft);
  resizeObserver.observe(containerRight);

  // --- Tombol Tambah & Menu Popup ---
  btnAddSession.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopupMenu();
  });

  function togglePopupMenu(forceState) {
    const show = forceState !== undefined ? forceState : popupMenu.classList.contains('hidden');
    if (show) {
      popupMenu.classList.remove('hidden');
      popupSearchInput.value = '';
      filterPopupActions('');
      setTimeout(() => popupSearchInput.focus(), 50);
    } else {
      popupMenu.classList.add('hidden');
    }
  }

  document.addEventListener('click', (e) => {
    if (!popupMenu.contains(e.target) && e.target !== btnAddSession) {
      togglePopupMenu(false);
    }
  });

  // Aksi Popup
  const popupActions = [
    { id: 'terminal', name: 'Terminal', action: () => { createNewSession(); togglePopupMenu(false); } },
    { id: 'explorer', name: 'Explorer', action: () => { toggleSidebar(); togglePopupMenu(false); } },
    { id: 'split', name: 'Split View', action: () => { toggleSplitView(); togglePopupMenu(false); } },
    { id: 'close', name: 'Close Tab', action: () => { if (activeSessionId) closeSession(activeSessionId); togglePopupMenu(false); } }
  ];

  function filterPopupActions(query) {
    const q = query.trim().toLowerCase();
    popupItemsContainer.innerHTML = '';
    const filtered = popupActions.filter(a => a.name.toLowerCase().includes(q));

    filtered.forEach((act, idx) => {
      if (act.id === 'split' && idx > 0) {
        const sep = document.createElement('div');
        sep.className = 'popup-separator';
        popupItemsContainer.appendChild(sep);
      }
      const item = document.createElement('div');
      item.className = 'popup-item';
      item.textContent = act.name;
      item.addEventListener('click', act.action);
      popupItemsContainer.appendChild(item);
    });
  }

  popupSearchInput.addEventListener('input', (e) => {
    filterPopupActions(e.target.value);
  });

  popupSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const firstItem = popupItemsContainer.querySelector('.popup-item');
      if (firstItem) firstItem.click();
    } else if (e.key === 'Escape') {
      togglePopupMenu(false);
    }
  });

  // Shortcut Ctrl + K untuk menu pencarian
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      togglePopupMenu(true);
    }
  });

  // --- Split View ---
  function toggleSplitView(forceState) {
    isSplitMode = forceState !== undefined ? forceState : !isSplitMode;
    if (isSplitMode) {
      panelRight.classList.remove('hidden');
      panelLeft.classList.add('split-mode');
      panelRight.classList.add('split-mode');

      // Tentukan sesi kanan (pilih sesi lain atau buat baru)
      const other = sessions.find(s => s.id !== activeSessionId);
      if (other) {
        splitSessionId = other.id;
        mountTerminal(splitSessionId, containerRight);
      } else {
        apiFetch('/api/sessions', { method: 'POST' }).then(res => res.json()).then(newSess => {
          sessions.push(newSess);
          renderTabs();
          splitSessionId = newSess.id;
          mountTerminal(splitSessionId, containerRight);
        });
      }
    } else {
      panelRight.classList.add('hidden');
      panelLeft.classList.remove('split-mode');
      panelRight.classList.remove('split-mode');
      splitSessionId = null;
      focusedPanel = 'left';
      mountTerminal(activeSessionId, containerLeft);
    }
  }

  panelLeft.addEventListener('click', () => {
    focusedPanel = 'left';
    panelLeft.classList.add('active-panel');
    panelRight.classList.remove('active-panel');
    if (activeSessionId && terminalInstances[activeSessionId]) {
      terminalInstances[activeSessionId].term.focus();
    }
  });

  panelRight.addEventListener('click', () => {
    focusedPanel = 'right';
    panelRight.classList.add('active-panel');
    panelLeft.classList.remove('active-panel');
    if (splitSessionId && terminalInstances[splitSessionId]) {
      terminalInstances[splitSessionId].term.focus();
    }
  });

  // --- Sidebar Explorer ---
  function toggleSidebar(forceState) {
    const isCollapsed = forceState !== undefined ? !forceState : !sidebar.classList.contains('collapsed');
    if (isCollapsed) {
      sidebar.classList.add('collapsed');
    } else {
      sidebar.classList.remove('collapsed');
    }
  }

  btnCollapseSidebar.addEventListener('click', () => {
    toggleSidebar(false);
  });

  // --- Tombol Ekstra Keyboard ---
  function setCtrl(state) {
    ctrlActive = state;
    btnCtrl.classList.toggle('toggle-active', ctrlActive);
  }

  function setAlt(state) {
    altActive = state;
    btnAlt.classList.toggle('toggle-active', altActive);
  }

  function sendToActiveTerminal(text) {
    const sid = (isSplitMode && focusedPanel === 'right') ? splitSessionId : activeSessionId;
    if (sid && terminalInstances[sid]) {
      const inst = terminalInstances[sid];
      if (inst.ws && inst.ws.readyState === WebSocket.OPEN) {
        inst.ws.send(text);
      }
      inst.term.focus();
    }
  }

  extraKeysBar.addEventListener('click', (e) => {
    const btn = e.target.closest('.key-btn');
    if (!btn) return;
    const key = btn.dataset.key;
    if (key === 'Ctrl') {
      setCtrl(!ctrlActive);
      return;
    }
    if (key === 'Alt') {
      setAlt(!altActive);
      return;
    }

    if (activeTabType === 'editor') {
      if (key === 'Tab') {
        const start = editorTextarea.selectionStart;
        const end = editorTextarea.selectionEnd;
        editorTextarea.value = editorTextarea.value.substring(0, start) + '  ' + editorTextarea.value.substring(end);
        editorTextarea.selectionStart = editorTextarea.selectionEnd = start + 2;
        editorTextarea.dispatchEvent(new Event('input'));
        editorTextarea.focus();
      } else if (key === 'Left') {
        editorTextarea.selectionStart = editorTextarea.selectionEnd = Math.max(0, editorTextarea.selectionStart - 1);
        updateCursorPos();
        editorTextarea.focus();
      } else if (key === 'Right') {
        editorTextarea.selectionStart = editorTextarea.selectionEnd = Math.min(editorTextarea.value.length, editorTextarea.selectionStart + 1);
        updateCursorPos();
        editorTextarea.focus();
      }
      setCtrl(false);
      setAlt(false);
      return;
    }

    let code = '';
    if (key === 'Esc') {
      code = '\x1b';
    } else if (key === 'Tab') {
      code = '\t';
    } else if (key === 'Left') {
      code = ctrlActive ? '\x1b[1;5D' : (altActive ? '\x1b[1;3D' : '\x1b[D');
    } else if (key === 'Up') {
      code = ctrlActive ? '\x1b[1;5A' : (altActive ? '\x1b[1;3A' : '\x1b[A');
    } else if (key === 'Down') {
      code = ctrlActive ? '\x1b[1;5B' : (altActive ? '\x1b[1;3B' : '\x1b[B');
    } else if (key === 'Right') {
      code = ctrlActive ? '\x1b[1;5C' : (altActive ? '\x1b[1;3C' : '\x1b[C');
    }

    if (code) {
      if (altActive && !code.startsWith('\x1b[1;3')) {
        code = '\x1b' + code;
      }
      sendToActiveTerminal(code);
    }
    setCtrl(false);
    setAlt(false);
  });

  // --- Sidebar Explorer Tree ---
  const fileTree = document.getElementById('file-tree');

  function shellEscape(str) {
    if (/^[a-zA-Z0-9_\.\-\/]+$/.test(str)) {
      return str;
    }
    return "'" + str.replace(/'/g, "'\\''") + "'";
  }

  async function renderExplorerLevel(parentElement, path = null, depth = 0) {
    try {
      const endpoint = path ? `/api/fs?path=${encodeURIComponent(path)}` : '/api/fs';
      const res = await apiFetch(endpoint);
      if (!res.ok) {
        const err = document.createElement('div');
        err.className = 'tree-item';
        err.style.color = '#FF6B6B';
        err.style.paddingLeft = `${depth * 14 + 10}px`;
        err.textContent = 'Akses ditolak / Error';
        parentElement.appendChild(err);
        return;
      }
      const items = await res.json();
      parentElement.innerHTML = '';
      items.forEach(item => {
        const node = document.createElement('div');
        node.className = 'tree-node';

        const row = document.createElement('div');
        row.className = 'tree-item';
        row.style.paddingLeft = `${depth * 14 + 10}px`;

        const arrow = document.createElement('span');
        arrow.className = 'tree-arrow';
        arrow.textContent = item.type === 'dir' ? '▶' : ' ';
        row.appendChild(arrow);

        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        icon.textContent = item.type === 'dir' ? '📁' : '📄';
        row.appendChild(icon);

        const name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = item.name;
        row.appendChild(name);

        node.appendChild(row);

        if (item.type === 'dir') {
          const children = document.createElement('div');
          children.className = 'tree-children';
          children.style.display = 'none';
          node.appendChild(children);

          let loaded = false;
          row.addEventListener('click', async (e) => {
            e.stopPropagation();
            const isExpanded = children.style.display === 'flex';
            if (isExpanded) {
              children.style.display = 'none';
              arrow.textContent = '▶';
            } else {
              if (!loaded) {
                await renderExplorerLevel(children, item.path, depth + 1);
                loaded = true;
              }
              children.style.display = 'flex';
              arrow.textContent = '▼';
            }
          });
        } else {
          const actionSend = document.createElement('span');
          actionSend.className = 'tree-action-send';
          actionSend.textContent = '>_';
          actionSend.title = 'Kirim path ke terminal aktif';
          actionSend.addEventListener('click', (e) => {
            e.stopPropagation();
            const escaped = shellEscape(item.path);
            sendToActiveTerminal(escaped + ' ');
          });
          row.appendChild(actionSend);

          row.addEventListener('click', (e) => {
            e.stopPropagation();
            openFileInEditor(item.path);
          });
        }

        parentElement.appendChild(node);
      });
    } catch (err) {
      console.error('Gagal memuat explorer:', err);
    }
  }

  // Inisialisasi awal
  loadSessions();
  renderExplorerLevel(fileTree);
})();
