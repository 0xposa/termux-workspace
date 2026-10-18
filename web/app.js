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
  // Helper Ikon dan Badge File/Folder
  function getFileIcon(filename, isDir) {
    if (isDir) return '/icons/folder.svg';
    const lower = filename.toLowerCase();
    if (lower === '.gitignore' || lower === '.gitattributes' || lower === '.gitmodules') return '/icons/file-git.svg';
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return '/icons/file-html.svg';
    if (lower.endsWith('.py') || lower.endsWith('.pyw') || lower.endsWith('.ipynb')) return '/icons/file-python.svg';
    if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return '/icons/file-js.svg';
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return '/icons/file-ts.svg';
    if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.sass') || lower.endsWith('.less')) return '/icons/file-css.svg';
    if (lower.endsWith('.json')) return '/icons/file-json.svg';
    if (lower.endsWith('.md') || lower.endsWith('.markdown')) return '/icons/file-md.svg';
    if (lower.endsWith('.sh') || lower.endsWith('.bash') || lower.endsWith('.zsh')) return '/icons/file-sh.svg';
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp') || lower.endsWith('.svg') || lower.endsWith('.ico')) return '/icons/file-image.svg';
    if (lower.endsWith('.yml') || lower.endsWith('.yaml') || lower.endsWith('.toml') || lower.endsWith('.ini') || lower.endsWith('.env') || lower.endsWith('.conf') || lower.endsWith('.config')) return '/icons/file-config.svg';
    if (lower.endsWith('.zip') || lower.endsWith('.tar') || lower.endsWith('.gz') || lower.endsWith('.tgz') || lower.endsWith('.bz2') || lower.endsWith('.xz') || lower.endsWith('.7z')) return '/icons/file-archive.svg';
    return '/icons/file.svg';
  }

  function getFileBadge(filename, isDir) {
    if (isDir) return { text: 'Folder', cls: 'badge-folder' };
    const lower = filename.toLowerCase();
    if (lower.endsWith('.html') || lower.endsWith('.htm')) return { text: 'HTML', cls: 'badge-html' };
    if (lower.endsWith('.py') || lower.endsWith('.pyw') || lower.endsWith('.ipynb')) return { text: 'Python', cls: 'badge-py' };
    if (lower.endsWith('.js') || lower.endsWith('.mjs') || lower.endsWith('.cjs')) return { text: 'JavaScript', cls: 'badge-js' };
    if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return { text: 'TypeScript', cls: 'badge-js' };
    if (lower.endsWith('.css') || lower.endsWith('.scss') || lower.endsWith('.sass')) return { text: 'CSS', cls: 'badge-css' };
    if (lower.endsWith('.json')) return { text: 'JSON', cls: 'badge-folder' };
    if (lower.endsWith('.md')) return { text: 'Markdown', cls: 'badge-css' };
    if (lower.endsWith('.sh')) return { text: 'Shell', cls: 'badge-folder' };
    if (lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.svg')) return { text: 'Image', cls: '' };
    if (lower.startsWith('.git')) return { text: 'Git', cls: 'badge-html' };
    const dotIdx = filename.lastIndexOf('.');
    if (dotIdx > 0) {
      return { text: filename.substring(dotIdx + 1).toUpperCase(), cls: '' };
    }
    return { text: 'File', cls: '' };
  }

  // State & Elemen DOM Full Explorer
  let isExplorerOpen = true;
  let currentExplorerPath = null;
  let currentExplorerItems = [];
  let showHiddenFiles = false; // Default: file tersembunyi disembunyikan
  let explorerViewMode = localStorage.getItem('termux_ws_view_mode') || 'list'; // 'list' | 'grid'

  const explorerArea = document.getElementById('explorer-area');
  const explorerList = document.getElementById('explorer-list');
  const explorerTableHeader = document.querySelector('.explorer-table-header');
  const explorerBreadcrumbs = document.getElementById('explorer-breadcrumbs');
  const explorerSearchInput = document.getElementById('explorer-search-input');
  const explorerBtnUp = document.getElementById('explorer-btn-up');
  const explorerBtnRefresh = document.getElementById('explorer-btn-refresh');
  const explorerBtnToggleHidden = document.getElementById('explorer-btn-toggle-hidden');
  const explorerIconHiddenOff = document.getElementById('explorer-icon-hidden-off');
  const explorerIconHiddenOn = document.getElementById('explorer-icon-hidden-on');
  const explorerBtnViewList = document.getElementById('explorer-btn-view-list');
  const explorerBtnViewGrid = document.getElementById('explorer-btn-view-grid');
  const explorerBtnNewFile = document.getElementById('explorer-btn-new-file');
  const explorerBtnNewFolder = document.getElementById('explorer-btn-new-folder');
  const explorerBtnOpenTerminal = document.getElementById('explorer-btn-open-terminal');
  const explorerItemCount = document.getElementById('explorer-item-count');
  const explorerCurrentPathDisplay = document.getElementById('explorer-current-path-display');
  const terminalContainer = document.getElementById('terminal-container');
  const btnCtrl = document.getElementById('btn-ctrl');
  const btnAlt = document.getElementById('btn-alt');
  const extraKeysBar = document.getElementById('extra-keys-bar');

  // State & Elemen DOM Code Editor (CodeMirror 6)
  let activeTabType = 'explorer'; // 'explorer' | 'terminal' | 'editor'
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
  const explorerBgContextMenu = document.getElementById('explorer-bg-context-menu');
  const terminalContextMenu = document.getElementById('terminal-context-menu');
  const explorerContent = document.getElementById('explorer-content');
  const contextMenuBackdrop = document.getElementById('context-menu-backdrop');
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
        await createNewSession(null, activeTabType === 'terminal');
      } else {
        if (!activeSessionId) {
          activeSessionId = sessions[0].id;
        }
        renderTabs();
        if (activeTabType === 'terminal') {
          switchToSession(activeSessionId);
        }
      }
    } catch (e) {
      console.error('Gagal memuat sesi:', e);
    }
  }

  async function createNewSession(cwd = null, autoSwitch = true) {
    try {
      const endpoint = cwd ? `/api/sessions?cwd=${encodeURIComponent(cwd)}` : '/api/sessions';
      const res = await apiFetch(endpoint, { method: 'POST' });
      if (res.ok) {
        const newSession = await res.json();
        sessions.push(newSession);
        renderTabs();
        if (autoSwitch) {
          switchToSession(newSession.id);
        }
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

    // Tab Explorer (tampil pertama sebagai tab utama)
    if (isExplorerOpen) {
      const tab = document.createElement('div');
      const isActive = activeTabType === 'explorer';
      tab.className = `tab ${isActive ? 'active' : ''}`;

      const tabIcon = document.createElement('img');
      tabIcon.className = 'tab-icon';
      tabIcon.src = '/icons/folder.svg';
      tabIcon.width = 14;
      tabIcon.height = 14;
      tabIcon.alt = '';
      tab.appendChild(tabIcon);

      const title = document.createElement('span');
      title.className = 'tab-title';
      title.textContent = 'Explorer';
      tab.appendChild(title);

      const btnClose = document.createElement('span');
      btnClose.className = 'tab-close';
      btnClose.title = 'Tutup explorer';
      const closeIcon = document.createElement('img');
      closeIcon.className = 'tab-close-icon';
      closeIcon.src = '/icons/close.svg';
      closeIcon.width = 10;
      closeIcon.height = 10;
      closeIcon.alt = '';
      btnClose.appendChild(closeIcon);
      btnClose.addEventListener('click', (e) => {
        e.stopPropagation();
        closeExplorer();
      });
      tab.appendChild(btnClose);

      tab.addEventListener('click', () => {
        switchToExplorer();
      });

      tabsContainer.appendChild(tab);
    }

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
      tabIcon.src = getFileIcon(fileData.name, false);
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
    hideAllContextMenus();
    activeTabType = 'terminal';
    activeSessionId = sessionId;

    editorArea.classList.add('hidden');
    explorerArea.classList.add('hidden');
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

  function openExplorer(targetPath = null) {
    isExplorerOpen = true;
    switchToExplorer();
    loadExplorerPath(targetPath || currentExplorerPath);
  }

  function switchToExplorer() {
    hideAllContextMenus();
    activeTabType = 'explorer';

    terminalArea.classList.add('hidden');
    editorArea.classList.add('hidden');
    explorerArea.classList.remove('hidden');
    if (editorActionsBar) editorActionsBar.classList.add('hidden');

    renderTabs();

    setTimeout(() => {
      const activeTabEl = tabsContainer.querySelector('.tab.active');
      if (activeTabEl) {
        activeTabEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
      }
    }, 50);
  }

  function closeExplorer() {
    isExplorerOpen = false;
    if (activeTabType === 'explorer') {
      const remainingPaths = Object.keys(openFiles);
      if (remainingPaths.length > 0) {
        switchToEditor(remainingPaths[remainingPaths.length - 1]);
      } else if (activeSessionId) {
        switchToSession(activeSessionId);
      } else if (sessions.length > 0) {
        switchToSession(sessions[0].id);
      } else {
        renderTabs();
      }
    } else {
      renderTabs();
    }
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
    hideAllContextMenus();
    activeTabType = 'editor';
    currentEditingPath = filePath;

    terminalArea.classList.add('hidden');
    explorerArea.classList.add('hidden');
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
      if (cmEditorView) {
        if (typeof cmEditorView.requestMeasure === 'function') {
          cmEditorView.requestMeasure();
        }
        cmEditorView.focus();
      }
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
      } else if (isExplorerOpen) {
        switchToExplorer();
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

    // Hapus dan blokir pop up klik kanan lama bawaan browser / xterm, lalu tampilkan context menu baru yang sempurna
    termWrap.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (isAnyContextMenuVisible()) {
        hideAllContextMenus();
        return;
      }
      const inst = activeSessionId ? terminalInstances[activeSessionId] : null;
      if (inst) inst.term.focus();
      showTerminalContextMenu(e);
    }, true);

    if (term.textarea) {
      term.textarea.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        if (isAnyContextMenuVisible()) {
          hideAllContextMenus();
          return;
        }
        const inst = activeSessionId ? terminalInstances[activeSessionId] : null;
        if (inst) inst.term.focus();
        showTerminalContextMenu(e);
      }, true);
    }

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
      if (!('ontouchstart' in window) && window.innerWidth > 600) {
        setTimeout(() => popupSearchInput.focus(), 50);
      }
    } else {
      popupMenu.classList.add('hidden');
    }
  }

  document.addEventListener('click', (e) => {
    if (!popupMenu.contains(e.target) && !btnAddSession.contains(e.target)) {
      togglePopupMenu(false);
    }
  });

  // Aksi Popup
  const popupActions = [
    { id: 'terminal', name: 'Terminal', action: () => { createNewSession(); togglePopupMenu(false); } },
    { id: 'explorer', name: 'Explorer', action: () => { openExplorer(); togglePopupMenu(false); } },
    { id: 'close', name: 'Close Tab', action: () => {
      if (activeTabType === 'editor' && currentEditingPath) {
        closeFile(currentEditingPath);
      } else if (activeTabType === 'explorer') {
        closeExplorer();
      } else if (activeSessionId) {
        closeSession(activeSessionId);
      }
      togglePopupMenu(false);
    }}
  ];

  // Delegasi klik pada kontainer popup items
  if (popupItemsContainer) {
    popupItemsContainer.addEventListener('click', (e) => {
      const item = e.target.closest('.popup-item');
      if (!item) return;
      e.stopPropagation();
      const actionType = item.dataset.action;
      if (actionType === 'explorer') {
        openExplorer();
        togglePopupMenu(false);
      } else if (actionType === 'terminal') {
        createNewSession();
        togglePopupMenu(false);
      } else if (actionType === 'close') {
        if (activeTabType === 'editor' && currentEditingPath) {
          closeFile(currentEditingPath);
        } else if (activeTabType === 'explorer') {
          closeExplorer();
        } else if (activeSessionId) {
          closeSession(activeSessionId);
        }
        togglePopupMenu(false);
      }
    });
  }

  function filterPopupActions(query) {
    const q = query.trim().toLowerCase();
    popupItemsContainer.innerHTML = '';
    const filtered = popupActions.filter(a => a.name.toLowerCase().includes(q));

    filtered.forEach((act) => {
      const item = document.createElement('div');
      item.className = 'popup-item';
      item.dataset.action = act.id;
      item.textContent = act.name;
      item.addEventListener('click', (e) => {
        e.stopPropagation();
        act.action();
      });
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

  // --- Context Menu Explorer, Terminal & Background ---
  function isAnyContextMenuVisible() {
    return Boolean(
      (explorerContextMenu && !explorerContextMenu.classList.contains('hidden')) ||
      (terminalContextMenu && !terminalContextMenu.classList.contains('hidden')) ||
      (explorerBgContextMenu && !explorerBgContextMenu.classList.contains('hidden'))
    );
  }

  function showContextMenuBackdrop() {
    if (contextMenuBackdrop) {
      contextMenuBackdrop.classList.remove('hidden');
    }
  }

  function hideContextMenuBackdrop() {
    if (contextMenuBackdrop) {
      contextMenuBackdrop.classList.add('hidden');
    }
  }

  function hideContextMenu() {
    if (explorerContextMenu) explorerContextMenu.classList.add('hidden');
    activeContextItem = null;
    if (!isAnyContextMenuVisible()) {
      hideContextMenuBackdrop();
    }
  }

  function hideTerminalContextMenu() {
    if (terminalContextMenu) terminalContextMenu.classList.add('hidden');
    if (!isAnyContextMenuVisible()) {
      hideContextMenuBackdrop();
    }
  }

  function hideExplorerBgContextMenu() {
    if (explorerBgContextMenu) explorerBgContextMenu.classList.add('hidden');
    if (!isAnyContextMenuVisible()) {
      hideContextMenuBackdrop();
    }
  }

  function hideAllContextMenus() {
    if (explorerContextMenu) explorerContextMenu.classList.add('hidden');
    if (terminalContextMenu) terminalContextMenu.classList.add('hidden');
    if (explorerBgContextMenu) explorerBgContextMenu.classList.add('hidden');
    activeContextItem = null;
    hideContextMenuBackdrop();
  }

  // Listener Backdrop Transparan: Menangkap klik kiri & kanan di luar menu
  if (contextMenuBackdrop) {
    contextMenuBackdrop.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideAllContextMenus();
    });
    contextMenuBackdrop.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      hideAllContextMenus();
    });
  }

  document.addEventListener('click', (e) => {
    if (isAnyContextMenuVisible()) {
      const isInsideAnyMenu =
        (explorerContextMenu && explorerContextMenu.contains(e.target)) ||
        (terminalContextMenu && terminalContextMenu.contains(e.target)) ||
        (explorerBgContextMenu && explorerBgContextMenu.contains(e.target));
      if (!isInsideAnyMenu) {
        hideAllContextMenus();
      }
    }
  });

  document.addEventListener('keydown', (e) => {
    if (isAnyContextMenuVisible()) {
      hideAllContextMenus();
    }
  });

  function showContextMenu(e, item) {
    hideTerminalContextMenu();
    hideExplorerBgContextMenu();
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
    showContextMenuBackdrop();

    let left, top;
    if (e.clientX !== undefined && e.clientY !== undefined) {
      left = e.clientX;
      top = e.clientY;
    } else if (e.touches && e.touches[0]) {
      left = e.touches[0].clientX;
      top = e.touches[0].clientY;
    } else {
      const rect = e.target.getBoundingClientRect();
      left = rect.right + 4;
      top = rect.top;
    }

    const menuWidth = 195;
    const menuHeight = 220;

    if (left + menuWidth > window.innerWidth) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (top + menuHeight > window.innerHeight) {
      top = Math.max(8, window.innerHeight - menuHeight - 8);
    }
    explorerContextMenu.style.left = `${Math.max(8, left)}px`;
    explorerContextMenu.style.top = `${Math.max(8, top)}px`;
  }

  // --- Context Menu Terminal Khas Desktop ---
  function showTerminalContextMenu(e) {
    hideContextMenu();
    hideExplorerBgContextMenu();
    if (!terminalContextMenu) return;

    const inst = activeSessionId ? terminalInstances[activeSessionId] : null;
    const hasSelection = inst && inst.term && inst.term.hasSelection();
    const copyItem = terminalContextMenu.querySelector('[data-action="term-copy"]');
    if (copyItem) {
      if (hasSelection) {
        copyItem.classList.remove('disabled');
      } else {
        copyItem.classList.add('disabled');
      }
    }

    terminalContextMenu.classList.remove('hidden');
    showContextMenuBackdrop();

    let left, top;
    if (e.clientX !== undefined && e.clientY !== undefined) {
      left = e.clientX;
      top = e.clientY;
    } else if (e.touches && e.touches[0]) {
      left = e.touches[0].clientX;
      top = e.touches[0].clientY;
    } else {
      left = window.innerWidth / 2 - 110;
      top = window.innerHeight / 2 - 90;
    }

    const menuWidth = 230;
    const menuHeight = 210;
    if (left + menuWidth > window.innerWidth) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (top + menuHeight > window.innerHeight) {
      top = Math.max(8, window.innerHeight - menuHeight - 8);
    }

    terminalContextMenu.style.left = `${Math.max(8, left)}px`;
    terminalContextMenu.style.top = `${Math.max(8, top)}px`;
  }

  if (terminalContextMenu) {
    terminalContextMenu.addEventListener('click', async (e) => {
      const menuItem = e.target.closest('.context-menu-item');
      if (!menuItem || menuItem.classList.contains('disabled')) return;
      const action = menuItem.dataset.action;
      hideTerminalContextMenu();

      const inst = activeSessionId ? terminalInstances[activeSessionId] : null;
      if (!inst) return;

      if (action === 'term-copy') {
        const selection = inst.term.getSelection();
        if (selection) {
          let copied = false;
          if (navigator.clipboard && navigator.clipboard.writeText) {
            try {
              await navigator.clipboard.writeText(selection);
              copied = true;
            } catch (err) {}
          }
          if (!copied) {
            try {
              const ta = document.createElement('textarea');
              ta.value = selection;
              ta.style.position = 'fixed';
              ta.style.opacity = '0';
              document.body.appendChild(ta);
              ta.select();
              document.execCommand('copy');
              document.body.removeChild(ta);
            } catch (e) {}
          }
        }
        inst.term.focus();
      } else if (action === 'term-paste') {
        try {
          const text = await navigator.clipboard.readText();
          if (text && inst.ws && inst.ws.readyState === WebSocket.OPEN) {
            inst.ws.send(text);
          }
        } catch (err) {
          const text = prompt('Tempel teks ke terminal:');
          if (text && inst.ws && inst.ws.readyState === WebSocket.OPEN) {
            inst.ws.send(text);
          }
        }
        inst.term.focus();
      } else if (action === 'term-select-all') {
        inst.term.selectAll();
        inst.term.focus();
      } else if (action === 'term-clear') {
        inst.term.clear();
        if (inst.ws && inst.ws.readyState === WebSocket.OPEN) {
          inst.ws.send('\x0c'); // Ctrl+L
        }
        inst.term.focus();
      } else if (action === 'term-new-session') {
        await createNewSession();
      } else if (action === 'term-open-explorer') {
        openExplorer();
      }
    });
  }

  // Listener Klik Kanan & Klik Kiri pada Terminal Container
  if (terminalContainer) {
    // 1. Klik kanan pada terminal: cegah pop up browser lama dan tampilkan context menu desktop yang baru
    terminalContainer.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      if (isAnyContextMenuVisible()) {
        hideAllContextMenus();
        return;
      }
      const inst = activeSessionId ? terminalInstances[activeSessionId] : null;
      if (inst) inst.term.focus();
      showTerminalContextMenu(e);
    }, true);

    // 2. Klik kiri pada terminal: jika context menu terbuka, hanya bertindak menutupnya; jika tertutup, buka context menu
    terminalContainer.addEventListener('click', (e) => {
      if (terminalContextMenu && terminalContextMenu.contains(e.target)) return;
      if (isAnyContextMenuVisible()) {
        e.preventDefault();
        e.stopPropagation();
        hideAllContextMenus();
        return;
      }
      const inst = activeSessionId ? terminalInstances[activeSessionId] : null;
      if (inst) inst.term.focus();
      showTerminalContextMenu(e);
    });
  }

  // --- Context Menu Background Explorer (Area Kosong) ---
  function showExplorerBgContextMenu(e) {
    hideContextMenu();
    hideTerminalContextMenu();
    if (!explorerBgContextMenu) return;

    explorerBgContextMenu.classList.remove('hidden');
    showContextMenuBackdrop();

    let left, top;
    if (e.clientX !== undefined && e.clientY !== undefined) {
      left = e.clientX;
      top = e.clientY;
    } else if (e.touches && e.touches[0]) {
      left = e.touches[0].clientX;
      top = e.touches[0].clientY;
    } else {
      left = window.innerWidth / 2 - 100;
      top = window.innerHeight / 2 - 100;
    }

    const menuWidth = 200;
    const menuHeight = 200;
    if (left + menuWidth > window.innerWidth) {
      left = Math.max(8, window.innerWidth - menuWidth - 8);
    }
    if (top + menuHeight > window.innerHeight) {
      top = Math.max(8, window.innerHeight - menuHeight - 8);
    }

    explorerBgContextMenu.style.left = `${Math.max(8, left)}px`;
    explorerBgContextMenu.style.top = `${Math.max(8, top)}px`;
  }

  if (explorerBgContextMenu) {
    explorerBgContextMenu.addEventListener('click', (e) => {
      const menuItem = e.target.closest('.context-menu-item');
      if (!menuItem) return;
      const action = menuItem.dataset.action;
      hideExplorerBgContextMenu();

      if (action === 'bg-new-file') {
        if (explorerBtnNewFile) explorerBtnNewFile.click();
      } else if (action === 'bg-new-folder') {
        if (explorerBtnNewFolder) explorerBtnNewFolder.click();
      } else if (action === 'bg-open-terminal') {
        if (explorerBtnOpenTerminal) explorerBtnOpenTerminal.click();
      } else if (action === 'bg-refresh') {
        refreshExplorer();
      } else if (action === 'bg-toggle-hidden') {
        showHiddenFiles = !showHiddenFiles;
        renderExplorerUI();
      }
    });
  }

  // Listener Klik Kanan pada Area Kosong Explorer
  if (explorerContent) {
    explorerContent.addEventListener('contextmenu', (e) => {
      // Abaikan jika klik kanan tepat di atas baris file/folder atau tombol titik tiga
      if (e.target.closest('.explorer-row') || e.target.closest('.explorer-grid-card') || e.target.closest('.explorer-dots-btn')) {
        return;
      }
      e.preventDefault();
      e.stopPropagation();
      if (isAnyContextMenuVisible()) {
        hideAllContextMenus();
        return;
      }
      showExplorerBgContextMenu(e);
    });
  }

  // Cegah menu klik kanan default browser yang mengganggu (kecuali input dan editor)
  document.addEventListener('contextmenu', (e) => {
    if (isAnyContextMenuVisible()) {
      e.preventDefault();
      e.stopPropagation();
      hideAllContextMenus();
      return;
    }
    const isTerminal = e.target.closest('#terminal-container') || e.target.closest('#terminal-area') || (e.target.classList && e.target.classList.contains('xterm-helper-textarea'));
    if (isTerminal) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const inst = activeSessionId ? terminalInstances[activeSessionId] : null;
      if (inst) inst.term.focus();
      showTerminalContextMenu(e);
      return;
    }
    const isInput = e.target.tagName === 'INPUT' || (e.target.tagName === 'TEXTAREA' && (!e.target.classList || !e.target.classList.contains('xterm-helper-textarea'))) || e.target.closest('.cm-editor');
    if (!isInput) {
      e.preventDefault();
    }
  }, true);

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
            refreshExplorer();
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
            refreshExplorer();
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
            refreshExplorer();
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

  // --- Full Screen File Explorer ---
  function shellEscape(str) {
    if (/^[a-zA-Z0-9_\.\-\/]+$/.test(str)) {
      return str;
    }
    return "'" + str.replace(/'/g, "'\\''") + "'";
  }

  function refreshExplorer() {
    loadExplorerPath(currentExplorerPath);
  }

  async function loadExplorerPath(path = null) {
    try {
      const endpoint = path ? `/api/fs?path=${encodeURIComponent(path)}` : '/api/fs';
      const res = await apiFetch(endpoint);
      if (!res.ok) {
        const err = await res.json().catch(() => ({ detail: 'Akses folder gagal' }));
        console.error('Gagal memuat direktori:', err.detail);
        return;
      }
      let resolvedPath = res.headers.get('x-current-path') || res.headers.get('X-Current-Path') || path;
      const data = await res.json();
      currentExplorerItems = Array.isArray(data) ? data : [];
      if (!resolvedPath && currentExplorerItems.length > 0) {
        const firstItem = currentExplorerItems[0];
        const lastSlash = firstItem.path.lastIndexOf('/');
        if (lastSlash > 0) {
          resolvedPath = firstItem.path.substring(0, lastSlash);
        } else if (lastSlash === 0) {
          resolvedPath = '/';
        }
      }
      if (resolvedPath) {
        currentExplorerPath = resolvedPath;
      }
      renderExplorerUI();
    } catch (err) {
      console.error('Gagal memuat explorer:', err);
    }
  }

  function renderBreadcrumbs() {
    if (!explorerBreadcrumbs) return;
    explorerBreadcrumbs.innerHTML = '';
    if (!currentExplorerPath) return;

    const parts = currentExplorerPath.split('/').filter(Boolean);
    let accum = '';

    // Root crumb
    const rootCrumb = document.createElement('span');
    rootCrumb.className = `breadcrumb-segment ${parts.length === 0 ? 'current' : ''}`;
    rootCrumb.textContent = '/';
    rootCrumb.addEventListener('click', () => loadExplorerPath('/'));
    explorerBreadcrumbs.appendChild(rootCrumb);

    parts.forEach((part, index) => {
      accum += '/' + part;
      const targetPath = accum;
      const isLast = index === parts.length - 1;

      const sep = document.createElement('span');
      sep.className = 'breadcrumb-sep';
      sep.textContent = '/';
      explorerBreadcrumbs.appendChild(sep);

      const segment = document.createElement('span');
      segment.className = `breadcrumb-segment ${isLast ? 'current' : ''}`;
      segment.textContent = part;
      if (!isLast) {
        segment.addEventListener('click', () => loadExplorerPath(targetPath));
      }
      explorerBreadcrumbs.appendChild(segment);
    });

    setTimeout(() => {
      if (explorerBreadcrumbs) {
        explorerBreadcrumbs.scrollLeft = explorerBreadcrumbs.scrollWidth;
      }
    }, 20);
  }

  function updateToolbarButtonsUI() {
    // Tombol Toggle File Tersembunyi
    if (explorerBtnToggleHidden) {
      explorerBtnToggleHidden.classList.toggle('active', showHiddenFiles);
      explorerBtnToggleHidden.title = showHiddenFiles
        ? 'Sembunyikan File Tersembunyi (Titik)'
        : 'Tampilkan File Tersembunyi (Titik)';
      if (explorerIconHiddenOff && explorerIconHiddenOn) {
        if (showHiddenFiles) {
          explorerIconHiddenOff.classList.add('hidden');
          explorerIconHiddenOn.classList.remove('hidden');
        } else {
          explorerIconHiddenOff.classList.remove('hidden');
          explorerIconHiddenOn.classList.add('hidden');
        }
      }
    }

    // Tombol Switcher Mode Tampilan (List vs Grid)
    if (explorerBtnViewList && explorerBtnViewGrid) {
      if (explorerViewMode === 'grid') {
        explorerBtnViewGrid.classList.add('active');
        explorerBtnViewList.classList.remove('active');
      } else {
        explorerBtnViewList.classList.add('active');
        explorerBtnViewGrid.classList.remove('active');
      }
    }
  }

  function renderExplorerUI() {
    if (!explorerList) return;

    renderBreadcrumbs();
    updateToolbarButtonsUI();

    const query = (explorerSearchInput ? explorerSearchInput.value : '').trim().toLowerCase();

    // 1. Saring file/folder tersembunyi (diawali titik ".") secara default
    let visibleItems = currentExplorerItems;
    if (!showHiddenFiles) {
      visibleItems = visibleItems.filter(item => !item.name.startsWith('.'));
    }

    // 2. Saring pencarian jika pengguna mengetik di filter input
    const filtered = query
      ? visibleItems.filter(item => item.name.toLowerCase().includes(query))
      : visibleItems;

    explorerList.innerHTML = '';

    // Sesuaikan header tabel dan kontainer sesuai mode list / grid
    if (explorerTableHeader) {
      if (explorerViewMode === 'grid') {
        explorerTableHeader.classList.add('hidden');
        explorerList.className = 'explorer-list grid-mode';
      } else {
        explorerTableHeader.classList.remove('hidden');
        explorerList.className = 'explorer-list list-mode';
      }
    }

    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'explorer-empty';
      if (query) {
        empty.textContent = 'Tidak ada file atau folder yang cocok dengan pencarian';
      } else if (!showHiddenFiles && currentExplorerItems.length > 0) {
        empty.innerHTML = `Semua item di folder ini adalah file tersembunyi (${currentExplorerItems.length} item).<br><span style="font-size:11px;opacity:0.8;display:inline-block;margin-top:6px;">Klik tombol mata di toolbar atas untuk menampilkannya.</span>`;
      } else {
        empty.textContent = 'Folder ini kosong';
      }
      explorerList.appendChild(empty);
    } else {
      if (explorerViewMode === 'grid') {
        // --- Render Tampilan Grid (macOS Finder Icon Cards) ---
        filtered.forEach(item => {
          const isDir = item.type === 'dir';
          const isHidden = item.name.startsWith('.');
          const card = document.createElement('div');
          card.className = `explorer-grid-card ${isHidden ? 'is-hidden-file' : ''}`;
          card.title = item.name;

          // Header Card Grid (Badge & Tombol Opsi Titik Tiga)
          const cardHeader = document.createElement('div');
          cardHeader.className = 'grid-card-header';

          const badgeData = getFileBadge(item.name, isDir);
          const badge = document.createElement('span');
          badge.className = `explorer-type-badge ${badgeData.cls}`;
          badge.textContent = badgeData.text;
          cardHeader.appendChild(badge);

          const dotsBtn = document.createElement('span');
          dotsBtn.className = 'explorer-dots-btn grid-dots-btn';
          dotsBtn.title = 'Opsi';
          const dotsImg = document.createElement('img');
          dotsImg.src = '/icons/dots.svg';
          dotsImg.width = 13;
          dotsImg.height = 13;
          dotsImg.alt = '';
          dotsBtn.appendChild(dotsImg);
          dotsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isAnyContextMenuVisible()) {
              hideAllContextMenus();
              return;
            }
            showContextMenu(e, item);
          });
          cardHeader.appendChild(dotsBtn);
          card.appendChild(cardHeader);

          // Ikon Besar di Tengah Card
          const iconWrapper = document.createElement('div');
          iconWrapper.className = 'grid-icon-wrapper';
          const iconImg = document.createElement('img');
          iconImg.className = 'grid-icon';
          iconImg.src = getFileIcon(item.name, isDir);
          iconImg.alt = '';
          iconWrapper.appendChild(iconImg);
          card.appendChild(iconWrapper);

          // Nama File / Folder di Bawah
          const nameSpan = document.createElement('div');
          nameSpan.className = 'grid-file-name';
          nameSpan.textContent = item.name;
          card.appendChild(nameSpan);

          // Klik Card untuk Membuka
          card.addEventListener('click', () => {
            if (isAnyContextMenuVisible()) {
              hideAllContextMenus();
              return;
            }
            if (isDir) {
              loadExplorerPath(item.path);
            } else {
              if (isReadableTextFile(item.name)) {
                openFileInEditor(item.path);
              } else {
                alert(`File "${item.name}" adalah file biner/media dan tidak dapat diedit langsung.`);
              }
            }
          });

          // Klik Kanan pada Card Folder/File (Tampilkan Opsi Titik 3)
          card.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isAnyContextMenuVisible()) {
              hideAllContextMenus();
              return;
            }
            showContextMenu(e, item);
          });

          explorerList.appendChild(card);
        });
      } else {
        // --- Render Tampilan List (Daftar Baris Tradisional) ---
        filtered.forEach(item => {
          const isDir = item.type === 'dir';
          const isHidden = item.name.startsWith('.');
          const row = document.createElement('div');
          row.className = `explorer-row ${isHidden ? 'is-hidden-file' : ''}`;

          // Kolom Nama & Icon
          const colName = document.createElement('div');
          colName.className = 'col-name';

          const iconImg = document.createElement('img');
          iconImg.className = 'explorer-icon';
          iconImg.src = getFileIcon(item.name, isDir);
          iconImg.width = 18;
          iconImg.height = 18;
          iconImg.alt = '';
          colName.appendChild(iconImg);

          const nameSpan = document.createElement('span');
          nameSpan.className = 'explorer-file-name';
          nameSpan.textContent = item.name;
          colName.appendChild(nameSpan);

          row.appendChild(colName);

          // Kolom Tipe Badge
          const colType = document.createElement('div');
          colType.className = 'col-type';
          const badgeData = getFileBadge(item.name, isDir);
          const badge = document.createElement('span');
          badge.className = `explorer-type-badge ${badgeData.cls}`;
          badge.textContent = badgeData.text;
          colType.appendChild(badge);
          row.appendChild(colType);

          // Kolom Aksi Titik Tiga
          const colActions = document.createElement('div');
          colActions.className = 'col-actions';
          const dotsBtn = document.createElement('span');
          dotsBtn.className = 'explorer-dots-btn';
          dotsBtn.title = 'Opsi';
          const dotsImg = document.createElement('img');
          dotsImg.src = '/icons/dots.svg';
          dotsImg.width = 14;
          dotsImg.height = 14;
          dotsImg.alt = '';
          dotsBtn.appendChild(dotsImg);
          dotsBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (isAnyContextMenuVisible()) {
              hideAllContextMenus();
              return;
            }
            showContextMenu(e, item);
          });
          colActions.appendChild(dotsBtn);
          row.appendChild(colActions);

          // Klik row untuk membuka
          row.addEventListener('click', () => {
            if (isAnyContextMenuVisible()) {
              hideAllContextMenus();
              return;
            }
            if (isDir) {
              loadExplorerPath(item.path);
            } else {
              if (isReadableTextFile(item.name)) {
                openFileInEditor(item.path);
              } else {
                alert(`File "${item.name}" adalah file biner/media dan tidak dapat diedit langsung.`);
              }
            }
          });

          // Klik Kanan pada Baris Folder/File (Tampilkan Opsi Titik 3)
          row.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (isAnyContextMenuVisible()) {
              hideAllContextMenus();
              return;
            }
            showContextMenu(e, item);
          });

          explorerList.appendChild(row);
        });
      }
    }

    const dirCount = filtered.filter(i => i.type === 'dir').length;
    const fileCount = filtered.filter(i => i.type !== 'dir').length;
    const totalHidden = currentExplorerItems.filter(i => i.name.startsWith('.')).length;
    if (explorerItemCount) {
      let countText = `${filtered.length} item (${dirCount} folder, ${fileCount} file)`;
      if (!showHiddenFiles && totalHidden > 0) {
        countText += ` • ${totalHidden} tersembunyi`;
      }
      explorerItemCount.textContent = countText;
    }
    if (explorerCurrentPathDisplay) {
      explorerCurrentPathDisplay.textContent = currentExplorerPath || '~';
    }
  }

  // Toolbar Actions Event Listeners
  if (explorerBtnToggleHidden) {
    explorerBtnToggleHidden.addEventListener('click', () => {
      showHiddenFiles = !showHiddenFiles;
      renderExplorerUI();
    });
  }

  if (explorerBtnViewList) {
    explorerBtnViewList.addEventListener('click', () => {
      explorerViewMode = 'list';
      localStorage.setItem('termux_ws_view_mode', 'list');
      renderExplorerUI();
    });
  }

  if (explorerBtnViewGrid) {
    explorerBtnViewGrid.addEventListener('click', () => {
      explorerViewMode = 'grid';
      localStorage.setItem('termux_ws_view_mode', 'grid');
      renderExplorerUI();
    });
  }

  if (explorerBtnUp) {
    explorerBtnUp.addEventListener('click', () => {
      if (!currentExplorerPath || currentExplorerPath === '/') return;
      const lastSlash = currentExplorerPath.lastIndexOf('/');
      const parentPath = lastSlash <= 0 ? '/' : currentExplorerPath.substring(0, lastSlash);
      loadExplorerPath(parentPath);
    });
  }

  if (explorerBtnRefresh) {
    explorerBtnRefresh.addEventListener('click', () => {
      refreshExplorer();
    });
  }

  if (explorerSearchInput) {
    explorerSearchInput.addEventListener('input', () => {
      renderExplorerUI();
    });
  }

  if (explorerBtnNewFile) {
    explorerBtnNewFile.addEventListener('click', async () => {
      if (!currentExplorerPath) return;
      const fileName = await showFsModal({
        title: 'Buat File Baru',
        message: `Buat file baru di ${currentExplorerPath}:`,
        defaultValue: '',
        confirmText: 'Buat File'
      });
      if (fileName) {
        const cleanName = fileName.trim().replace(/^\/+/, '');
        const filePath = `${currentExplorerPath.replace(/\/+$/, '')}/${cleanName}`;
        try {
          const res = await apiFetch('/api/fs/content', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filePath, content: '' })
          });
          if (res.ok) {
            await loadExplorerPath(currentExplorerPath);
            await openFileInEditor(filePath);
          } else {
            const err = await res.json().catch(() => ({ detail: 'Gagal membuat file' }));
            alert(err.detail || 'Gagal membuat file');
          }
        } catch (e) {
          console.error('Error buat file:', e);
        }
      }
    });
  }

  if (explorerBtnNewFolder) {
    explorerBtnNewFolder.addEventListener('click', async () => {
      if (!currentExplorerPath) return;
      const folderName = await showFsModal({
        title: 'Buat Folder Baru',
        message: `Buat folder baru di ${currentExplorerPath}:`,
        defaultValue: '',
        confirmText: 'Buat Folder'
      });
      if (folderName) {
        const cleanName = folderName.trim().replace(/^\/+/, '');
        const folderPath = `${currentExplorerPath.replace(/\/+$/, '')}/${cleanName}`;
        try {
          const res = await apiFetch('/api/fs/mkdir', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: folderPath })
          });
          if (res.ok) {
            await loadExplorerPath(currentExplorerPath);
          } else {
            const err = await res.json().catch(() => ({ detail: 'Gagal membuat folder' }));
            alert(err.detail || 'Gagal membuat folder');
          }
        } catch (e) {
          console.error('Error buat folder:', e);
        }
      }
    });
  }

  if (explorerBtnOpenTerminal) {
    explorerBtnOpenTerminal.addEventListener('click', async () => {
      if (currentExplorerPath) {
        await createNewSession(currentExplorerPath);
      }
    });
  }

  // Inisialisasi awal
  loadSessions();
  loadExplorerPath();
})();
