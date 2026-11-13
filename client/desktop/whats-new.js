(() => {
'use strict';
  const texts = {
    en: { heading: version => `What's new in Deckmate ${version}`, since: version => `Since ${version}`, all: 'All changes on GitHub', empty: 'No changes found for this version range.', error: 'Could not load the changelog.' },
    ru: { heading: version => `Что нового в Deckmate ${version}`, since: version => `После версии ${version}`, all: 'Все изменения на GitHub', empty: 'Для этого диапазона версий изменений не найдено.', error: 'Не удалось загрузить список изменений.' },
  };

  function parseChangelog(markdown) {
    const sections = [];
    let current = null;
    for (const line of markdown.split(/\r?\n/)) {
      const heading = /^##\s+\[([^\]]+)\](?:\s*-\s*(\d{4}-\d{2}-\d{2}))?\s*$/.exec(line);
      if (heading) {
        current = { version: heading[1], date: heading[2] || '', lines: [] };
        sections.push(current);
      } else if (/^##\s/.test(line)) current = null;
      else if (current) current.lines.push(line);
    }
    return sections;
  }

  function versionParts(version) {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(version);
    if (!match) return null;
    const pre = match[4] ? match[4].split('.') : [];
    if (pre.some(part => /^0\d+$/.test(part))) return null;
    return { core: match.slice(1, 4).map(BigInt), pre };
  }
  function compare(a, b) {
    for (let i = 0; i < 3; i++) if (a.core[i] !== b.core[i]) return a.core[i] > b.core[i] ? 1 : -1;
    if (!a.pre.length || !b.pre.length) return Number(!a.pre.length) - Number(!b.pre.length);
    for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
      const left = a.pre[i], right = b.pre[i];
      if (left === undefined || right === undefined) return a.pre.length - b.pre.length;
      if (left === right) continue;
      const leftNumeric = /^\d+$/.test(left), rightNumeric = /^\d+$/.test(right);
      if (leftNumeric && rightNumeric) return BigInt(left) > BigInt(right) ? 1 : -1;
      if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
      return left > right ? 1 : -1;
    }
    return 0;
  }
  function pickSections(sections, from, to) {
    const upper = versionParts(to);
    const lower = from === null ? null : versionParts(from);
    if (!upper || (from !== null && !lower)) return [];
    return sections.map(section => ({ section, version: versionParts(section.version) }))
      .filter(item => item.version && !item.version.pre.length && compare(item.version, upper) <= 0 && (lower ? compare(item.version, lower) > 0 : compare(item.version, upper) === 0))
      .sort((a, b) => compare(b.version, a.version)).map(item => item.section);
  }

  function safeLink(url) {
    try { const parsed = new URL(url); return parsed.protocol === 'https:' || parsed.protocol === 'http:'; } catch { return false; }
  }
  function renderInline(parent, text, doc) {
    const pattern = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]+)\]\(([^\s)]+)\)/g;
    let last = 0;
    for (const match of text.matchAll(pattern)) {
      parent.append(doc.createTextNode(text.slice(last, match.index)));
      if (match[3] && !safeLink(match[4])) parent.append(doc.createTextNode(match[0]));
      else {
        const node = doc.createElement(match[1] ? 'strong' : match[2] ? 'code' : 'a');
        node.textContent = match[1] || match[2] || match[3];
        if (match[3]) node.href = match[4];
        parent.append(node);
      }
      last = match.index + match[0].length;
    }
    parent.append(doc.createTextNode(text.slice(last)));
  }
  function renderSection(section, doc = document) {
    const article = doc.createElement('section');
    article.className = 'release';
    const header = doc.createElement('div'); header.className = 'release-header';
    const title = doc.createElement('h2'); title.textContent = section.version; header.append(title);
    if (section.date) { const date = doc.createElement('time'); date.dateTime = section.date; date.textContent = section.date; header.append(date); }
    article.append(header);
    let list = null;
    for (const line of section.lines) {
      const heading = /^###\s+(.+)$/.exec(line);
      const bullet = /^\s*[-*]\s+(.+)$/.exec(line);
      if (heading) { list = null; const node = doc.createElement('h3'); renderInline(node, heading[1], doc); article.append(node); }
      else if (bullet) {
        if (!list) { list = doc.createElement('ul'); article.append(list); }
        const item = doc.createElement('li'); renderInline(item, bullet[1], doc); list.append(item);
      } else if (line.trim()) { list = null; const node = doc.createElement('p'); renderInline(node, line, doc); article.append(node); }
    }
    return article;
  }
  globalThis.DeckmateWhatsNew = { parseChangelog, pickSections, renderSection };

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  const mock = () => {
    let language = 'en';
    try { if (localStorage.getItem('deckmate-language') === 'ru') language = 'ru'; } catch {}
    const changelog = language === 'ru' ? `## [0.5.0] - 2026-11-09\n### Добавлено\n- **Пространства.** Меняйте порядок пространств в заголовке или настройках.\n- **Выполнение Hero.** Отмечайте Hero без задач выполненной.\n### Изменено\n- **Doc Cards.** Плитка Doc Card выглядит как страница.\n## [0.4.0] - 2026-11-09\n### Добавлено\n- **Шаблоны на русском.** У шаблонов Journey и проектов теперь русские названия.` : `## [0.5.0] - 2026-11-09\n### Added\n- **Spaces.** Reorder spaces in the header or space settings.\n- **Hero completion.** Mark a Hero without tasks as done.\n### Changed\n- **Doc Cards.** A Doc Card tile looks like a page.\n## [0.4.0] - 2026-11-09\n### Added\n- **Templates in Russian.** Journey and project templates now have Russian titles.`;
    return { language, from: '0.3.0', to: '0.5.0', changelog, releasesUrl: 'https://github.com/pierkulakov/deckmate/releases' };
  };
  (async () => {
    const root = document.getElementById('whats-new');
    try {
      const data = window.__TAURI_INTERNALS__ ? await window.__TAURI_INTERNALS__.invoke('whats_new_get') : mock();
      if (data.ok === false) throw new Error(data.message);
      const language = data.language === 'ru' ? 'ru' : 'en';
      const t = texts[language];
      document.documentElement.lang = language;
      document.getElementById('heading').textContent = t.heading(data.to);
      document.title = t.heading(data.to);
      const since = document.getElementById('since');
      if (data.from !== null) { since.textContent = t.since(data.from); since.hidden = false; }
      const link = document.getElementById('releases');
      link.textContent = t.all;
      if (safeLink(data.releasesUrl)) link.href = data.releasesUrl;
      const content = document.getElementById('content');
      const sections = pickSections(parseChangelog(data.changelog), data.from, data.to);
      if (sections.length) content.replaceChildren(...sections.map(section => renderSection(section)));
      else { const empty = document.createElement('p'); empty.textContent = t.empty; content.append(empty); }
    } catch (error) {
      document.getElementById('heading').textContent = error.message || texts.en.error;
    } finally {
      await window.prepareDeckmatePage();
      root.removeAttribute('aria-busy');
    }
  })();
})();
