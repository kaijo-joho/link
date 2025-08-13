(function(global){
  'use strict';

  const VERSION = 'Interlink 2025-08-13 r2';
  try { console.debug(VERSION); } catch {}

  const Interlink = {
    render(opts){
      try {
        const conf = normalizeOptions(opts);
        if (conf.header !== false) ensureHeader(conf);
        const params = new URLSearchParams(location.search);

        // 1) id
        const id = sanitizeId((params.get('id') || '').trim());
        if (!id) return renderError(conf, '必須パラメータ <code>id</code> がありません。例: <code>?id=test</code>');

        // 2) dataset -> item
        const dataset = resolveDataset(conf.dataset);
        const item = (typeof conf.resolveItem === 'function')
          ? conf.resolveItem(id, dataset)
          : defaultResolveItem(id, dataset);

        // 3) url 必須
        const urlRaw = (item && typeof item.url === 'string') ? item.url.trim() : '';
        if (!urlRaw) return renderError(conf, 'このIDには <code>url</code> が設定されていないため、開けません。');

        // 4) {id} 置換
        let urlStr = urlRaw.replace(/{id}/g, encodeURIComponent(item.id));

        // 5) variant（?variant=... / ?v=...）
        const variantRaw = (params.get('variant') || params.get('v') || '').trim();
        let variantLabel = '';

        if (variantRaw) {
          // 任意：variants 許可リスト（あればチェック、なければスルー）
          const allowed = Array.isArray(item.variants) && item.variants.length > 0
            ? item.variants.some(v => v && String(v.variant) === variantRaw)
            : true;

          if (!allowed) {
            console.warn('[Interlink] variant not in list:', variantRaw, 'in', item.variants);
            // ここで弾きたい場合は return renderError(...); にしてもよい
          }

          // 付与は常に variant キーで行う（値に '=' があってもそのまま value として扱う）
          const u = new URL(urlStr);
          u.searchParams.set('variant', variantRaw); // 例: variant=sample1-2 / variant=seed=42
          urlStr = u.toString();

          // 表示ラベル
          variantLabel = variantRaw;
        }

        // 6) URL 妥当性
        const finalUrl = sanitizeFinalUrl(urlStr);
        if (!finalUrl) return renderError(conf, '遷移先 URL が不正です。http(s) のみ許可されます。');

        // 7) flags
        const newtab = conf.readFlags ? (params.get('newtab') || '0') === '1' : false;
        const auto   = conf.readFlags ? (params.get('auto')   || '0') === '1' : false;

        // 8) 描画
        const displayTitle = (item.title || item.id) + (variantLabel ? `（${variantLabel}）` : '');
        renderCard(conf, { title: displayTitle, desc: item.description || '', url: finalUrl, newtab });
        
        // 9) 自動遷移
        if (auto) { showLoading(conf.loadingMessage, finalUrl); setTimeout(()=>location.assign(finalUrl), 300); }

      } catch (e) {
        try { renderError(normalizeOptions(opts), `実行時エラー: <code>${escapeHtml(String(e && e.message || e))}</code>`); }
        catch(_) { console.error(e); }
      }
    }
  };

  // ===== helpers =====
  function normalizeOptions(opts){
    if (!opts || typeof opts !== 'object') opts = {};
    return {
      dataset: opts.dataset,
      resolveItem: opts.resolveItem,
      target: opts.target || 'main.portal',
      readFlags: opts.readFlags !== false,
      header: (typeof opts.header === 'undefined') ? true : opts.header,
      headerTitle: opts.headerTitle || '海城中学高等学校',
      headerSubject: opts.headerSubject || '情報科',
      loadingMessage: opts.loadingMessage || '読み込み中…'
    };
  }

  // data を安全に解決（window.data / const data / globalThis.data）
  function resolveDataset(ds){
    try { if (typeof ds === 'function') ds = ds(); } catch {}
    if (ds) return ds;
    if (typeof data !== 'undefined') return data; // 非moduleの const data
    if (typeof globalThis !== 'undefined' && typeof globalThis.data !== 'undefined') return globalThis.data;
    return undefined;
  }

  function sanitizeId(v){ return /^[A-Za-z0-9_-]+$/.test(v) ? v : ''; }

  function defaultResolveItem(id, ds){
    const fallback = { id, title: id, description: '', url: '', variants: [] };
    if (!ds) return fallback;
    if (Array.isArray(ds)) {
      const found = ds.find(x => x && (x.id === id || x.quizId === id));
      return found ? normalizeItem(found, id) : fallback;
    }
    if (typeof ds === 'object') {
      const direct = ds[id];
      if (direct) return normalizeItem(direct, id);
      const via = Object.values(ds).find(x => x && (x.id === id || x.quizId === id));
      return via ? normalizeItem(via, id) : fallback;
    }
    return fallback;
  }

  function normalizeItem(x, id){
    return {
      id: x.id || x.quizId || id,
      title: x.title || id,
      description: (x.description || '').trim(),
      url: typeof x.url === 'string' ? x.url : '',
      variants: Array.isArray(x.variants)
        ? x.variants.map(v => v && typeof v === 'object'
            ? { variant: (v.variant ?? v.name ?? '').trim(), param: (v.param ?? v.params ?? '').trim() }
            : null).filter(Boolean)
        : []
    };
  }

  function findVariant(item, vName){
    if (!item || !Array.isArray(item.variants)) return null;
    // 完全一致（必要なら大文字小文字無視に変更可）
    return item.variants.find(v => v && String(v.variant) === vName) || null;
  }

  // "a=1&b=2" を URL にマージ
  function appendParamString(url, paramStr){
    if (!paramStr) return url;
    const u = new URL(url);
    const pairs = String(paramStr).split('&').map(s => s.trim()).filter(Boolean);
    for (const p of pairs) {
      const idx = p.indexOf('=');
      if (idx <= 0) continue;
      const key = p.slice(0, idx);
      const val = p.slice(idx+1);
      u.searchParams.set(key, val);
    }
    return u.toString();
  }

  function sanitizeFinalUrl(url){
    try {
      const u = new URL(url, location.origin);
      if (!/^https?:$/i.test(u.protocol)) return '';
      return u.toString();
    } catch { return ''; }
  }

  function renderCard(conf, { title, desc, url, newtab }){
    const root = getRoot(conf.target);
    const box  = document.createElement('section');
    box.className = 'container';

    const h2 = document.createElement('h2');
    h2.textContent = title;
    box.appendChild(h2);

    if (desc) {
      const p = document.createElement('p');
      p.className = 'quizDesc';
      p.textContent = desc;
      box.appendChild(p);
    }

    const link = document.createElement('a');
    link.className = 'submitButton';
    link.href = url;
    link.textContent = '開く';
    link.target = newtab ? '_blank' : '_self';
    link.rel = 'noopener';

    link.addEventListener('click', (ev) => {
      if (newtab || ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.button === 1) return;
      ev.preventDefault();
      showLoading(conf.loadingMessage, url);
      setTimeout(() => { location.assign(url); }, 60);
    });

    box.appendChild(link);
    root.appendChild(box);
  }

  function getRoot(target){
    let root = document.querySelector(target);
    if (!root) {
      const main = document.createElement('main');
      main.className = 'portal';
      document.body.appendChild(main);
      root = main;
    }
    return root;
  }

  function renderError(conf, html){
    const root = document.querySelector(conf.target) || document.body;
    const box  = document.createElement('section');
    box.className = 'container';
    const p = document.createElement('p');
    p.className = 'red bold';
    p.innerHTML = html;
    box.appendChild(p);
    root.appendChild(box);
  }

  function ensureHeader(conf){
    if (document.querySelector('.site-header')) return;
    const header = document.createElement('header');
    header.className = 'site-header';
    const inner = document.createElement('div');
    inner.className = 'header-inner';
    const h1 = document.createElement('h1');
    h1.className = 'site-title';
    h1.append(document.createTextNode(conf.headerTitle + ' '));
    const span = document.createElement('span');
    span.className = 'subject';
    span.textContent = conf.headerSubject;
    h1.appendChild(span);
    inner.appendChild(h1);
    header.appendChild(inner);
    document.body.insertBefore(header, document.body.firstChild || null);
  }

  function showLoading(message, url){
    if (document.querySelector('.modal-bg[data-kind="interlink-loading"]')) return;
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.setAttribute('data-kind', 'interlink-loading');
    const box = document.createElement('div');
    box.className = 'modal-box';
    const sp = document.createElement('div');
    sp.className = 'spinner';
    const p = document.createElement('p');
    p.style.marginTop = '8px';
    p.textContent = message || '読み込み中…';
    box.appendChild(sp); box.appendChild(p);
    if (url) {
      const a = document.createElement('a');
      a.href = url;
      a.textContent = '開かない場合はこちらをクリック';
      a.style.display = 'none';
      a.style.marginTop = '8px';
      box.appendChild(a);
      setTimeout(() => { a.style.display = 'inline-block'; }, 1500);
    }
    bg.appendChild(box);
    document.body.appendChild(bg);
  }

  function escapeHtml(s){ return String(s).replace(/[&<>\"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

  global.Interlink = Interlink;

})(window);