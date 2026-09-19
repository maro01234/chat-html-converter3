'use strict';
const $ = (id) => document.getElementById(id);
const limit = 2 * 1024 * 1024;
const mermaidModuleUrl = 'https://cdn.jsdelivr.net/npm/mermaid@12.0.0/dist/mermaid.esm.min.mjs';
const attachments = new Map();
let mermaidPromise = null;
let imageBusy = false;
let outputUrl = null;
let version = 0;
let busy = false;
const sample = 'User:\nMermaidの図も残せますか？\n\nAssistant:\n# 会話をHTMLにまとめられます\n通常のコードブロックに加えて、**Mermaid形式の図**もSVGとして保存できます。\n\n```mermaid\nflowchart LR\n  A[会話ログ] --> B[HTMLへ変換]\n  B --> C[ブラウザで閲覧]\n```\n\n`chat-emoji.html` として保存すれば、図を含めてオフラインでも開けます。';

function status(text, error = false) {
  $('status').textContent = text;
  $('status').classList.toggle('error', error);
}
function invalidate() {
  version++;
  $('count').textContent = `${$('source').value.length.toLocaleString('ja-JP')} 文字`;
  $('download').disabled = true;
  $('preview').hidden = true;
  $('preview').removeAttribute('srcdoc');
  $('empty').hidden = false;
  $('preview-state').textContent = '未変換';
  if (outputUrl) URL.revokeObjectURL(outputUrl);
  outputUrl = null;
  status('ログを入力して、変換ボタンを押してください。');
}
$('source').addEventListener('input', invalidate);
$('sample').addEventListener('click', () => {
  $('source').value = sample;
  invalidate();
  status('サンプルを入力しました。「HTMLに変換」を押してください。');
});
$('file').addEventListener('change', async () => {
  const file = $('file').files[0];
  if (!file) return;
  const readVersion = version;
  try {
    if (file.size > limit) throw new Error('ファイルは2 MiB以下にしてください。');
    const text = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
    if (readVersion !== version) return;
    $('source').value = text;
    invalidate();
    status(`${file.name} を読み込みました。`);
  } catch (error) {
    status(error instanceof TypeError ? 'UTF-8形式のテキストファイルを選んでください。' : error.message, true);
  } finally {
    $('file').value = '';
  }
});

function renderImages() {
  $('image-list').replaceChildren();
  for (const [id, attachment] of attachments) {
    const item = document.createElement('li');
    const thumbnail = document.createElement('img');
    thumbnail.src = attachment.data;
    thumbnail.alt = '';
    const name = document.createElement('span');
    name.textContent = attachment.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '削除';
    remove.setAttribute('aria-label', `${attachment.name} を削除`);
    remove.addEventListener('click', () => {
      attachments.delete(id);
      $('source').value = $('source').value.split(attachment.marker).join('');
      invalidate();
      renderImages();
    });
    item.append(thumbnail, name, remove);
    $('image-list').append(item);
  }
}
function readImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`${file.name} を読み込めませんでした。`));
    reader.onload = () => {
      const image = new Image();
      image.onload = () => resolve(reader.result);
      image.onerror = () => reject(new Error(`${file.name} は有効な画像ではありません。`));
      image.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}
$('images').addEventListener('change', async () => {
  const files = Array.from($('images').files);
  $('images').value = '';
  if (!files.length || imageBusy) return;
  imageBusy = true;
  $('convert').disabled = true;
  $('images').disabled = true;
  try {
    let total = Array.from(attachments.values()).reduce((sum, image) => sum + image.size, 0);
    for (const file of files) {
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) throw new Error('PNG / JPEG / GIF / WebP の画像を選んでください。');
      if (file.size > 10 * 1024 * 1024) throw new Error('画像は1枚10 MiB以下にしてください。');
      total += file.size;
    }
    if (total > 20 * 1024 * 1024) throw new Error('画像の合計は20 MiB以下にしてください。');
    const loaded = await Promise.all(files.map(async file => ({ file, data: await readImage(file) })));
    const source = $('source');
    let markers = '';
    for (const { file, data } of loaded) {
      const id = crypto.randomUUID();
      const name = file.name.replace(/[\r\n\[\]]/g, '_');
      const marker = `![${name}](attachment:${id})`;
      attachments.set(id, { name: file.name, marker, data, size: file.size });
      markers += `${marker}\n`;
    }
    const start = source.selectionStart;
    const end = source.selectionEnd;
    const prefix = source.value.slice(0, start).trim() ? '\n' : 'User:\n';
    source.setRangeText(`${prefix}${markers}`, start, end, 'end');
    invalidate();
    renderImages();
    source.focus();
    status(`${files.length}枚の画像を追加しました。挿入した行を移動すると表示位置を変更できます。`);
  } catch (error) {
    status(error.message, true);
  } finally {
    imageBusy = false;
    $('images').disabled = false;
    $('convert').disabled = busy;
  }
});
function loadMermaid() {
  if (!mermaidPromise) {
    mermaidPromise = import(mermaidModuleUrl).then(({ default: mermaid }) => {
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: 'strict',
        suppressErrorRendering: true,
        maxTextSize: 50000,
        maxEdges: 500,
        flowchart: { htmlLabels: false }
      });
      return mermaid;
    }).catch(error => {
      mermaidPromise = null;
      throw error;
    });
  }
  return mermaidPromise;
}

