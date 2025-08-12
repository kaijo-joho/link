/*
 * interlink.js — 1つのIDに対して「中間リンク」を描画する汎用スクリプト
 *
 * 目的:
 * - quiz.html だけでなく、提出フォームなど他ページでも使い回し可能。
 * - URL クエリから `id` を読み取り、種類ごとの規則で遷移先URLを構築し、
 *   タイトル/説明（あれば）と「開く」ボタンだけを描画する。
 * - JSON(データセット)は id, title, description を共通のキーとして参照。
 *   既存 quizzes.js のように `quizId` キーしかない場合は resolver で吸収。
 */

(function(global){
  'use strict';

  const Interlink = {
    /**
     * @param {Object} opts
     * @param {string}   opts.type              種類(key)。例: 'quiz', 'form'
     * @param {Object}   opts.types             種類ごとの定義マップ
     * @param {Object|Array|Function} [opts.dataset]  データセット（任意）。id,title,description を推奨。関数可。
     * @param {Function} [opts.resolveItem]     (id, dataset) => {id,title,description}
     * @param {string}   [opts.target]          追加先セレクタ（既定: 'main.portal'）
     * @param {boolean}  [opts.readFlags=true]  URLから newtab/auto を読む
     * @param {boolean}  [opts.header=true]     共通ヘッダーを自動挿入する（.site-header が無ければ）
     * @param {string}   [opts.headerTitle='海城中学高等学校']  ヘッダー左の校名
     * @param {string}   [opts.headerSubject='情報科']          ヘッダー右の教科名
     */
    render(opts){
      try {
        const conf = normalizeOptions(opts);
        if (conf.header !== false) ensureHeader(conf);

        const params = new URLSearchParams(location.search);

        // 常に 'id' を取得
        const id = sanitizeId((params.get('id') || '').trim());
        if (!id) return renderError(conf, '必須パラメータ <code>id</code> がありません。例: <code>?id=py22a</code>');

        // 種類別の設定
        const tdef = conf.types[conf.type];
        if (!tdef) return renderError(conf, `未定義の type: <code>${escapeHtml(conf.type)}</code>`);

        // ベースURL（種類ごとに上書きクエリ名を変えられる）
        const baseOverride = (tdef.baseParam ? (params.get(tdef.baseParam) || '').trim() : '') || '';
        const base = sanitizeBase(baseOverride || tdef.defaultBase || '');
        if (!base) return renderError(conf, '遷移先の base URL が未設定です（defaultBase またはクエリで指定してください）。');

        // newtab / auto
        const newtab = conf.readFlags ? (params.get('newtab') || '0') === '1' : false;
        const auto   = conf.readFlags ? (params.get('auto') || '0') === '1' : false;

        // データセット（未指定なら window.quizzes / window.forms を参照）
        const dataset = resolveDataset(conf.dataset);
        const item = (typeof conf.resolveItem === 'function')
          ? conf.resolveItem(id, dataset)
          : defaultResolveItem(id, dataset);

        // 最終URL
        const url = (typeof tdef.toUrl === 'function') ? tdef.toUrl(base, item.id) : buildDefaultUrl(base, item.id);

        // 描画
        renderCard(conf, { title: item.title || item.id, desc: item.description || '', url, newtab });

        if (auto) setTimeout(() => location.assign(url), 300);
      } catch (e) {
        try { renderError(normalizeOptions(opts), `実行時エラー: <code>${escapeHtml(String(e && e.message || e))}</code>`); }
        catch(_) { console.error(e); }
      }
    }
  };

  // ===== helpers =====
  function normalizeOptions(opts){
    if (!opts || typeof opts !== 'object') throw new Error('Interlink.render: options is required.');
    return {
      type: opts.type || 'quiz',
      types: opts.types || {},
      dataset: opts.dataset,
      resolveItem: opts.resolveItem,
      target: opts.target || 'main.portal',
      readFlags: opts.readFlags !== false,
      header: (typeof opts.header === 'undefined') ? true : opts.header,
      headerTitle: opts.headerTitle || '海城中学高等学校',
      headerSubject: opts.headerSubject || '情報科'
    };
  }

  // 共通ヘッダーを挿入（無ければ）
  function ensureHeader(conf){
    if (document.querySelector('.site-header')) return; // 既にあれば何もしない
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

  // dataset の自動解決（window.quizzes / window.forms をフォールバック）
  function resolveDataset(ds){
    try{ if (typeof ds === 'function') ds = ds(); }catch{}
    if (!ds && typeof window !== 'undefined') {
      if (window.quizzes) return window.quizzes;
      if (window.forms)   return window.forms;
    }
    return ds;
  }

  function sanitizeId(v){ return /^[A-Za-z0-9_-]+$/.test(v) ? v : ''; }
  function sanitizeBase(url){ if(!url) return ''; try{ const u = new URL(url, location.origin); if(!/^https?:$/i.test(u.protocol)) return ''; return u.toString().replace(/\/$/, ''); }catch{ return ''; } }

  function defaultResolveItem(id, ds){
    if (!ds) return { id, title: id, description: '' };
    if (Array.isArray(ds)) {
      const found = ds.find(x => x && (x.id === id || x.quizId === id));
      return found ? { id: found.id || found.quizId || id, title: found.title || id, description: (found.description || '').trim() } : { id, title: id, description: '' };
    }
    if (typeof ds === 'object') {
      const direct = ds[id];
      if (direct) return { id: direct.id || direct.quizId || id, title: direct.title || id, description: (direct.description || '').trim() };
      const via = Object.values(ds).find(x => x && (x.id === id || x.quizId === id));
      return via ? { id: via.id || via.quizId || id, title: via.title || id, description: (via.description || '').trim() } : { id, title: id, description: '' };
    }
    return { id, title: id, description: '' };
  }

  function buildDefaultUrl(base, id){ const u = new URL(base); u.searchParams.set('id', id); return u.toString(); }

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
    box.appendChild(link);

    root.appendChild(box);
  }

  function getRoot(target){
    let root = document.querySelector(target);
    if (!root) {
      // デフォルトのルートを用意（ヘッダーしか出ない事故を防ぐ）
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
    p.innerHTML = html; // errorのみHTML許容
    box.appendChild(p);
    root.appendChild(box);
  }

  function escapeHtml(s){ return String(s).replace(/[&<>"']/g, c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c])); }

  // expose
  global.Interlink = Interlink;

})(window);
