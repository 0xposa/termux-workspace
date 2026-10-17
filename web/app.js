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
  const terminalContainer = document.getElementById('terminal-container');
  const btnCtrl = document.getElementById('btn-ctrl');
  const btnAlt = document.getElementById('btn-alt');
  const extraKeysBar = document.getElementById('extra-keys-bar');

  // State & Elemen DOM Code Editor (CodeMirror 6)
  let activeTabType = 'terminal'; // 'terminal' | 'editor'
  let currentEditingPath = null;
  let cmEditorView = null;
  const openFiles = {}; // { [path]: { name, content, originalContent, isDirty } }

  const editorArea = document.getElementById('editor-area');
  const terminalArea = document.getElementById('terminal-area');
  const editorActionsBar = document.getElementById('editor-actions-bar');
  const editorStatus = document.getElementById('editor-status');
  const editorCmContainer = document.getElementById('editor-cm-container');
  const editorCursorPos = document.getElementById('editor-cursor-pos');
  const btnSaveFile = document.getElementById('btn-save-file');
  const btnSendToTerminal = document.getElementById('btn-send-to-terminal');

  // Elemen Context Menu & Modal Filesystem
  const explorerContextMenu = document.getElementById('explorer-context-menu');
  let activeContextItem = null; // { path, name, type }

  const fsModal = document.getElementById('fs-modal');
  const fsModalTitle = document.getElementById('fs-modal-title');
  const fsModalMessage = document.getElementById('fs-modal-message');
  const fsModalInput = document.getElementById('fs-modal-input');
  const fsModalCancel = document.getElementById('fs-modal-cancel');
  const fsModalConfirm = document.getElementById('fs-modal-confirm');
  let fsModalResolve = null;

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

  async function createNewSession(cwd = null) {
    try {
      const endpoint = cwd ? `/api/sessions?cwd=${encodeURIComponent(cwd)}` : '/api/sessions';
      const res = await apiFetch(endpoint, { method: 'POST' });
      if (res.ok) {
        const newSession = await res.json();
        sessions.push(newSession);
        renderTabs();
        switchToSession(newSession.id);
        return newSession;
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

      const tabIcon = document.createElement('img');
      tabIcon.className = 'tab-icon';
      tabIcon.src = '/icons/terminal.svg';
      tabIcon.width = 14;
      tabIcon.height = 14;
      tabIcon.alt = '';
      tab.appendChild(tabIcon);

      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = sess.name;
      tab.appendChild(title);

      if (isActive) {
        const btnClose = document.createElement('span');
        btnClose.className = 'tab-close';
        btnClose.title = 'Tutup sesi';
        const closeIcon = document.createElement('img');
        closeIcon.className = 'tab-close-icon';
        closeIcon.src = '/icons/close.svg';
        closeIcon.width = 10;
        closeIcon.height = 10;
        closeIcon.alt = '';
        btnClose.appendChild(closeIcon);
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

      const tabIcon = document.createElement('img');
      tabIcon.className = 'tab-icon';
      tabIcon.src = '/icons/file.svg';
      tabIcon.width = 14;
      tabIcon.height = 14;
      tabIcon.alt = '';
      tab.appendChild(tabIcon);

      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = `${fileData.name}${fileData.isDirty ? ' ●' : ''}`;
      tab.appendChild(title);

      if (isActive) {
        const btnClose = document.createElement('span');
        btnClose.className = 'tab-close';
        btnClose.title = 'Tutup file';
        const closeIcon = document.createElement('img');
        closeIcon.className = 'tab-close-icon';
        closeIcon.src = '/icons/close.svg';
        closeIcon.width = 10;
        closeIcon.height = 10;
        closeIcon.alt = '';
        btnClose.appendChild(closeIcon);
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
    if (editorActionsBar) editorActionsBar.classList.add('hidden');

    renderTabs();

    setTimeout(() => {
      const activeTabEl = tabsContainer.querySelector('.tab.active');
      if (activeTabEl) {
        activeTabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }, 50);

    mountTerminal(activeSessionId, terminalContainer);
  }

  // --- Fungsi Code Editor (CodeMirror 6) ---
  function isReadableTextFile(filename) {
    const binaryExts = [
      '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.bmp', '.pdf',
      '.zip', '.tar', '.gz', '.tgz', '.bz2', '.xz', '.7z', '.apk', '.jar',
      '.so', '.a', '.dylib', '.bin', '.exe', '.pyc', '.wasm', '.mp3',
      '.mp4', '.m4a', '.wav', '.ogg', '.webm', '.flac', '.avi', '.mkv'
    ];
    const lower = filename.toLowerCase();
    return !binaryExts.some(ext => lower.endsWith(ext));
  }

  function getLanguageExtension(filename) {
    if (!window.CM6 || !window.CM6.languages) return [];
    const parts = filename.split('.');
    if (parts.length < 2) return [];
    const ext = parts.pop().toLowerCase();
    const langFn = window.CM6.languages[ext];
    if (typeof langFn === 'function') {
      try {
        return [langFn()];
      } catch (e) {
        return [];
      }
    }
    return [];
  }

  function updateCM6Editor(content, filename) {
    if (!window.CM6) {
      console.error('CodeMirror 6 library belum siap');
      return;
    }
    const { EditorView, EditorState, basicSetup, oneDark, keymap, defaultKeymap, indentWithTab } = window.CM6;
    const langExt = getLanguageExtension(filename);

    const extensions = [
      basicSetup,
      oneDark,
      keymap.of([
        ...defaultKeymap,
        indentWithTab,
        {
          key: 'Mod-s',
          run: () => {
            saveCurrentFile();
            return true;
          }
        }
      ]),
      EditorView.updateListener.of((update) => {
        if (update.docChanged) {
          if (!currentEditingPath || !openFiles[currentEditingPath]) return;
          const newDoc = cmEditorView.state.doc.toString();
          openFiles[currentEditingPath].content = newDoc;
          openFiles[currentEditingPath].isDirty = (newDoc !== openFiles[currentEditingPath].originalContent);
          updateEditorStatus();
          renderTabs();
        }
        if (update.selectionSet || update.docChanged) {
          updateCursorPos();
        }
      }),
      ...langExt
    ];

    if (!cmEditorView) {
      cmEditorView = new EditorView({
        state: EditorState.create({ doc: content, extensions }),
        parent: editorCmContainer
      });
    } else {
      cmEditorView.setState(EditorState.create({ doc: content, extensions }));
    }
    setTimeout(() => {
      if (cmEditorView) cmEditorView.focus();
    }, 60);
  }

  async function openFileInEditor(filePath) {
    if (openFiles[filePath]) {
      // Pindahkan ke posisi terbaru di tab
      const existingData = openFiles[filePath];
      delete openFiles[filePath];
      openFiles[filePath] = existingData;
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
    if (editorActionsBar) editorActionsBar.classList.remove('hidden');

    updateCM6Editor(fileData.content, fileData.name);
    updateEditorStatus();
    updateCursorPos();
    renderTabs();

    setTimeout(() => {
      const activeTabEl = tabsContainer.querySelector('.tab.active');
      if (activeTabEl) {
        activeTabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
      if (cmEditorView) cmEditorView.focus();
    }, 50);
  }

  function updateEditorStatus() {
    if (!editorStatus) return;
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
    if (!cmEditorView || !editorCursorPos) return;
    try {
      const pos = cmEditorView.state.selection.main.head;
      const line = cmEditorView.state.doc.lineAt(pos);
      const row = line.number;
      const col = pos - line.from + 1;
      editorCursorPos.textContent = `Ln ${row}, Col ${col}`;
    } catch (e) {}
  }

  async function saveCurrentFile() {
    if (!currentEditingPath || !openFiles[currentEditingPath] || !cmEditorView) return;
    const content = cmEditorView.state.doc.toString();
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
        if (btnSaveFile) {
          const originalHtml = btnSaveFile.innerHTML;
          btnSaveFile.innerHTML = `<img src="/icons/save.svg" width="14" height="14" class="editor-btn-icon" alt="" /><span class="btn-text">Tersimpan</span>`;
          setTimeout(() => {
            btnSaveFile.innerHTML = originalHtml;
          }, 1500);
        }
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
    const target = targetContainer || terminalContainer;
    const instance = getOrCreateTerminal(sessionId);
    if (!target.contains(instance.termWrap)) {
      target.innerHTML = '';
      target.appendChild(instance.termWrap);
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

  // Observer resize untuk terminal
  const resizeObserver = new ResizeObserver(() => {
    if (activeSessionId && terminalInstances[activeSessionId]) {
      try {
        terminalInstances[activeSessionId].fitAddon.fit();
        const { cols, rows } = terminalInstances[activeSessionId].term;
        if (terminalInstances[activeSessionId].ws && terminalInstances[activeSessionId].ws.readyState === WebSocket.OPEN) {
          terminalInstances[activeSessionId].ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      } catch (e) {}
    }
  });
  if (terminalContainer) {
    resizeObserver.observe(terminalContainer);
  }

  // --- Tombol Tambah & Menu Popup ---
  btnAddSession.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePopupMenu();
  });

  function togglePopupMenu(forceState) {
    const show = forceState !== undefined ? forceState : popupMenu.classList.contains('hidden');
    if (show) {
      const btnRect = btnAddSession.getBoundingClientRect();
      const mainRect = document.querySelector('.main-area').getBoundingClientRect();
      let left = btnRect.left - mainRect.left;
      if (left + 240 > mainRect.width) {
        left = Math.max(8, mainRect.width - 248);
      }
      popupMenu.style.left = `${Math.max(8, left)}px`;
      popupMenu.style.top = `${btnRect.bottom - mainRect.top + 6}px`;
      popupMenu.style.right = 'auto';

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
    { id: 'close', name: 'Close Tab', action: () => { if (activeSessionId) closeSession(activeSessionId); togglePopupMenu(false); } }
  ];

  function filterPopupActions(query) {
    const q = query.trim().toLowerCase();
    popupItemsContainer.innerHTML = '';
    const filtered = popupActions.filter(a => a.name.toLowerCase().includes(q));

    filtered.forEach((act) => {
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

  // --- Sidebar Explorer ---
  function toggleSidebar(forceState) {
    const isCollapsed = forceState !== undefined ? !forceState : !sidebar.classList.contains('collapsed');
    const collapseImg = btnCollapseSidebar.querySelector('img');
    if (isCollapsed) {
      sidebar.classList.add('collapsed');
      if (collapseImg) collapseImg.src = '/icons/arrow-right.svg';
    } else {
      sidebar.classList.remove('collapsed');
      if (collapseImg) collapseImg.src = '/icons/arrow-left.svg';
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
    if (activeSessionId && terminalInstances[activeSessionId]) {
      const inst = terminalInstances[activeSessionId];
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

    if (activeTabType === 'editor' && cmEditorView) {
      if (key === 'Tab') {
        cmEditorView.dispatch(cmEditorView.state.replaceSelection('  '));
        cmEditorView.focus();
      } else if (key === 'Left') {
        const head = cmEditorView.state.selection.main.head;
        cmEditorView.dispatch({ selection: { anchor: Math.max(0, head - 1) } });
        cmEditorView.focus();
      } else if (key === 'Right') {
        const head = cmEditorView.state.selection.main.head;
        cmEditorView.dispatch({ selection: { anchor: Math.min(cmEditorView.state.doc.length, head + 1) } });
        cmEditorView.focus();
      } else if (key === 'Up') {
        const head = cmEditorView.state.selection.main.head;
        const line = cmEditorView.state.doc.lineAt(head);
        if (line.number > 1) {
          const prevLine = cmEditorView.state.doc.line(line.number - 1);
          const col = head - line.from;
          const newPos = Math.min(prevLine.to, prevLine.from + col);
          cmEditorView.dispatch({ selection: { anchor: newPos } });
        }
        cmEditorView.focus();
      } else if (key === 'Down') {
        const head = cmEditorView.state.selection.main.head;
        const line = cmEditorView.state.doc.lineAt(head);
        if (line.number < cmEditorView.state.doc.lines) {
          const nextLine = cmEditorView.state.doc.line(line.number + 1);
          const col = head - line.from;
          const newPos = Math.min(nextLine.to, nextLine.from + col);
          cmEditorView.dispatch({ selection: { anchor: newPos } });
        }
        cmEditorView.focus();
      } else if (key === 'Esc') {
        cmEditorView.contentDOM.blur();
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

  // --- Modal Dialog Filesystem ---
  function showFsModal({ title, message, defaultValue = '', showInput = true, confirmText = 'Lanjutkan', isDanger = false }) {
    return new Promise((resolve) => {
      fsModalTitle.textContent = title;
      fsModalMessage.textContent = message;
      fsModalConfirm.textContent = confirmText;
      fsModalConfirm.className = `fs-modal-btn ${isDanger ? 'danger' : 'confirm'}`;

      if (showInput) {
        fsModalInput.style.display = 'block';
        fsModalInput.value = defaultValue;
      } else {
        fsModalInput.style.display = 'none';
      }

      fsModal.classList.remove('hidden');
      if (showInput) {
        setTimeout(() => {
          fsModalInput.focus();
          fsModalInput.select();
        }, 50);
      }

      fsModalResolve = resolve;
    });
  }

  function closeFsModal(result = null) {
    fsModal.classList.add('hidden');
    if (fsModalResolve) {
      fsModalResolve(result);
      fsModalResolve = null;
    }
  }

  fsModalCancel.addEventListener('click', () => closeFsModal(null));
  fsModalConfirm.addEventListener('click', () => {
    closeFsModal(fsModalInput.value.trim());
  });

  fsModalInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      closeFsModal(fsModalInput.value.trim());
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeFsModal(null);
    }
  });

  // --- Context Menu Explorer ---
  function hideContextMenu() {
    explorerContextMenu.classList.add('hidden');
    activeContextItem = null;
  }

  document.addEventListener('click', (e) => {
    if (!explorerContextMenu.contains(e.target)) {
      hideContextMenu();
    }
  });

  function showContextMenu(e, item) {
    activeContextItem = item;
    const isDir = item.type === 'dir';
    const isReadable = !isDir && isReadableTextFile(item.name);

    const itemTerminal = explorerContextMenu.querySelector('[data-action="open-terminal"]');
    const itemEditor = explorerContextMenu.querySelector('[data-action="open-editor"]');

    // Opsi terminal hanya berfungsi untuk folder
    if (isDir) {
      itemTerminal.classList.remove('disabled');
    } else {
      itemTerminal.classList.add('disabled');
    }

    // Opsi editor hanya berfungsi pada file yang bisa dibaca pada editor
    if (isReadable) {
      itemEditor.classList.remove('disabled');
    } else {
      itemEditor.classList.add('disabled');
    }

    explorerContextMenu.classList.remove('hidden');

    const rect = e.target.getBoundingClientRect();
    const menuWidth = 190;
    const menuHeight = 220;
    let left = rect.right + 4;
    let top = rect.top;

    if (left + menuWidth > window.innerWidth) {
      left = rect.left - menuWidth;
    }
    if (top + menuHeight > window.innerHeight) {
      top = window.innerHeight - menuHeight - 8;
    }
    explorerContextMenu.style.left = `${Math.max(8, left)}px`;
    explorerContextMenu.style.top = `${Math.max(8, top)}px`;
  }

  explorerContextMenu.addEventListener('click', async (e) => {
    const menuItem = e.target.closest('.context-menu-item');
    if (!menuItem || menuItem.classList.contains('disabled')) return;
    const action = menuItem.dataset.action;
    const targetItem = activeContextItem;
    hideContextMenu();
    if (!targetItem) return;

    if (action === 'open-terminal') {
      if (targetItem.type === 'dir') {
        await createNewSession(targetItem.path);
      }
    } else if (action === 'open-editor') {
      if (targetItem.type !== 'dir' && isReadableTextFile(targetItem.name)) {
        openFileInEditor(targetItem.path);
      }
    } else if (action === 'rename') {
      const newName = await showFsModal({
        title: 'Ganti Nama',
        message: `Ubah nama "${targetItem.name}":`,
        defaultValue: targetItem.name,
        confirmText: 'Simpan'
      });
      if (newName && newName !== targetItem.name) {
        try {
          const res = await apiFetch('/api/fs/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: targetItem.path, new_name: newName })
          });
          if (res.ok) {
            const data = await res.json();
            if (openFiles[targetItem.path]) {
              openFiles[data.new_path] = { ...openFiles[targetItem.path], name: newName };
              delete openFiles[targetItem.path];
              if (currentEditingPath === targetItem.path) {
                currentEditingPath = data.new_path;
              }
              renderTabs();
            }
            refreshExplorerTree();
          } else {
            const err = await res.json().catch(() => ({ detail: 'Gagal mengubah nama' }));
            alert(err.detail || 'Gagal mengubah nama');
          }
        } catch (err) {
          console.error('Error rename:', err);
        }
      }
    } else if (action === 'move') {
      const defaultDest = targetItem.path.substring(0, targetItem.path.lastIndexOf('/'));
      const dest = await showFsModal({
        title: 'Pindahkan',
        message: `Pindahkan "${targetItem.name}" ke folder tujuan:`,
        defaultValue: defaultDest,
        confirmText: 'Pindahkan'
      });
      if (dest && dest !== targetItem.path) {
        try {
          const res = await apiFetch('/api/fs/move', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: targetItem.path, destination: dest })
          });
          if (res.ok) {
            const data = await res.json();
            if (openFiles[targetItem.path]) {
              openFiles[data.destination] = openFiles[targetItem.path];
              delete openFiles[targetItem.path];
              if (currentEditingPath === targetItem.path) {
                currentEditingPath = data.destination;
              }
              renderTabs();
            }
            refreshExplorerTree();
          } else {
            const err = await res.json().catch(() => ({ detail: 'Gagal memindahkan file/folder' }));
            alert(err.detail || 'Gagal memindahkan file/folder');
          }
        } catch (err) {
          console.error('Error move:', err);
        }
      }
    } else if (action === 'delete') {
      const confirmDelete = await showFsModal({
        title: targetItem.type === 'dir' ? 'Hapus Folder' : 'Hapus File',
        message: `Apakah Anda yakin ingin menghapus "${targetItem.name}"? Tindakan ini bersifat permanen.`,
        showInput: false,
        confirmText: 'Hapus',
        isDanger: true
      });
      if (confirmDelete !== null) {
        try {
          const res = await apiFetch(`/api/fs?path=${encodeURIComponent(targetItem.path)}`, {
            method: 'DELETE'
          });
          if (res.ok) {
            if (openFiles[targetItem.path]) {
              closeFile(targetItem.path);
            }
            refreshExplorerTree();
          } else {
            const err = await res.json().catch(() => ({ detail: 'Gagal menghapus' }));
            alert(err.detail || 'Gagal menghapus');
          }
        } catch (err) {
          console.error('Error delete:', err);
        }
      }
    }
  });

  // --- Sidebar Explorer Tree ---
  const fileTree = document.getElementById('file-tree');

  function shellEscape(str) {
    if (/^[a-zA-Z0-9_\.\-\/]+$/.test(str)) {
      return str;
    }
    return "'" + str.replace(/'/g, "'\\''") + "'";
  }

  function refreshExplorerTree() {
    renderExplorerLevel(fileTree);
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
        if (item.type === 'dir') {
          const arrowImg = document.createElement('img');
          arrowImg.className = 'tree-arrow-img';
          arrowImg.src = '/icons/arrow-right.svg';
          arrowImg.width = 10;
          arrowImg.height = 10;
          arrowImg.alt = '';
          arrow.appendChild(arrowImg);
        }
        row.appendChild(arrow);

        const icon = document.createElement('span');
        icon.className = 'tree-icon';
        const iconImg = document.createElement('img');
        iconImg.className = 'tree-icon-img';
        iconImg.src = item.type === 'dir' ? '/icons/folder.svg' : '/icons/file.svg';
        iconImg.width = 15;
        iconImg.height = 15;
        iconImg.alt = '';
        icon.appendChild(iconImg);
        row.appendChild(icon);

        const name = document.createElement('span');
        name.className = 'tree-name';
        name.textContent = item.name;
        row.appendChild(name);

        // Tombol Titik Tiga untuk Menu Opsi
        const dots = document.createElement('span');
        dots.className = 'tree-dots';
        dots.title = 'Menu opsi';
        const dotsImg = document.createElement('img');
        dotsImg.className = 'tree-dots-img';
        dotsImg.src = '/icons/dots.svg';
        dotsImg.width = 14;
        dotsImg.height = 14;
        dotsImg.alt = '';
        dots.appendChild(dotsImg);
        dots.addEventListener('click', (e) => {
          e.stopPropagation();
          showContextMenu(e, item);
        });
        row.appendChild(dots);

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
            const arrowImg = arrow.querySelector('.tree-arrow-img');
            if (isExpanded) {
              children.style.display = 'none';
              if (arrowImg) arrowImg.src = '/icons/arrow-right.svg';
            } else {
              if (!loaded) {
                await renderExplorerLevel(children, item.path, depth + 1);
                loaded = true;
              }
              children.style.display = 'flex';
              if (arrowImg) arrowImg.src = '/icons/arrow-down.svg';
            }
          });
        } else {
          row.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isReadableTextFile(item.name)) {
              openFileInEditor(item.path);
            }
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