function importSafeSvg(doc, svgText, index) {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.localName !== 'svg' || parsed.querySelector('parsererror')) {
    throw new Error(`Mermaid図${index}のSVGを作成できませんでした。`);
  }
  parsed.querySelectorAll('script, iframe, object, embed').forEach(element => element.remove());
  for (const element of parsed.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim().toLowerCase();
      if (name.startsWith('on') || ((name === 'href' || name === 'xlink:href') && value && !value.startsWith('#'))) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  const svg = doc.importNode(root, true);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `Mermaid図 ${index}`);
  return svg;
}

async function renderMermaidDiagrams(doc) {
  const placeholders = Array.from(doc.querySelectorAll('[data-mermaid]'));
  if (!placeholders.length) return;
  let mermaid;
  try {
    mermaid = await loadMermaid();
  } catch (error) {
    throw new Error('Mermaid描画ライブラリを読み込めませんでした。通信状態を確認して、もう一度お試しください。');
  }
  for (let index = 0; index < placeholders.length; index++) {
    const placeholder = placeholders[index];
    const definition = placeholder.textContent;
    if (!definition.trim()) throw new Error(`Mermaid図${index + 1}が空です。`);
    const staging = document.createElement('div');
    staging.hidden = true;
    document.body.append(staging);
    try {
      const id = `mermaid-${Date.now()}-${index}-${Math.random().toString(36).slice(2)}`;
      const { svg } = await mermaid.render(id, definition, staging);
      const figure = doc.createElement('figure');
      figure.className = 'mermaid-diagram';
      figure.append(importSafeSvg(doc, svg, index + 1));
      placeholder.replaceWith(figure);
    } catch (error) {
      throw new Error(`Mermaid図${index + 1}の構文を確認してください。`);
    } finally {
      staging.remove();
    }
  }
}

async function buildStandaloneHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const placeholder of doc.querySelectorAll('[data-attachment]')) {
    const attachment = attachments.get(placeholder.dataset.attachment);
    if (!attachment) throw new Error('画像が見つかりません。画像ファイルを追加し直してください。');
    const figure = doc.createElement('figure');
    const image = doc.createElement('img');
    image.src = attachment.data;
    image.alt = attachment.name;
    const caption = doc.createElement('figcaption');
    caption.textContent = attachment.name;
    figure.append(image, caption);
    placeholder.replaceWith(figure);
  }
  await renderMermaidDiagrams(doc);
  return '<!doctype html>\n' + doc.documentElement.outerHTML;
}

$('convert').addEventListener('click', async () => {
  if (busy || imageBusy) return;
  const source = $('source').value;
  invalidate();
  if (!source.trim()) return status('変換するログを入力してください。', true);
  if (new TextEncoder().encode(source).length > limit) return status('ログは2 MiB以下にしてください。', true);
  const requestedVersion = version;
  busy = true;
  $('convert').disabled = true;
  status('変換しています。初回の起動には少し時間がかかることがあります。');
  try {
    const response = await fetch('/api/convert', {
      method: 'POST', headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: source, signal: AbortSignal.timeout(120000)
    });
    const responseText = await response.text();
    if (requestedVersion !== version) return;
    if (!response.ok) throw new Error(response.status >= 500 ? 'サーバーが応答できません。少し待ってから再度お試しください。' : responseText);
    const html = await buildStandaloneHtml(responseText);
    outputUrl = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    $('preview').srcdoc = html;
    $('preview').hidden = false;
    $('empty').hidden = true;
    $('download').disabled = false;
    $('preview-state').textContent = '変換済み';
    status('変換できました。HTMLをダウンロードして保存できます。');
  } catch (error) {
    if (requestedVersion === version) status(error.name === 'TimeoutError' ? '時間がかかっています。しばらく待って、もう一度お試しください。' : error instanceof TypeError ? 'サーバーに接続できません。通信状態を確認してください。' : error.message, true);
  } finally {
    busy = false;
    $('convert').disabled = imageBusy;
  }
});
$('download').addEventListener('click', () => {
  if (!outputUrl) return;
  const link = document.createElement('a');
  link.href = outputUrl;
  link.download = 'chat-emoji.html';
  document.body.append(link);
  link.click();
  link.remove();
});
window.addEventListener('pagehide', () => { if (outputUrl) URL.revokeObjectURL(outputUrl); });
