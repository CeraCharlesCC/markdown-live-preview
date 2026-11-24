// ChatGPT's rendered Mermaid diagrams can be copied as SVG (rich clipboard)
// or, unfortunately, as just a scoped stylesheet followed by concatenated labels.
const svgNamespace = 'http://www.w3.org/2000/svg';
const htmlNamespace = 'http://www.w3.org/1999/xhtml';
const diagramId = /^chatgpt-mermaid-[\w-]+$/;
const cssStart = /^ {0,3}#(chatgpt-mermaid-[\w-]+)\s*\{/;

// Skip a CSS rule, including quoted strings, comments and nested @keyframes.
function ruleEnd(text, start) {
    let depth = 0;
    let quote = '';
    for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (quote) {
            if (c === '\\') i++;
            else if (c === quote) quote = '';
        } else if (c === '"' || c === "'") {
            quote = c;
        } else if (c === '/' && text[i + 1] === '*') {
            const end = text.indexOf('*/', i + 2);
            if (end === -1) return -1;
            i = end + 1;
        } else if (c === '{') {
            depth++;
        } else if (c === '}' && --depth === 0) {
            return i + 1;
        }
    }
    return -1;
}

export function readChatGPTCss(text) {
    const first = cssStart.exec(text);
    if (!first) return null;
    const id = first[1];
    let end = ruleEnd(text, first[0].length - 1);
    if (end < 0) return null;
    while (end < text.length) {
        const next = text.slice(end).match(/^\s*(?:#[\w-]+(?=[\s.:[#,{>+~])|@keyframes\s+[\w-]+(?=\s*\{))/);
        if (!next) break;
        const head = next[0].trim();
        if (head.startsWith('#') && head !== '#' + id) break;
        const brace = text.indexOf('{', end + next[0].length);
        // Do not eat a subsequent Markdown heading or a different CSS block.
        if (brace < 0 || /\n\s*\n|}/.test(text.slice(end + next[0].length, brace))) break;
        const rule = ruleEnd(text, brace);
        if (rule < 0) break;
        end = rule;
    }
    return { id, cssEnd: end, labels: text.slice(end).trim() };
}

export function readChatGPTSvg(text) {
    const start = /^ {0,3}<svg\b[^>]*\bid\s*=\s*["'](chatgpt-mermaid-[\w-]+)["'][^>]*>/i.exec(text);
    if (!start) return null;
    let depth = 1;
    for (const match of text.slice(start[0].length).matchAll(/<\/?svg\b[^>]*>/gi)) {
        if (match[0].startsWith('</')) depth--;
        else if (!match[0].endsWith('/>')) depth++;
        if (depth === 0) return text.slice(0, start[0].length + match.index + match[0].length);
    }
    return null;
}

// Marked block extension: leave ordinary fenced code and inline text alone.
export function chatGPTMermaidExtension(render) {
    return {
        name: 'chatGPTMermaid',
        level: 'block',
        start(src) {
            const index = src.search(/^ {0,3}(?:#chatgpt-mermaid-[\w-]+\s*\{|<svg\b[^>]*\bid\s*=\s*["']chatgpt-mermaid-)/im);
            return index < 0 ? undefined : index;
        },
        tokenizer(src) {
            const svg = readChatGPTSvg(src);
            if (svg) return { type: 'chatGPTMermaid', raw: svg, text: svg };
            const css = readChatGPTCss(src);
            if (!css) return;
            // For unfenced dumps only consume the remaining line. Following
            // Markdown paragraphs/headings must still be parsed normally.
            const tail = src.slice(css.cssEnd).match(/^[^\r\n]*/)[0];
            const raw = src.slice(0, css.cssEnd) + tail;
            return { type: 'chatGPTMermaid', raw, text: raw };
        },
        renderer(token) {
            return render(token.text);
        }
    };
}

const svgTags = new Set('svg g defs marker path rect circle ellipse polygon polyline line text tspan textPath title desc clipPath mask linearGradient radialGradient stop pattern symbol use foreignObject'.split(' '));
const attributes = new Set('viewBox preserveAspectRatio width height x y x1 x2 y1 y2 cx cy r rx ry d points transform dx dy rotate textLength lengthAdjust markerWidth markerHeight refX refY orient markerUnits gradientUnits gradientTransform spreadMethod offset patternUnits patternContentUnits patternTransform clipPathUnits maskUnits maskContentUnits startOffset'.split(' '));
const presentation = new Set('fill stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-opacity fill-opacity fill-rule opacity font-family font-size font-weight font-style text-anchor dominant-baseline alignment-baseline letter-spacing stop-color stop-opacity color paint-order vector-effect clip-rule'.split(' '));
const references = new Set('marker-start marker-mid marker-end clip-path mask'.split(' '));
const localUrl = /^url\(\s*["']?#([\w:.-]+)["']?\s*\)$/i;

function labelText(element) {
    let result = '';
    function visit(node) {
        if (node.nodeType === 3) {
            result += node.data;
            return;
        }
        if (node.nodeType !== 1 || ['style', 'script', 'title', 'desc'].includes(node.localName)) return;
        const newLine = node.localName === 'br' || node.localName === 'p' ||
            (node.localName === 'tspan' && (node.hasAttribute('x') || node.hasAttribute('dy') || node.hasAttribute('y')));
        if (newLine && result && !result.endsWith('\n')) result += '\n';
        for (const child of node.childNodes) visit(child);
        if (node.localName === 'p' && !result.endsWith('\n')) result += '\n';
    }
    visit(element);
    return result.split('\n').map(line => line.trim()).filter(Boolean).join('\n');
}

// Rebuild, rather than inserting untrusted SVG/HTML or a pasted stylesheet.
// Only geometry, local ID references and a small set of presentation properties
// survive. In particular, no script, events, links, external URLs or CSS rules.
export function sanitizeChatGPTSvg(input, prefix) {
    if (typeof input === 'string') {
        const parsed = new DOMParser().parseFromString(input, 'image/svg+xml');
        if (parsed.documentElement.namespaceURI === svgNamespace &&
            !parsed.querySelector('parsererror')) {
            input = parsed.documentElement;
        } else {
            // HTML clipboard/DevTools snippets may omit xmlns. Parse in an
            // inert template; only our reconstructed SVG is ever inserted.
            const template = document.createElement('template');
            template.innerHTML = input;
            input = template.content.querySelector('svg[id^="chatgpt-mermaid-"]');
        }
    }
    if (!input || input.namespaceURI !== svgNamespace || input.localName !== 'svg' || !diagramId.test(input.id)) return null;
    const ids = new Map([[input.id, prefix]]);
    for (const item of input.querySelectorAll('[id]')) {
        if (item.id && !ids.has(item.id)) ids.set(item.id, prefix + '-' + ids.size);
    }

    const css = document.createElement('span').style;
    function setPresentation(target, name, value) {
        if (references.has(name) || name === 'fill' || name === 'stroke') {
            const ref = localUrl.exec(value);
            if (ref && ids.has(ref[1])) {
                target.setAttribute(name, 'url(#' + ids.get(ref[1]) + ')');
                return;
            }
            if (references.has(name)) return;
        }
        if (!presentation.has(name) || /url\s*\(|var\s*\(|\\|[{};]/i.test(value)) return;
        // CSSOM validation rejects malformed property values.
        css.removeProperty(name);
        css.setProperty(name, value);
        if (css.getPropertyValue(name)) target.setAttribute(name, css.getPropertyValue(name));
    }

    const usedIds = new Set();
    function copy(source) {
        if (source.nodeType === 3) return document.createTextNode(source.data);
        if (source.nodeType !== 1 || source.namespaceURI !== svgNamespace || !svgTags.has(source.localName)) return null;
        const target = document.createElementNS(svgNamespace, source.localName);
        for (const {name, value} of source.attributes) {
            if (name === 'id' && ids.has(value) && !usedIds.has(value)) {
                target.id = ids.get(value);
                usedIds.add(value);
            } else if (name === 'class' && /^[\w\s-]*$/.test(value)) {
                target.setAttribute(name, value);
            } else if (attributes.has(name)) {
                target.setAttribute(name, value);
            } else if (name === 'href' || name === 'xlink:href') {
                if (['use', 'textPath', 'linearGradient', 'radialGradient', 'pattern'].includes(source.localName) &&
                    value.startsWith('#') && ids.has(value.slice(1))) target.setAttribute('href', '#' + ids.get(value.slice(1)));
            } else {
                setPresentation(target, name, value);
            }
        }
        // Geometry-related inline styles are not needed for Mermaid paths.
        // Import only safe presentation styles, never the original CSS text.
        if (source.hasAttribute('style')) {
            const inline = document.createElement('span').style;
            inline.cssText = source.getAttribute('style');
            for (let i = 0; i < inline.length; i++) {
                const name = inline.item(i);
                setPresentation(target, name, inline.getPropertyValue(name));
            }
        }
        if (source.localName === 'foreignObject') {
            const label = document.createElementNS(htmlNamespace, 'div');
            label.textContent = labelText(source);
            target.append(label);
        } else {
            for (const child of source.childNodes) {
                const safe = copy(child);
                if (safe) target.append(safe);
            }
        }
        return target;
    }
    const svg = copy(input);
    if (!svg.querySelector('path, rect, circle, ellipse, line, polygon, polyline, text, foreignObject, use')) return null;
    const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    if (viewBox?.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0) {
        svg.setAttribute('width', String(viewBox[2]));
        svg.setAttribute('height', String(viewBox[3]));
    }
    return svg;
}

function compact(text) {
    return text.replace(/\s+/g, '');
}

function matchLabelPrefix(text, labels) {
    const expected = compact(labels);
    if (!expected) return 0;
    let index = 0;
    for (const char of expected) {
        while (/\s/.test(text[index] || '')) index++;
        if (text.slice(index, index + char.length) !== char) return -1;
        index += char.length;
    }
    return index;
}

// Some Chromium copies omit <style> from text/plain. In a larger paste,
// replace a label-only fragment only when it uniquely occupies whole lines.
function findLabelBlock(text, labels, offset) {
    if (!compact(labels)) return null;
    const matches = [];
    for (let start = offset; start < text.length;) {
        if ((start === 0 || text[start - 1] === '\n') && !/^[ \t]*\r?\n/.test(text.slice(start))) {
            const end = matchLabelPrefix(text.slice(start), labels);
            if (end > 0 && /^(?:[ \t]*\r?\n|[ \t]*$)/.test(text.slice(start + end))) {
                matches.push({ start, end: start + end });
            }
        }
        const newline = text.indexOf('\n', start);
        if (newline < 0) break;
        start = newline + 1;
    }
    return matches.length === 1 ? matches[0] : null;
}

// Preserve the plain-text Markdown around a diagram. Replace only a matching
// CSS/label fragment, or a paste consisting entirely of a single diagram.
export function recoverChatGPTClipboard(plain, html) {
    if (!html || !html.includes('chatgpt-mermaid-')) return null;
    const template = document.createElement('template');
    template.innerHTML = html;
    const diagrams = [...template.content.querySelectorAll('svg[id^="chatgpt-mermaid-"]')];
    let result = plain;
    let offset = 0;
    let changed = false;
    for (const original of diagrams) {
        const safe = sanitizeChatGPTSvg(original, original.id);
        if (!safe) continue;
        const copy = original.cloneNode(true);
        copy.querySelectorAll('style, script').forEach(node => node.remove());
        const labels = [...copy.querySelectorAll('text, foreignObject')].map(labelText).join('\n');
        const fence = '\n\n```chatgpt-mermaid\n' + new XMLSerializer().serializeToString(safe) + '\n```\n\n';
        const escapedId = original.id; // IDs are validated by sanitizeChatGPTSvg.
        const cssMatch = new RegExp('#' + escapedId + '\\s*\\{').exec(result.slice(offset));
        if (cssMatch) {
            const start = offset + cssMatch.index;
            const css = readChatGPTCss(result.slice(start));
            if (!css) continue;
            const tail = result.slice(start + css.cssEnd);
            const matched = Math.max(matchLabelPrefix(tail, copy.textContent), matchLabelPrefix(tail, labels), 0);
            const end = start + css.cssEnd + matched;
            result = result.slice(0, start) + fence + result.slice(end);
            offset = start + fence.length;
            changed = true;
        } else if (diagrams.length === 1 && (!plain.trim() ||
            [copy.textContent, labels, original.textContent].some(text => compact(text) === compact(plain)))) {
            result = fence.trim();
            changed = true;
        } else if (copy.querySelectorAll('text, foreignObject').length > 1) {
            const block = findLabelBlock(result, labels, offset);
            if (!block) continue;
            result = result.slice(0, block.start) + fence + result.slice(block.end);
            offset = block.start + fence.length;
            changed = true;
        }
    }
    return changed ? result : null;
}

// Chromium's page translation is much more reliable with ordinary HTML
// than with SVG <text>. Overlay the labels using SVG's own geometry, leaving
// the imported paths and arrows intact and keeping the labels in the HTML DOM.
export function installChatGPTLabels(stage, svg) {
    const layer = document.createElement('div');
    layer.className = 'chatgpt-mermaid-labels';
    layer.setAttribute('translate', 'yes');
    const labels = [];
    for (const original of svg.querySelectorAll('text, foreignObject')) {
        if (original.closest('defs, marker, clipPath, mask, symbol, pattern')) continue;
        const text = labelText(original);
        if (!text) continue;
        const html = document.createElement('span');
        html.className = 'chatgpt-mermaid-label';
        html.textContent = text;
        layer.append(html);
        labels.push({ original, html });
    }
    stage.append(layer);
    function layout() {
        if (!stage.isConnected) return;
        const origin = stage.getBoundingClientRect();
        for (const {original, html} of labels) {
            const matrix = original.getScreenCTM();
            let box;
            try {
                box = original.getBBox();
            } catch {
                continue;
            }
            if (!matrix || box.width <= 0 || box.height <= 0) {
                html.hidden = true;
                original.style.removeProperty('visibility');
                continue;
            }
            const center = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(matrix);
            const scale = Math.hypot(matrix.a, matrix.b);
            const computed = getComputedStyle(original);
            const node = original.closest('.node, .edgeLabel');
            const available = node?.getBoundingClientRect().width || 0;
            html.style.left = (center.x - origin.left) + 'px';
            html.style.top = (center.y - origin.top) + 'px';
            html.style.width = Math.max(box.width * scale + 4, available - 12) + 'px';
            html.style.fontSize = ((parseFloat(computed.fontSize) || 14) * scale) + 'px';
            html.style.fontFamily = computed.fontFamily;
            html.style.fontWeight = computed.fontWeight;
            html.style.transform = 'translate(-50%, -50%) rotate(' + Math.atan2(matrix.b, matrix.a) + 'rad)';
            html.hidden = false;
            original.style.visibility = 'hidden';
        }
    }
    svg.setAttribute('translate', 'no');
    svg.classList.add('notranslate');
    layout();
    const observer = new ResizeObserver(layout);
    observer.observe(stage);
    window.addEventListener('beforeprint', layout);
    return () => {
        observer.disconnect();
        window.removeEventListener('beforeprint', layout);
    };
}
